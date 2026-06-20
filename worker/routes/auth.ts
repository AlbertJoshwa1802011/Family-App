import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { and, eq } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { createSession, deleteSession, validateSession, SESSION_ABSOLUTE_SECS, COOKIE_NAME } from "../lib/session";
import { generateRandom, sha256Base64url } from "../lib/crypto";

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
    deleteCookie(c, COOKIE_NAME, { path: "/" });
    return c.json({ user: null, families: [] });
  }

  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, result.userId))
    .get();

  if (!user) return c.json({ user: null, families: [] });

  // Fetch all active family memberships for this user
  const memberships = await db
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

  const families = memberships.map((m) => ({
    id: m.familyId,
    name: m.familyName,
    role: m.role,
    driveFolderId: m.driveFolderId,
    createdAt: m.familyCreatedAt,
  }));

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
    },
    families,
  });
});

// GET /auth/google/start — build the Google OAuth redirect URL (PKCE).
// Returns { url } so the SPA can redirect (avoids CORS issues with 302s).
authRoutes.get("/google/start", async (c) => {
  const clientId = c.env?.GOOGLE_CLIENT_ID;
  const appUrl = c.env?.APP_URL ?? "";

  if (!clientId) {
    return c.json({ error: "oauth_not_configured" }, 503);
  }

  // PKCE: code_verifier is random; code_challenge = BASE64URL(SHA256(verifier))
  const codeVerifier = generateRandom(32); // 43-char base64url, satisfies RFC 7636
  const codeChallenge = await sha256Base64url(codeVerifier);
  const state = generateRandom(16);

  // Persist {codeVerifier} in KV keyed by state; expires in 10 minutes
  await c.env.KV.put(
    `oauth:state:${state}`,
    JSON.stringify({ codeVerifier }),
    { expirationTtl: PKCE_TTL_SECS },
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/api/auth/google/callback`,
    response_type: "code",
    scope: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/drive.file",
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return c.json({ url: `${GOOGLE_AUTH_URL}?${params.toString()}` });
});

// GET /auth/google/callback — OAuth redirect handler. Exchanges code for tokens,
// verifies the ID token, upserts the user in D1, creates a session, sets cookie.
authRoutes.get("/google/callback", async (c) => {
  const appUrl = c.env?.APP_URL ?? "";
  const redirect = (path: string) => c.redirect(`${appUrl}${path}`);

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
  const stored = await c.env.KV.get(kvKey, "json") as { codeVerifier: string } | null;
  if (!stored) return redirect("/login?error=invalid_state");
  await c.env.KV.delete(kvKey);

  // Exchange authorization code for tokens
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${appUrl}/api/auth/google/callback`,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: stored.codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    console.error("Token exchange failed:", await tokenRes.text());
    return redirect("/login?error=token_exchange_failed");
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
    return redirect("/login?error=token_invalid");
  }

  const db = getDb(c.env);

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

  // Cache owner refresh token in KV (Drive upload/download needs it in Phase 2)
  if (tokens.refresh_token) {
    await c.env.KV.put(`user:refresh_token:${user.id}`, tokens.refresh_token);
  }

  const sessionId = await createSession(db, user.id, c.req.header("user-agent"));

  setCookie(c, COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_ABSOLUTE_SECS,
  });

  return redirect("/");
});

// POST /auth/logout — revoke session in D1 and clear the cookie.
authRoutes.post("/logout", async (c) => {
  const sessionId = getCookie(c, COOKIE_NAME);
  if (sessionId) {
    try {
      const db = getDb(c.env);
      await deleteSession(db, sessionId);
    } catch {
      // Best-effort — still clear the cookie even if the DB call fails
    }
  }
  deleteCookie(c, COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});
