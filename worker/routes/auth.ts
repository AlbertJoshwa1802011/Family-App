import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { and, eq } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { generateRandom, sha256Base64url } from "../lib/crypto";
import { audit, ACTIONS } from "../lib/audit";
import { isPlatformAdmin } from "../middleware/requirePlatformAdmin";
import { canSignIn } from "../lib/appAccess";
import {
  LOGIN_SCOPES,
  extraScopesFromConnect,
  clearUserGoogleAccessCache,
  cacheUserGoogleAccessToken,
  replaceGrantedScopes,
  refreshKey,
  GOOGLE_SCOPES,
  userHasScope,
  userHasRefreshToken,
  userCalendarReady,
  scopeListIncludes,
} from "../lib/google";
import { loginBounceHtml, requestOrigin, safeAppPath } from "../lib/publicUrl";
import {
  createSession,
  deleteSession,
  validateSession,
  SESSION_ABSOLUTE_SECS,
  COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
} from "../lib/session";

export const authRoutes = new Hono<HonoEnv>();

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const PKCE_TTL_SECS = 600; // 10 minutes

// GET /auth/me — return authenticated user + their families (or nulls).
// Not protected by requireSession; we gracefully return null if no valid session.
authRoutes.get("/me", async (c) => {
  const sessionId = getCookie(c, COOKIE_NAME);
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

  // Fetch all active family memberships for this user
  let memberships = await db
    .select({
      familyId: schema.familyMembers.familyId,
      role: schema.familyMembers.role,
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

  if (memberships.length === 0) {
    // Auto-create a default family for this user
    const familyId = crypto.randomUUID();
    const memberId = crypto.randomUUID();
    const familyName = user.name ? `${user.name.split(" ")[0]}'s Family` : "Personal Family";
    const now = Math.floor(Date.now() / 1000);

    await db.insert(schema.families).values({
      id: familyId,
      name: familyName,
      ownerUserId: user.id,
      createdAt: now,
    });

    await db.insert(schema.familyMembers).values({
      id: memberId,
      familyId,
      userId: user.id,
      role: "owner",
      memberType: "user",
      displayName: user.name,
      status: "active",
      createdAt: now,
    });

    memberships = [
      {
        familyId,
        role: "owner",
        familyName,
        driveFolderId: null,
        familyCreatedAt: now,
      },
    ];
  }

  const families = memberships.map((m) => ({
    id: m.familyId,
    name: m.familyName,
    role: m.role,
    driveFolderId: m.driveFolderId,
    createdAt: m.familyCreatedAt,
  }));

  const platformAdmin = await isPlatformAdmin(db, c.env, user.id);

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      isPlatformAdmin: platformAdmin,
    },
    families,
  });
});

// GET /auth/google/status — which extra Google scopes this session can use.
// `calendar` is true only when calendar.events was granted AND a refresh token
// exists (otherwise event create cannot write to Google Calendar).
authRoutes.get("/google/status", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const [contacts, gmail, calendar, hasRefreshToken] = await Promise.all([
    userHasScope(c.env, userId, GOOGLE_SCOPES.contacts),
    userHasScope(c.env, userId, GOOGLE_SCOPES.gmailSend),
    userCalendarReady(c.env, userId),
    userHasRefreshToken(c.env, userId),
  ]);
  return c.json({ contacts, gmail, calendar, hasRefreshToken });
});

// GET /auth/google/start — build and return a Google OAuth redirect (PKCE).
// Returns 302 redirect to the Google auth URL.
authRoutes.get("/google/start", async (c) => {
  const clientId = c.env?.GOOGLE_CLIENT_ID;
  const origin = requestOrigin(c.req.url, c.env?.APP_URL);

  if (!clientId) {
    return c.redirect(`${origin}/login?error=oauth_not_configured`);
  }

  const connect = c.req.query("connect") ?? "";
  const extra = extraScopesFromConnect(connect);
  // Prefer returnTo; accept ?next= as an alias so invite deep-links work.
  const returnTo = c.req.query("returnTo") || c.req.query("next") || "/";
  // Force the consent screen only when requesting extra scopes (Calendar,
  // Contacts, Gmail) or when the client asks for a fresh refresh token.
  // prompt=consent on every login re-shows Google's "unverified app" warning.
  const forceConsent = extra.length > 0 || c.req.query("consent") === "1";

  // PKCE: code_verifier is random; code_challenge = BASE64URL(SHA256(verifier))
  const codeVerifier = generateRandom(32); // 43-char base64url, satisfies RFC 7636
  const codeChallenge = await sha256Base64url(codeVerifier);
  const state = generateRandom(16);
  const redirectUri = `${origin}/api/auth/google/callback`;

  // Persist verifier + exact redirect_uri (token exchange must match).
  await c.env.KV.put(
    `oauth:state:${state}`,
    JSON.stringify({ codeVerifier, extra, returnTo, redirectUri }),
    { expirationTtl: PKCE_TTL_SECS },
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: [...LOGIN_SCOPES, ...extra].join(" "),
    access_type: "offline",
    prompt: forceConsent ? "consent" : "select_account",
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return c.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
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

  const clientId = c.env?.GOOGLE_CLIENT_ID;
  const clientSecret = c.env?.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return redirect("/login?error=oauth_not_configured");

  // Verify + consume state from KV
  const kvKey = `oauth:state:${state}`;
  const stored = await c.env.KV.get(kvKey, "json") as {
    codeVerifier: string;
    extra?: string[];
    returnTo?: string;
    redirectUri?: string;
  } | null;
  if (!stored) return redirect("/login?error=invalid_state");
  await c.env.KV.delete(kvKey);

  const redirectUri = stored.redirectUri ?? `${origin}/api/auth/google/callback`;

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
    await audit(c, {
      action: ACTIONS.AUTH_LOGIN_FAILED,
      meta: { reason: "token_exchange_failed" },
    });
    return redirect("/login?error=token_exchange_failed");
  }

  const tokens = (await tokenRes.json()) as {
    id_token: string;
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
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
    await audit(c, {
      action: ACTIONS.AUTH_LOGIN_FAILED,
      meta: { reason: "token_invalid" },
    });
    return redirect("/login?error=token_invalid");
  }

  const db = getDb(c.env);

  // Closed signup: only approved emails / bootstrap admins / returning users.
  const access = await canSignIn(db, c.env, { email, googleSub: sub });
  if (!access.ok) {
    const q = new URLSearchParams({
      error: access.reason,
      email,
    });
    if (name?.trim()) q.set("name", name.trim());
    return redirect(`/login?${q.toString()}`);
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
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.googleSub, sub))
    .get();

  if (!user) return redirect("/login?error=user_create_failed");

  const wantedExtras = stored.extra ?? [];
  const wantedCalendar = wantedExtras.includes(GOOGLE_SCOPES.calendarEvents);
  const grantedScopes = (tokens.scope ?? "").split(/\s+/).filter(Boolean);

  // Persist refresh token when Google issues one (first consent / force consent).
  if (tokens.refresh_token) {
    await c.env.KV.put(refreshKey(user.id), tokens.refresh_token);
  }

  // Always cache the access token from THIS consent — it already carries any
  // newly granted scopes (calendar.events). Clearing-only left us with no
  // usable token when Google omitted refresh_token on incremental Connect.
  if (tokens.access_token) {
    await cacheUserGoogleAccessToken(
      c.env,
      user.id,
      tokens.access_token,
      tokens.expires_in,
    );
  } else {
    await clearUserGoogleAccessCache(c.env, user.id);
  }

  // Google's scope string is the live grant (include_granted_scopes=true).
  if (tokens.scope) {
    await replaceGrantedScopes(c.env, user.id, tokens.scope);
  }

  // Connect Calendar must actually grant calendar.events + leave us able to
  // refresh later. Otherwise Settings showed "On" while create could not write.
  if (wantedCalendar) {
    if (!scopeListIncludes(grantedScopes, GOOGLE_SCOPES.calendarEvents)) {
      return redirect(
        `/settings?error=${encodeURIComponent("calendar_not_granted")}`,
      );
    }
    const hasRefresh =
      Boolean(tokens.refresh_token) ||
      Boolean(await c.env.KV.get(refreshKey(user.id)));
    if (!hasRefresh) {
      // Rare: Google withheld refresh_token and we never stored one. Force a
      // consent pass so offline Calendar writes work on every create.
      const returnTo = encodeURIComponent(safeAppPath(stored.returnTo ?? "/settings"));
      return redirect(
        `/api/auth/google/start?connect=calendar&consent=1&returnTo=${returnTo}`,
      );
    }
  }

  const sessionId = await createSession(db, user.id, c.req.header("user-agent"));

  setCookie(c, COOKIE_NAME, sessionId, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: SESSION_ABSOLUTE_SECS,
  });

  await audit(c, {
    actorUserId: user.id,
    action: ACTIONS.AUTH_LOGIN,
    meta: { userAgent: c.req.header("user-agent") },
  });

  const dest = safeAppPath(stored.returnTo ?? "/");
  // 200 HTML bounce (not 302): Safari/iOS drops Set-Cookie on the 302 that
  // follows Google's cross-site redirect, which looks like a failed phone login.
  return c.html(loginBounceHtml(dest), 200);
});

// POST /auth/logout — revoke session in D1 and clear the cookie.
authRoutes.post("/logout", async (c) => {
  const sessionId = getCookie(c, COOKIE_NAME);
  if (sessionId) {
    try {
      const db = getDb(c.env);
      const session = await validateSession(db, sessionId);
      await deleteSession(db, sessionId);
      if (session) {
        await audit(c, {
          actorUserId: session.userId,
          action: ACTIONS.AUTH_LOGOUT,
        });
      }
    } catch {
      // Best-effort — still clear the cookie even if the DB call fails
    }
  }
  deleteCookie(c, COOKIE_NAME, SESSION_COOKIE_OPTIONS);
  return c.json({ ok: true });
});
