/**
 * Shared Google OAuth scope names and per-user access-token refresh.
 *
 * Drive, Gmail, People, and Calendar APIs all mint access tokens from the same
 * refresh token in KV (`user:refresh_token:{userId}`). After consent we store
 * Google's reported scope list at `user:google_scopes:{userId}` (replaced, not
 * merge-forever — stale "calendar On" lied when the live token lacked it).
 */
import type { Env } from "../types";

export const GOOGLE_SCOPES = {
  openid: "openid",
  email: "email",
  profile: "profile",
  driveFile: "https://www.googleapis.com/auth/drive.file",
  contacts: "https://www.googleapis.com/auth/contacts",
  gmailSend: "https://www.googleapis.com/auth/gmail.send",
  calendarEvents: "https://www.googleapis.com/auth/calendar.events",
} as const;

export const LOGIN_SCOPES = [
  GOOGLE_SCOPES.openid,
  GOOGLE_SCOPES.email,
  GOOGLE_SCOPES.profile,
  // drive.file is non-sensitive. Do NOT put calendar.events / gmail.send /
  // contacts here — those are sensitive or restricted and make Google show
  // "unverified app" on every sign-in until the Cloud project is verified.
  GOOGLE_SCOPES.driveFile,
] as const;

export const STORAGE_CONNECT_SCOPES = [
  GOOGLE_SCOPES.openid,
  GOOGLE_SCOPES.email,
  GOOGLE_SCOPES.driveFile,
  GOOGLE_SCOPES.gmailSend,
] as const;

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function scopesKey(userId: string): string {
  return `user:google_scopes:${userId}`;
}

export function refreshKey(userId: string): string {
  return `user:refresh_token:${userId}`;
}

export function accessKey(userId: string): string {
  return `user:access_token:${userId}`;
}

/** Legacy calendar-only access-token cache. Dropped after unifying on accessKey(). */
export function gcalAccessKey(userId: string): string {
  return `user:gcal_access_token:${userId}`;
}

export async function clearUserGoogleAccessCache(env: Env, userId: string): Promise<void> {
  await env.KV.delete(accessKey(userId));
  await env.KV.delete(gcalAccessKey(userId));
}

/** Cache a freshly issued access token (post-login / Connect). */
export async function cacheUserGoogleAccessToken(
  env: Env,
  userId: string,
  accessToken: string,
  expiresInSecs?: number,
): Promise<void> {
  await env.KV.put(accessKey(userId), accessToken, {
    expirationTtl: Math.max((expiresInSecs ?? 3600) - 300, 60),
  });
}

export async function userHasRefreshToken(env: Env, userId: string): Promise<boolean> {
  return Boolean(await env.KV.get(refreshKey(userId)));
}

/**
 * Distinguish "API not enabled on the Cloud project" from a missing OAuth
 * scope. Google returns 403 for both; the body is the only signal.
 */
export function classifyGoogleApiError(
  status: number,
  body: string,
): "api_disabled" | "auth" | "other" {
  if (status === 401) return "auth";
  if (status !== 403) return "other";
  const text = body.toLowerCase();
  if (
    text.includes("accessnotconfigured") ||
    text.includes("access_not_configured") ||
    text.includes("has not been used") ||
    text.includes("is disabled") ||
    text.includes("service_disabled") ||
    text.includes("access not configured")
  ) {
    return "api_disabled";
  }
  return "auth";
}

function parseScopeString(scopeString: string | undefined): string[] {
  if (!scopeString) return [];
  return scopeString.split(/\s+/).filter(Boolean);
}

export function scopeListIncludes(scopes: string[], scope: string): boolean {
  const short = scope.replace("https://www.googleapis.com/auth/", "");
  return scopes.includes(scope) || scopes.includes(short);
}

/**
 * Replace the stored scope list with Google's reported scopes.
 * Prefer this after code exchange / token refresh so Settings cannot stay
 * "Calendar On" after Google stopped granting calendar.events.
 */
export async function replaceGrantedScopes(
  env: Env,
  userId: string,
  scopeString: string | undefined,
): Promise<void> {
  const scopes = parseScopeString(scopeString);
  if (scopes.length === 0) return;
  await env.KV.put(scopesKey(userId), JSON.stringify(scopes));
}

/** Merge scopes (login path when Google omits a full scope string). */
export async function storeGrantedScopes(
  env: Env,
  userId: string,
  scopeString: string | undefined,
): Promise<void> {
  const incoming = parseScopeString(scopeString);
  if (incoming.length === 0) return;
  const existingRaw = await env.KV.get(scopesKey(userId));
  const existing: string[] = existingRaw ? (JSON.parse(existingRaw) as string[]) : [];
  const merged = [...new Set([...existing, ...incoming])];
  await env.KV.put(scopesKey(userId), JSON.stringify(merged));
}

export async function dropGrantedScope(
  env: Env,
  userId: string,
  scope: string,
): Promise<void> {
  const raw = await env.KV.get(scopesKey(userId));
  if (!raw) return;
  try {
    const scopes = JSON.parse(raw) as string[];
    const short = scope.replace("https://www.googleapis.com/auth/", "");
    const next = scopes.filter((s) => s !== scope && s !== short);
    await env.KV.put(scopesKey(userId), JSON.stringify(next));
  } catch {
    // ignore corrupt KV
  }
}

export async function userHasScope(
  env: Env,
  userId: string,
  scope: string,
): Promise<boolean> {
  const raw = await env.KV.get(scopesKey(userId));
  if (!raw) return false;
  try {
    const scopes = JSON.parse(raw) as string[];
    return scopeListIncludes(scopes, scope);
  } catch {
    return false;
  }
}

/**
 * Calendar is "ready" only when Google reported calendar.events AND we still
 * have a refresh token to mint access tokens for writes.
 */
export async function userCalendarReady(env: Env, userId: string): Promise<boolean> {
  const [hasScope, hasRefresh] = await Promise.all([
    userHasScope(env, userId, GOOGLE_SCOPES.calendarEvents),
    userHasRefreshToken(env, userId),
  ]);
  return hasScope && hasRefresh;
}

export async function getUserGoogleAccessToken(
  env: Env,
  userId: string,
): Promise<string | null> {
  const cached = await env.KV.get(accessKey(userId));
  if (cached) return cached;

  const refreshToken = await env.KV.get(refreshKey(userId));
  if (!refreshToken || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return null;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    console.error(`[google] token refresh failed for user=${userId}: ${res.status}`);
    return null;
  }
  const body = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!body.access_token) return null;
  // Google's refresh response scope is the live grant — replace, don't merge.
  if (body.scope) await replaceGrantedScopes(env, userId, body.scope);
  await cacheUserGoogleAccessToken(env, userId, body.access_token, body.expires_in);
  return body.access_token;
}

export function extraScopesFromConnect(connect: string | undefined): string[] {
  if (!connect) return [];
  const wanted = new Set(
    connect
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const extra: string[] = [];
  if (wanted.has("contacts")) extra.push(GOOGLE_SCOPES.contacts);
  if (wanted.has("gmail")) extra.push(GOOGLE_SCOPES.gmailSend);
  if (wanted.has("calendar")) extra.push(GOOGLE_SCOPES.calendarEvents);
  return extra;
}
