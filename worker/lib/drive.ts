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
import { getDb, schema } from "../db/client";
import { eq } from "drizzle-orm";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

/** Single row id for the application-wide storage account config. */
export const STORAGE_ACCOUNT_ID = "default";
const STORAGE_REFRESH_KEY = "storage:refresh_token";
const STORAGE_ACCESS_KEY = "storage:access_token";

/**
 * Exchanges a refresh token for a fresh access token via Google's token endpoint.
 * Throws DriveError(502) on failure. Returns the token + its lifetime in seconds.
 */
async function refreshAccessToken(
  env: Env,
  refreshToken: string,
): Promise<{ accessToken: string; expiresIn: number }> {
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
    throw new DriveError(`Token refresh failed: ${await res.text()}`, 502);
  }

  const { access_token, expires_in } = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  return { accessToken: access_token, expiresIn: expires_in };
}

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

  const { accessToken, expiresIn } = await refreshAccessToken(env, refreshToken);

  // Cache with a 5-minute buffer so we don't use a nearly-expired token
  await env.KV.put(cacheKey, accessToken, {
    expirationTtl: Math.max(expiresIn - 300, 60),
  });

  return accessToken;
}

/**
 * Returns a valid access token for the application-wide STORAGE account (the
 * single shared Drive that holds every family's files). Refreshes + caches the
 * same way as per-owner tokens, but keyed under storage:* in KV.
 */
export async function getStorageAccessToken(env: Env): Promise<string> {
  const cached = await env.KV.get(STORAGE_ACCESS_KEY);
  if (cached) return cached;

  const refreshToken = await env.KV.get(STORAGE_REFRESH_KEY);
  if (!refreshToken) {
    throw new DriveError("Storage account not connected", 503);
  }

  const { accessToken, expiresIn } = await refreshAccessToken(env, refreshToken);
  await env.KV.put(STORAGE_ACCESS_KEY, accessToken, {
    expirationTtl: Math.max(expiresIn - 300, 60),
  });
  return accessToken;
}

/**
 * True if the shared storage account is connected (D1 row status='connected'
 * AND the OAuth client secrets are present). Gates all document Drive ops.
 */
export async function isStorageConfigured(env: Env): Promise<boolean> {
  if (!isDriveConfigured(env)) return false;
  const row = await getDb(env)
    .select({ status: schema.storageAccounts.status })
    .from(schema.storageAccounts)
    .where(eq(schema.storageAccounts.id, STORAGE_ACCOUNT_ID))
    .get();
  return row?.status === "connected";
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

export async function uploadDriveFileBytes(
  accessToken: string,
  folderId: string,
  fileName: string,
  mimeType: string,
  bytes: ArrayBuffer,
): Promise<string> {
  const metadata = JSON.stringify({
    name: fileName,
    mimeType,
    parents: [folderId],
  });
  const boundary = `fam_${crypto.randomUUID().replace(/-/g, "")}`;
  const encoder = new TextEncoder();
  const metaPart = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
  );
  const fileHeader = encoder.encode(
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const closing = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(
    metaPart.length + fileHeader.length + bytes.byteLength + closing.length,
  );
  body.set(metaPart, 0);
  body.set(fileHeader, metaPart.length);
  body.set(new Uint8Array(bytes), metaPart.length + fileHeader.length);
  body.set(closing, metaPart.length + fileHeader.length + bytes.byteLength);

  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    throw new DriveError(`Drive multipart upload failed: ${await res.text()}`, 502);
  }
  const { id } = (await res.json()) as { id: string };
  return id;
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
