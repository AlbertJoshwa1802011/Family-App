import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { and, eq } from "drizzle-orm";
import type { HonoEnv, AppContext } from "../types";
import { getDb, schema } from "../db/client";
import {
  createSession,
  deleteSession,
  validateSession,
  SESSION_ABSOLUTE_SECS,
  COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
} from "../lib/session";
import { sessionIdFromRequest } from "../lib/sessionAuth";
import { generateRandom, sha256Base64url } from "../lib/crypto";
import { checkRateLimit, clientIp } from "../lib/rateLimit";
import {
  canSignIn,
  ensureBootstrapSuperAdmin,
  listAppRoles,
} from "../lib/appAccess";
import { loginBounceHtml, requestOrigin, safeAppPath } from "../lib/publicUrl";
import { parseModulesJson, FAMILY_MODULES } from "../lib/modules";

export const authRoutes = new Hono<HonoEnv>();

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const PKCE_TTL_SECS = 600; // 10 minutes
const MOBILE_CODE_TTL_SECS = 60;
/** Custom URL scheme for the Albert iOS companion (ASWebAuthenticationSession). */
export const IOS_OAUTH_CALLBACK_SCHEME = "albert://oauth-callback";

type OAuthClient = "web" | "ios";

function oauthRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/auth/google/callback`;
}

/** Post-login path from ?next= — same-origin relative only. */
function returnPathFromRequest(c: AppContext): string {
  return safeAppPath(c.req.query("next") ?? "/");
}

function oauthClientFromRequest(c: AppContext): OAuthClient {
  return c.req.query("client") === "ios" ? "ios" : "web";
}

async function beginGoogleOAuth(
  c: AppContext,
): Promise<{ url: string } | Response> {
  const clientId = c.env?.GOOGLE_CLIENT_ID;
  const origin = requestOrigin(c.req.url, c.env?.APP_URL);

  if (!clientId) {
    return c.json({ error: "oauth_not_configured" }, 503);
  }

  const limited = await checkRateLimit(c, `auth-start:${clientIp(c)}`, {
    limit: 10,
    windowSecs: 60,
  });
  if (limited) return limited;

  const codeVerifier = generateRandom(32);
  const codeChallenge = await sha256Base64url(codeVerifier);
  const state = generateRandom(16);
  const redirectUri = oauthRedirectUri(origin);
  const returnTo = returnPathFromRequest(c);
  const client = oauthClientFromRequest(c);

  await c.env.KV.put(
    `oauth:state:${state}`,
    JSON.stringify({ codeVerifier, redirectUri, returnTo, client }),
    { expirationTtl: PKCE_TTL_SECS },
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: [
      "openid",
      "email",
      "profile",
      // Drive: document files created by this app only (non-sensitive).
      "https://www.googleapis.com/auth/drive.file",
      // Calendar: push Family Vault events into the user's primary calendar.
      "https://www.googleapis.com/auth/calendar.events",
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return { url: `${GOOGLE_AUTH_URL}?${params.toString()}` };
}

// GET /auth/google/start — full-page navigation (phones / in-app browsers).
// 302s to Google. A GET used to 404 JSON, which is what you see if the
// address bar stops on /api/auth/google/start.
authRoutes.get("/google/start", async (c) => {
  const origin = requestOrigin(c.req.url, c.env?.APP_URL);
  const result = await beginGoogleOAuth(c);
  if (result instanceof Response) {
    if (result.status === 503) {
      return c.redirect(`${origin}/login?error=oauth_not_configured`);
    }
    if (result.status === 429) {
      return c.redirect(`${origin}/login?error=rate_limited`);
    }
    return result;
  }
  return c.redirect(result.url);
});

// GET /auth/me — return authenticated user + their families (or nulls).
// Not protected by requireSession; we gracefully return null if no valid session.
// Accepts cookie `sid` (web) or Authorization Bearer (Albert iOS).
authRoutes.get("/me", async (c) => {
  const sessionId = sessionIdFromRequest(c);
  if (!sessionId) return c.json({ user: null, families: [] });

  const db = getDb(c.env);
  const result = await validateSession(db, sessionId);
  if (!result) {
    deleteCookie(c, COOKIE_NAME, SESSION_COOKIE_OPTIONS);
    return c.json({ user: null, families: [] });
  }

  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, result.userId))
    .get();

  if (!user) return c.json({ user: null, families: [] });

  // Bootstrap SUPER_ADMIN_EMAILS → durable super_admin assignment (idempotent).
  await ensureBootstrapSuperAdmin(db, c.env, user.id, user.email);
  const appRoles = await listAppRoles(db, user.id);

  // Fetch all active family memberships for this user
  const memberships = await db
    .select({
      familyId: schema.familyMembers.familyId,
      role: schema.familyMembers.role,
      modulesJson: schema.familyMembers.modulesJson,
      familyName: schema.families.name,
      driveFolderId: schema.families.driveFolderId,
      familyCreatedAt: schema.families.createdAt,
    })
    .from(schema.familyMembers)
    .innerJoin(schema.families, eq(schema.familyMembers.familyId, schema.families.id))
    .where(
      and(
        eq(schema.familyMembers.userId, user.id),
        eq(schema.familyMembers.status, "active"),
      ),
    );

  const families = memberships.map((m) => ({
    id: m.familyId,
    name: m.familyName,
    role: m.role,
    modules:
      m.role === "owner"
        ? [...FAMILY_MODULES]
        : parseModulesJson(m.modulesJson),
    driveFolderId: m.driveFolderId,
    createdAt: m.familyCreatedAt,
  }));

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      appRoles,
    },
    families,
  });
});

// POST /auth/google/start — JSON { url } for clients that prefer fetch.
authRoutes.post("/google/start", async (c) => {
  const result = await beginGoogleOAuth(c);
  if (result instanceof Response) return result;
  return c.json({ url: result.url });
});

// GET /auth/google/callback — OAuth redirect handler. Exchanges code for tokens,
// verifies the ID token, upserts the user in D1, creates a session, sets cookie.
authRoutes.get("/google/callback", async (c) => {
  const origin = requestOrigin(c.req.url, c.env?.APP_URL);
  const redirect = (path: string) => c.redirect(`${origin}${path}`);

  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) return redirect(`/login?error=${encodeURIComponent(error)}`);
  if (!code || !state) return redirect("/login?error=missing_params");

  // Per-IP throttle: the callback does a token exchange + D1 writes.
  const limited = await checkRateLimit(c, `auth-callback:${clientIp(c)}`, {
    limit: 10,
    windowSecs: 60,
  });
  if (limited) return redirect("/login?error=rate_limited");

  const clientId = c.env?.GOOGLE_CLIENT_ID;
  const clientSecret = c.env?.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return redirect("/login?error=oauth_not_configured");

  // Verify + consume state from KV
  const kvKey = `oauth:state:${state}`;
  const stored = await c.env.KV.get(kvKey, "json") as {
    codeVerifier: string;
    redirectUri?: string;
    returnTo?: string;
    client?: OAuthClient;
  } | null;
  if (!stored) return redirect("/login?error=invalid_state");
  await c.env.KV.delete(kvKey);

  const redirectUri = stored.redirectUri ?? oauthRedirectUri(origin);
  const returnTo = safeAppPath(stored.returnTo ?? "/");
  const oauthClient: OAuthClient = stored.client === "ios" ? "ios" : "web";
  const loginError = (code: string) => {
    if (oauthClient === "ios") {
      // ASWebAuthenticationSession receives errors on the same custom scheme.
      return c.redirect(
        `${IOS_OAUTH_CALLBACK_SCHEME}?error=${encodeURIComponent(code)}`,
      );
    }
    const q = new URLSearchParams({ error: code });
    if (returnTo !== "/") q.set("next", returnTo);
    return redirect(`/login?${q.toString()}`);
  };

  // Exchange authorization code for tokens
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: stored.codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    console.error("Token exchange failed:", await tokenRes.text());
    return loginError("token_exchange_failed");
  }

  const tokens = (await tokenRes.json()) as {
    id_token: string;
    access_token: string;
    refresh_token?: string;
  };

  // Verify the Google ID token with jose against Google's JWKS endpoint
  let sub: string, email: string, name: string | undefined, picture: string | undefined;
  try {
    const { payload } = await jwtVerify(tokens.id_token, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    });
    sub = payload.sub as string;
    email = payload["email"] as string;
    name = payload["name"] as string | undefined;
    picture = payload["picture"] as string | undefined;
  } catch (e) {
    console.error("ID token verification failed:", e);
    return loginError("token_invalid");
  }

  const db = getDb(c.env);

  // Closed signup: only approved emails / bootstrap admins / returning users.
  const access = await canSignIn(db, c.env, { email, googleSub: sub });
  if (!access.ok) {
    return loginError(access.reason);
  }

  // Upsert user: update profile fields on conflict (user might have changed their name/picture)
  await db
    .insert(schema.users)
    .values({
      id: crypto.randomUUID(),
      googleSub: sub,
      email,
      name: name ?? null,
      picture: picture ?? null,
      lastLoginAt: Math.floor(Date.now() / 1000),
    })
    .onConflictDoUpdate({
      target: schema.users.googleSub,
      set: {
        email,
        name: name ?? null,
        picture: picture ?? null,
        lastLoginAt: Math.floor(Date.now() / 1000),
      },
    });

  // Fetch the real user ID (might differ from the UUID we tried to insert)
  const user = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.googleSub, sub))
    .get();

  if (!user) return loginError("user_create_failed");

  await ensureBootstrapSuperAdmin(db, c.env, user.id, user.email);

  // Cache refresh token in KV (Drive + Google Calendar push need it).
  // Drop any cached access token so the next API call picks up newly granted
  // scopes (e.g. calendar.events after a re-consent).
  if (tokens.refresh_token) {
    await c.env.KV.put(`user:refresh_token:${user.id}`, tokens.refresh_token);
  }
  if (tokens.access_token) {
    await c.env.KV.put(`user:access_token:${user.id}`, tokens.access_token, {
      expirationTtl: 3300,
    });
  } else {
    await c.env.KV.delete(`user:access_token:${user.id}`);
  }

  const sessionId = await createSession(db, user.id, c.req.header("user-agent"));

  setCookie(c, COOKIE_NAME, sessionId, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: SESSION_ABSOLUTE_SECS,
  });

  // Albert iOS: hand off via one-time code on the custom URL scheme.
  // Never put the session id in the redirect URL (referrer / history risk).
  if (oauthClient === "ios") {
    const mobileCode = generateRandom(24);
    await c.env.KV.put(
      `oauth:mobile:${mobileCode}`,
      JSON.stringify({ sessionId }),
      { expirationTtl: MOBILE_CODE_TTL_SECS },
    );
    return c.redirect(
      `${IOS_OAUTH_CALLBACK_SCHEME}?code=${encodeURIComponent(mobileCode)}`,
    );
  }

  // 200 HTML bounce (not 302): Safari/iOS drops Set-Cookie on the 302 that
  // follows Google's cross-site redirect, which looks like a failed phone login.
  // returnTo restores deep links (e.g. /invite/:token) after sign-in.
  return c.html(loginBounceHtml(returnTo), 200);
});

const mobileExchangeSchema = z.object({
  code: z.string().min(8).max(128),
});

// POST /auth/mobile/exchange — Albert iOS trades a one-time OAuth code for a
// Bearer session token (same D1 session row the cookie would have used).
authRoutes.post(
  "/mobile/exchange",
  zValidator("json", mobileExchangeSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "validation_error", issues: result.error.issues },
        400,
      );
    }
  }),
  async (c) => {
    const limited = await checkRateLimit(c, `auth-mobile:${clientIp(c)}`, {
      limit: 20,
      windowSecs: 60,
    });
    if (limited) return limited;

    const { code } = c.req.valid("json");
    const kvKey = `oauth:mobile:${code}`;
    const stored = (await c.env.KV.get(kvKey, "json")) as {
      sessionId?: string;
    } | null;
    if (!stored?.sessionId) {
      return c.json({ error: "invalid_code" }, 401);
    }
    await c.env.KV.delete(kvKey);

    const db = getDb(c.env);
    const session = await db
      .select({
        userId: schema.sessions.userId,
        expiresAt: schema.sessions.expiresAt,
      })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, stored.sessionId))
      .get();

    if (!session) {
      return c.json({ error: "unauthorized" }, 401);
    }

    // Slide idle window via the shared validator.
    const valid = await validateSession(db, stored.sessionId);
    if (!valid) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, session.userId))
      .get();
    if (!user) {
      return c.json({ error: "unauthorized" }, 401);
    }

    await ensureBootstrapSuperAdmin(db, c.env, user.id, user.email);
    const appRoles = await listAppRoles(db, user.id);

    const memberships = await db
      .select({
        familyId: schema.familyMembers.familyId,
        role: schema.familyMembers.role,
        modulesJson: schema.familyMembers.modulesJson,
        familyName: schema.families.name,
        driveFolderId: schema.families.driveFolderId,
        familyCreatedAt: schema.families.createdAt,
      })
      .from(schema.familyMembers)
      .innerJoin(
        schema.families,
        eq(schema.familyMembers.familyId, schema.families.id),
      )
      .where(
        and(
          eq(schema.familyMembers.userId, user.id),
          eq(schema.familyMembers.status, "active"),
        ),
      );

    const families = memberships.map((m) => ({
      id: m.familyId,
      name: m.familyName,
      role: m.role,
      modules:
        m.role === "owner"
          ? [...FAMILY_MODULES]
          : parseModulesJson(m.modulesJson),
      driveFolderId: m.driveFolderId,
      createdAt: m.familyCreatedAt,
    }));

    return c.json({
      sessionToken: stored.sessionId,
      expiresAt: session.expiresAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        appRoles,
      },
      families,
    });
  },
);

const mobileDeviceSchema = z.object({
  platform: z.literal("ios"),
  deviceToken: z.string().min(8).max(4096).optional(),
});

// POST /auth/mobile/device — stub for future APNs registration (v1 local notifs).
authRoutes.post(
  "/mobile/device",
  zValidator("json", mobileDeviceSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "validation_error", issues: result.error.issues },
        400,
      );
    }
  }),
  async (c) => {
    const sessionId = sessionIdFromRequest(c);
    if (!sessionId) return c.json({ error: "unauthorized" }, 401);
    const db = getDb(c.env);
    const result = await validateSession(db, sessionId);
    if (!result) return c.json({ error: "unauthorized" }, 401);
    // Intentionally no-op storage in v1 — keeps the native client contract stable.
    return c.json({ ok: true });
  },
);

// POST /auth/logout — revoke session in D1 and clear the cookie.
authRoutes.post("/logout", async (c) => {
  const sessionId = sessionIdFromRequest(c);
  if (sessionId) {
    try {
      const db = getDb(c.env);
      await deleteSession(db, sessionId);
    } catch {
      // Best-effort — still clear the cookie even if the DB call fails
    }
  }
  // Same Path/Secure/SameSite/HttpOnly as setCookie — otherwise the browser
  // keeps the original sid and the next /auth/me still looks signed-in.
  deleteCookie(c, COOKIE_NAME, SESSION_COOKIE_OPTIONS);
  return c.json({ ok: true });
});
