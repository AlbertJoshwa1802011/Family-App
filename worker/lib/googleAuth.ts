/**
 * Shared Google OAuth token refresh for Drive, Calendar, and Gmail.
 *
 * Refresh tokens live in KV at `user:refresh_token:{userId}` (written on login).
 * Access tokens are cached at `user:access_token:{userId}` with a 5-minute
 * early-expiry buffer. Granted scopes are stored at `user:google_scopes:{userId}`.
 */

import type { Env } from "../types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const GOOGLE_SCOPES = {
  openid: "openid",
  email: "email",
  profile: "profile",
  driveFile: "https://www.googleapis.com/auth/drive.file",
  calendarEvents: "https://www.googleapis.com/auth/calendar.events",
  gmailSend: "https://www.googleapis.com/auth/gmail.send",
} as const;

/** Scopes requested on every login (non-sensitive + calendar). */
export const LOGIN_SCOPES = [
  GOOGLE_SCOPES.openid,
  GOOGLE_SCOPES.email,
  GOOGLE_SCOPES.profile,
  GOOGLE_SCOPES.driveFile,
  GOOGLE_SCOPES.calendarEvents,
] as const;

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export function isGoogleOAuthConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function scopesKey(userId: string): string {
  return `user:google_scopes:${userId}`;
}

export function scopeListIncludes(scopes: string[], scope: string): boolean {
  const short = scope.replace("https://www.googleapis.com/auth/", "");
  return scopes.includes(scope) || scopes.includes(short);
}

function parseScopeString(scopeString: string | undefined | null): string[] {
  if (!scopeString) return [];
  return scopeString.split(/\s+/).filter(Boolean);
}

/** Replace stored scopes with Google's reported grant (prefer after code exchange). */
export async function replaceGrantedScopes(
  env: Env,
  userId: string,
  scopeString: string | undefined | null,
): Promise<void> {
  const scopes = parseScopeString(scopeString);
  if (scopes.length === 0) return;
  await env.KV.put(scopesKey(userId), JSON.stringify(scopes));
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

/** Extra scopes from `?connect=gmail,calendar` (comma-separated). */
export function extraScopesFromConnect(connect: string | undefined): string[] {
  if (!connect) return [];
  const wanted = new Set(
    connect
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const extra: string[] = [];
  if (wanted.has("gmail")) extra.push(GOOGLE_SCOPES.gmailSend);
  if (wanted.has("calendar")) extra.push(GOOGLE_SCOPES.calendarEvents);
  return extra;
}

/**
 * Classify Google API errors so callers can tell "enable the API in Cloud
 * Console" apart from a missing OAuth scope / expired grant.
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

export async function clearGoogleAccessTokenCache(
  env: Env,
  userId: string,
): Promise<void> {
  await env.KV.delete(`user:access_token:${userId}`);
}

/**
 * Returns a valid Google access token for the user, refreshing if needed.
 * The token carries whatever scopes were granted at last consent.
 */
export async function getGoogleAccessToken(
  env: Env,
  userId: string,
): Promise<string> {
  const cacheKey = `user:access_token:${userId}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) return cached;

  const refreshToken = await env.KV.get(`user:refresh_token:${userId}`);
  if (!refreshToken) {
    throw new GoogleAuthError(
      "No refresh token — user must re-authenticate with Google",
      503,
    );
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new GoogleAuthError("Google OAuth is not configured", 503);
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
    const body = await res.text();
    throw new GoogleAuthError(`Token refresh failed: ${body}`, 502);
  }

  const { access_token, expires_in, scope } = (await res.json()) as {
    access_token: string;
    expires_in: number;
    scope?: string;
  };

  if (scope) await replaceGrantedScopes(env, userId, scope);

  await env.KV.put(cacheKey, access_token, {
    expirationTtl: Math.max(expires_in - 300, 60),
  });

  return access_token;
}

/** Like getGoogleAccessToken but returns null instead of throwing. */
export async function getGoogleAccessTokenOrNull(
  env: Env,
  userId: string,
): Promise<string | null> {
  try {
    return await getGoogleAccessToken(env, userId);
  } catch {
    return null;
  }
}
