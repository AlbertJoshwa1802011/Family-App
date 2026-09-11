/**
 * Google Drive API helpers for Family Vault.
 *
 * Access token flow: owner's refresh token lives in KV at user:refresh_token:{userId}.
 * Access tokens are cached in KV at user:access_token:{userId} with a 5-minute early
 * expiry buffer to handle clock skew.
 *
 * Preferred upload path (avoids browser→Drive CORS / CSP):
 * 1. Browser POSTs bytes to the Worker (`POST /documents/:id/files/content`).
 * 2. Worker calls uploadFileToDrive() (resumable init + PUT) with the owner's token.
 * 3. Worker records Drive fileId + metadata in D1.
 *
 * Legacy: createResumableUploadUrl() still exists for clients that PUT directly
 * to Drive (requires CSP connect-src googleapis). Prefer the Worker proxy.
 *
 * Downloads are proxied through the Worker (streams, no buffering) so we can
 * enforce auth and add Content-Disposition: attachment.
 */

import type { Env } from "../types";
import { getGoogleAccessToken, GoogleAuthError, isGoogleOAuthConfigured } from "./googleAuth";

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

/**
 * Returns a valid Drive access token for the given owner, refreshing if the
 * cached token is expired or absent.
 */
export async function getDriveAccessToken(env: Env, ownerId: string): Promise<string> {
  try {
    return await getGoogleAccessToken(env, ownerId);
  } catch (e) {
    if (e instanceof GoogleAuthError) {
      throw new DriveError(e.message, e.statusCode);
    }
    throw e;
  }
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
 * Legacy browser-direct PUT path — prefer uploadFileToDrive() so the Worker
 * owns both steps and the browser never talks to googleapis.
 */
export async function createResumableUploadUrl(
  accessToken: string,
  folderId: string,
  fileName: string,
  mimeType: string,
  opts?: { contentLength?: number; origin?: string },
): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "X-Upload-Content-Type": mimeType,
  };
  if (opts?.contentLength != null) {
    headers["X-Upload-Content-Length"] = String(opts.contentLength);
  }
  // When a browser will PUT to the Location URL, Drive must see the page
  // Origin on session init or the subsequent cross-origin PUT fails CORS.
  if (opts?.origin) {
    headers["Origin"] = opts.origin;
  }

  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=resumable`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: fileName, mimeType, parents: [folderId] }),
  });

  if (!res.ok) throw new DriveError(`Resumable upload init failed: ${await res.text()}`, 502);

  const location = res.headers.get("Location");
  if (!location) throw new DriveError("Drive did not return Location header", 502);
  return location;
}

/**
 * Uploads file bytes to Drive via a Worker-owned resumable session.
 * Browser never contacts googleapis — avoids CSP/CORS "Load failed" on Safari.
 */
export async function uploadFileToDrive(
  accessToken: string,
  folderId: string,
  fileName: string,
  mimeType: string,
  body: BodyInit,
  sizeBytes: number,
): Promise<{ id: string }> {
  const uploadUrl = await createResumableUploadUrl(accessToken, folderId, fileName, mimeType, {
    contentLength: sizeBytes,
  });

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(sizeBytes),
    },
    body,
  });

  if (!putRes.ok) {
    throw new DriveError(`Drive upload failed: ${await putRes.text()}`, 502);
  }

  const data = (await putRes.json()) as { id?: string };
  if (!data?.id) {
    throw new DriveError("Drive upload succeeded but returned no file id", 502);
  }
  return { id: data.id };
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
  return isGoogleOAuthConfigured(env);
}
