import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requirePlatformAdmin } from "../middleware/requirePlatformAdmin";
import { generateRandom, sha256Base64url } from "../lib/crypto";
import { createDriveFolder, getStorageAccessToken, STORAGE_ACCOUNT_ID } from "../lib/drive";
import { audit, ACTIONS } from "../lib/audit";

export const adminRoutes = new Hono<HonoEnv>();

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const PKCE_TTL_SECS = 600; // 10 minutes
const STORAGE_REFRESH_KEY = "storage:refresh_token";
const STORAGE_ACCESS_KEY = "storage:access_token";

// All admin routes require a session AND platform-admin level.
adminRoutes.use("*", requireSession);
adminRoutes.use("*", requirePlatformAdmin);

// GET /admin/storage — current shared-storage-account config (no secrets).
adminRoutes.get("/storage", async (c) => {
  const row = await getDb(c.env)
    .select()
    .from(schema.storageAccounts)
    .where(eq(schema.storageAccounts.id, STORAGE_ACCOUNT_ID))
    .get();

  return c.json({
    connected: row?.status === "connected",
    status: row?.status ?? "disconnected",
    email: row?.email ?? null,
    rootFolderId: row?.rootFolderId ?? null,
    updatedAt: row?.updatedAt ?? null,
  });
});

// POST /admin/storage/connect/start — build the Google OAuth URL (PKCE, offline).
// The admin completes consent signed in as the STORAGE account (e.g. the 5TB gmail).
adminRoutes.post("/storage/connect/start", async (c) => {
  const clientId = c.env?.GOOGLE_CLIENT_ID;
  const appUrl = c.env?.APP_URL ?? "";
  if (!clientId) return c.json({ error: "oauth_not_configured" }, 503);

  const codeVerifier = generateRandom(32);
  const codeChallenge = await sha256Base64url(codeVerifier);
  const state = generateRandom(16);

  // Tagged purpose so the storage callback never accepts a login-flow state.
  await c.env.KV.put(
    `oauth:storage_state:${state}`,
    JSON.stringify({ codeVerifier, purpose: "storage_connect" }),
    { expirationTtl: PKCE_TTL_SECS },
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/api/admin/storage/connect/callback`,
    response_type: "code",
    scope: [
      "openid",
      "email",
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

// GET /admin/storage/connect/callback — OAuth redirect handler for the storage
// account. Top-level GET → the Lax session cookie rides, so the platform-admin
// guard above still applies. Stores the refresh token in KV, creates a root
// folder, and upserts the storage_accounts config row.
adminRoutes.get("/storage/connect/callback", async (c) => {
  const appUrl = c.env?.APP_URL ?? "";
  const redirect = (path: string) => c.redirect(`${appUrl}${path}`);

  const code = c.req.query("code");
  const state = c.req.query("state");
  const oauthError = c.req.query("error");

  if (oauthError) return redirect(`/admin/storage?error=${encodeURIComponent(oauthError)}`);
  if (!code || !state) return redirect("/admin/storage?error=missing_params");

  const clientId = c.env?.GOOGLE_CLIENT_ID;
  const clientSecret = c.env?.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return redirect("/admin/storage?error=oauth_not_configured");

  const kvKey = `oauth:storage_state:${state}`;
  const stored = (await c.env.KV.get(kvKey, "json")) as
    | { codeVerifier: string; purpose?: string }
    | null;
  if (!stored || stored.purpose !== "storage_connect") {
    return redirect("/admin/storage?error=invalid_state");
  }
  await c.env.KV.delete(kvKey);

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${appUrl}/api/admin/storage/connect/callback`,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: stored.codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    console.error("Storage token exchange failed:", await tokenRes.text());
    return redirect("/admin/storage?error=token_exchange_failed");
  }

  const tokens = (await tokenRes.json()) as {
    id_token: string;
    access_token: string;
    refresh_token?: string;
  };

  // Without a refresh token we can't use the account long-term (Google omits it
  // unless prompt=consent + offline; re-consent fixes it).
  if (!tokens.refresh_token) {
    return redirect("/admin/storage?error=no_refresh_token");
  }

  // Resolve the connected account's email from the verified ID token.
  let email: string | null;
  try {
    const { payload } = await jwtVerify(tokens.id_token, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    });
    email = (payload["email"] as string | undefined) ?? null;
  } catch (e) {
    console.error("Storage ID token verification failed:", e);
    return redirect("/admin/storage?error=token_invalid");
  }

  // Create a root folder for all family subfolders (best-effort; non-fatal).
  let rootFolderId: string | null = null;
  try {
    rootFolderId = await createDriveFolder(tokens.access_token, "Family Vault — Storage");
  } catch (e) {
    console.error("Storage root folder creation failed:", e);
  }

  // Persist the refresh token in KV (never in D1, never to the browser) and drop
  // any stale cached access token.
  await c.env.KV.put(STORAGE_REFRESH_KEY, tokens.refresh_token);
  await c.env.KV.delete(STORAGE_ACCESS_KEY);

  const db = getDb(c.env);
  const userId = c.get("userId")!;
  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(schema.storageAccounts)
    .values({
      id: STORAGE_ACCOUNT_ID,
      provider: "google_drive",
      email,
      rootFolderId,
      status: "connected",
      connectedBy: userId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.storageAccounts.id,
      set: { email, rootFolderId, status: "connected", connectedBy: userId, updatedAt: now },
    });

  await audit(c, {
    actorUserId: userId,
    action: ACTIONS.STORAGE_CONNECTED,
    targetType: "storage_account",
    targetId: STORAGE_ACCOUNT_ID,
    meta: { email },
  });

  return redirect("/admin/storage?connected=1");
});

// GET /admin/storage/stats — live Drive quota for the connected storage account.
// Calls the Drive about.get endpoint (storageQuota field). Numbers are bytes (strings from API).
adminRoutes.get("/storage/stats", async (c) => {
  const row = await getDb(c.env)
    .select({ status: schema.storageAccounts.status })
    .from(schema.storageAccounts)
    .where(eq(schema.storageAccounts.id, STORAGE_ACCOUNT_ID))
    .get();

  if (row?.status !== "connected") {
    return c.json({ error: "storage_not_configured" }, 503);
  }

  let accessToken: string;
  try {
    accessToken = await getStorageAccessToken(c.env);
  } catch {
    return c.json({ error: "token_refresh_failed" }, 503);
  }

  const res = await fetch(
    "https://www.googleapis.com/drive/v3/about?fields=storageQuota",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!res.ok) {
    console.error("Drive about.get failed:", await res.text());
    return c.json({ error: "quota_fetch_failed" }, 502);
  }

  const { storageQuota } = (await res.json()) as {
    storageQuota: {
      limit?: string;
      usage?: string;
      usageInDrive?: string;
      usageInDriveTrash?: string;
    };
  };

  return c.json({
    limitBytes: storageQuota.limit ? parseInt(storageQuota.limit, 10) : null,
    usageBytes: storageQuota.usage ? parseInt(storageQuota.usage, 10) : null,
    usageInDriveBytes: storageQuota.usageInDrive
      ? parseInt(storageQuota.usageInDrive, 10)
      : null,
    usageInDriveTrashBytes: storageQuota.usageInDriveTrash
      ? parseInt(storageQuota.usageInDriveTrash, 10)
      : null,
  });
});

// POST /admin/storage/disconnect — clear the stored credential + mark disconnected.
adminRoutes.post("/storage/disconnect", async (c) => {
  await c.env.KV.delete(STORAGE_REFRESH_KEY);
  await c.env.KV.delete(STORAGE_ACCESS_KEY);

  const db = getDb(c.env);
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(schema.storageAccounts)
    .set({ status: "disconnected", updatedAt: now })
    .where(eq(schema.storageAccounts.id, STORAGE_ACCOUNT_ID));

  await audit(c, {
    actorUserId: c.get("userId")!,
    action: ACTIONS.STORAGE_DISCONNECTED,
    targetType: "storage_account",
    targetId: STORAGE_ACCOUNT_ID,
  });

  return c.json({ ok: true });
});
