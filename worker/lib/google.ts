/**
 * Shared Google OAuth scope names and per-user access-token refresh.
 *
 * Drive, Gmail, and People API all mint access tokens from the same refresh
 * token in KV (`user:refresh_token:{userId}`). After incremental consent we
 * store the granted scope list at `user:google_scopes:{userId}`.
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
  GOOGLE_SCOPES.driveFile,
  GOOGLE_SCOPES.calendarEvents,
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

export async function storeGrantedScopes(
  env: Env,
  userId: string,
  scopeString: string | undefined,
): Promise<void> {
  if (!scopeString) return;
  const scopes = scopeString.split(/\s+/).filter(Boolean);
  if (scopes.length === 0) return;
  const existingRaw = await env.KV.get(scopesKey(userId));
  const existing: string[] = existingRaw ? (JSON.parse(existingRaw) as string[]) : [];
  const merged = [...new Set([...existing, ...scopes])];
  await env.KV.put(scopesKey(userId), JSON.stringify(merged));
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
    return scopes.includes(scope) || scopes.includes(scope.replace("https://www.googleapis.com/auth/", ""));
  } catch {
    return false;
  }
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
  if (body.scope) await storeGrantedScopes(env, userId, body.scope);
  await env.KV.put(accessKey(userId), body.access_token, {
    expirationTtl: Math.max((body.expires_in ?? 3600) - 300, 60),
  });
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
