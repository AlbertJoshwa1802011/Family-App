/**
 * Google Drive API helpers for Family Vault.
 *
 * Access token flow: owner's refresh token lives in KV at user:refresh_token:{userId}.
 * Access tokens are cached in KV at user:access_token:{userId} with a 5-minute early
 * expiry buffer to handle clock skew.
 *
 * All file uploads use a two-step pattern:
 * 1. Call createResumableUploadUrl() to get a Drive upload URL.
 * 2. The *client* uploads directly to that URL (bypassing the Worker memory limit).
 * 3. Call recordFileMeta() to store the Drive fileId + metadata in D1.
 *
 * Downloads are proxied through the Worker (streams, no buffering) so we can
 * enforce auth and add Content-Disposition: attachment.
 */

import type { Env } from "../types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

/**
 * Returns a valid Drive access token for the given owner, refreshing if the
 * cached token is expired or absent.
 */
export async function getDriveAccessToken(env: Env, ownerId: string): Promise<string> {
  const cacheKey = `user:access_token:${ownerId}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) return cached;

  const refreshToken = await env.KV.get(`user:refresh_token:${ownerId}`);
  if (!refreshToken) {
    throw new DriveError("No refresh token — owner must re-authenticate", 503);
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new DriveError(`Token refresh failed: ${body}`, 502);
  }

  const { access_token, expires_in } = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  // Cache with a 5-minute buffer so we don't use a nearly-expired token
  await env.KV.put(cacheKey, access_token, {
    expirationTtl: Math.max(expires_in - 300, 60),
  });

  return access_token;
}

/**
 * Creates a Drive folder and returns its ID.
 */
export async function createDriveFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<string> {
  const body: Record<string, unknown> = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) body.parents = [parentId];

  const res = await fetch(DRIVE_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new DriveError(`Create folder failed: ${await res.text()}`, 502);

  const { id } = (await res.json()) as { id: string };
  return id;
}

/**
 * Initiates a resumable upload session and returns the upload URL.
 * The client should upload the file directly to this URL; the Worker
 * never sees the file bytes (avoids Worker memory limits).
 */
export async function createResumableUploadUrl(
  accessToken: string,
  folderId: string,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=resumable`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Type": mimeType,
    },
    body: JSON.stringify({ name: fileName, mimeType, parents: [folderId] }),
  });

  if (!res.ok) throw new DriveError(`Resumable upload init failed: ${await res.text()}`, 502);

  const location = res.headers.get("Location");
  if (!location) throw new DriveError("Drive did not return Location header", 502);
  return location;
}

/**
 * Proxies a Drive file download. The caller must stream the response body;
 * the file content is never fully buffered in the Worker.
 */
export async function downloadDriveFile(
  accessToken: string,
  driveFileId: string,
): Promise<Response> {
  const res = await fetch(`${DRIVE_API}/${driveFileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new DriveError(`Drive download failed: ${res.status}`, 502);
  return res;
}

/**
 * Permanently deletes a Drive file. Non-fatal: if the file doesn't exist (404),
 * the error is silently swallowed (already gone is fine for our purposes).
 */
export async function deleteDriveFile(
  accessToken: string,
  driveFileId: string,
): Promise<void> {
  const res = await fetch(`${DRIVE_API}/${driveFileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    console.warn(`Drive delete non-fatal error ${res.status}: ${await res.text()}`);
  }
}

export class DriveError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

/** Returns true if Drive is usable (required secrets are present). */
export function isDriveConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
