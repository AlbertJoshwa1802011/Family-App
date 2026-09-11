import { api } from "./api";
import { titleFromFileName } from "./documentTitle";

/** Stable copy when the browser cannot reach Google Drive (CSP / offline / CORS). */
export const DRIVE_NETWORK_ERROR =
  "Couldn’t reach Google Drive to upload this file. Check your connection and try again.";

/**
 * Map browser/network failures on the Drive PUT into a stable message.
 * Safari/WebKit surfaces CSP `connect-src` blocks as TypeError("Load failed").
 */
export function mapDrivePutError(err: unknown): Error {
  if (err instanceof TypeError) {
    return new Error(DRIVE_NETWORK_ERROR);
  }
  if (err instanceof Error) return err;
  return new Error(DRIVE_NETWORK_ERROR);
}

/** Drive resumable Location URLs are always on googleapis.com. */
export function isGoogleDriveUploadUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "www.googleapis.com" || host.endsWith(".googleapis.com");
  } catch {
    return false;
  }
}

/**
 * Attach a file to an existing document.
 *
 * Worker never sees file bytes:
 * 1. POST /files/upload-url → Drive resumable session URL
 * 2. PUT the file straight to Drive (requires CSP connect-src googleapis)
 * 3. POST /files to record Drive fileId + metadata in D1
 */
export async function uploadDocumentFile(
  documentId: string,
  file: File,
): Promise<void> {
  const mimeType = file.type || "application/octet-stream";
  const { uploadUrl } = await api<{ uploadUrl: string }>(
    `/documents/${documentId}/files/upload-url`,
    {
      method: "POST",
      body: JSON.stringify({ fileName: file.name, mimeType }),
    },
  );

  if (!isGoogleDriveUploadUrl(uploadUrl)) {
    throw new Error(
      "Upload URL was not a Google Drive address — refusing to send the file.",
    );
  }

  let driveRes: Response;
  try {
    driveRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: file,
    });
  } catch (err) {
    throw mapDrivePutError(err);
  }

  if (!driveRes.ok) {
    throw new Error(`Drive upload failed (${driveRes.status})`);
  }
  const driveFile = (await driveRes.json()) as { id: string };
  if (!driveFile?.id) {
    throw new Error("Drive upload succeeded but returned no file id");
  }

  await api(`/documents/${documentId}/files`, {
    method: "POST",
    body: JSON.stringify({
      driveFileId: driveFile.id,
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
    }),
  });
}

export interface CreatedDocument {
  id: string;
  title: string;
  category: string;
}

/**
 * Create a document from a file (title from filename) and upload bytes.
 * Category comes from /documents/suggest-category when available.
 */
export async function createAndUploadDocument(
  familyId: string,
  file: File,
): Promise<CreatedDocument> {
  const title = titleFromFileName(file.name);

  let category = "other";
  try {
    const suggestion = await api<{ category: string | null }>(
      "/documents/suggest-category",
      {
        method: "POST",
        body: JSON.stringify({ title, fileName: file.name }),
      },
    );
    if (suggestion.category) category = suggestion.category;
  } catch {
    // Suggestion is best-effort — uploads must not fail if AI/heuristics flake.
  }

  const { document } = await api<{ document: CreatedDocument }>("/documents", {
    method: "POST",
    body: JSON.stringify({
      familyId,
      title,
      category,
      visibility: "family",
    }),
  });

  await uploadDocumentFile(document.id, file);
  return document;
}
