/**
 * Shared Google OAuth token refresh for Drive + Calendar + Gmail send.
 *
 * Refresh tokens live in KV at `user:refresh_token:{userId}` (written on login).
 * Access tokens are cached at `user:access_token:{userId}` with a 5-minute
 * early-expiry buffer. Granted scopes are stored at `user:google_scopes:{userId}`.
 */

import type { Env } from "../types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export function scopesKey(userId: string): string {
  return `user:google_scopes:${userId}`;
}

export async function storeGrantedScopes(
  env: Env,
  userId: string,
  scopeString: string | undefined,
): Promise<void> {
  if (!scopeString) return;
  const scopes = scopeString.split(/\s+/).filter(Boolean);
  if (scopes.length === 0) return;
  const existingRaw = await env.KV.get(scopesKey(userId));
  let existing: string[] = [];
  if (existingRaw) {
    try {
      existing = JSON.parse(existingRaw) as string[];
    } catch {
      existing = existingRaw.split(/\s+/).filter(Boolean);
    }
  }
  await env.KV.put(scopesKey(userId), JSON.stringify([...new Set([...existing, ...scopes])]));
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
    return (
      scopes.includes(scope) ||
      scopes.includes(scope.replace("https://www.googleapis.com/auth/", ""))
    );
  } catch {
    return raw.includes(scope) || raw.includes("gmail.send");
  }
}

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

export async function clearGoogleAccessTokenCache(
  env: Env,
  userId: string,
): Promise<void> {
  await env.KV.delete(`user:access_token:${userId}`);
}

/**
 * Returns a valid Google access token for the user, refreshing if needed.
 * The token carries whatever scopes were granted at last consent (Drive +
 * Calendar + Gmail send after those scopes were added).
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

  if (scope) await storeGrantedScopes(env, userId, scope);

  await env.KV.put(cacheKey, access_token, {
    expirationTtl: Math.max(expires_in - 300, 60),
  });

  return access_token;
}
