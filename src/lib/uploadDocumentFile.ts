import { api, ApiError } from "./api";
import { titleFromFileName } from "./documentTitle";

/** Stable copy when the browser cannot reach the upload API (offline / SW). */
export const DRIVE_NETWORK_ERROR =
  "Couldn’t reach Google Drive to upload this file. Check your connection and try again.";

/**
 * Map browser/network failures on the upload request into a stable message.
 * Safari/WebKit surfaces blocked fetches as TypeError("Load failed").
 */
export function mapDrivePutError(err: unknown): Error {
  if (err instanceof TypeError) {
    return new Error(DRIVE_NETWORK_ERROR);
  }
  if (err instanceof Error) return err;
  return new Error(DRIVE_NETWORK_ERROR);
}

/** Drive resumable Location URLs are always on googleapis.com (legacy direct PUT). */
export function isGoogleDriveUploadUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "www.googleapis.com" || host.endsWith(".googleapis.com");
  } catch {
    return false;
  }
}

/**
 * Camera/gallery pickers (especially iOS) often leave File.name empty.
 * Always produce a non-empty name for Drive + D1 metadata.
 */
export function resolveUploadFileName(file: File): string {
  const raw = (file.name || "").trim().split(/[/\\]/).pop() ?? "";
  if (raw.length > 0) return raw.slice(0, 500);
  const mime = file.type || "application/octet-stream";
  const ext =
    mime === "image/jpeg"
      ? ".jpg"
      : mime === "image/png"
        ? ".png"
        : mime === "image/heic" || mime === "image/heif"
          ? ".heic"
          : mime === "image/webp"
            ? ".webp"
            : mime === "application/pdf"
              ? ".pdf"
              : mime.startsWith("image/")
                ? ".img"
                : ".bin";
  return `upload-${Date.now()}${ext}`;
}

/**
 * Attach a file to an existing document via the Worker proxy.
 *
 * Browser → POST /files/content (multipart) → Worker → Drive.
 * Never PUTs to googleapis from the page (avoids CSP/CORS "Load failed").
 */
export async function uploadDocumentFile(
  documentId: string,
  file: File,
): Promise<void> {
  const fileName = resolveUploadFileName(file);
  const form = new FormData();
  // Third arg sets Content-Disposition filename even when File.name is empty.
  form.append("file", file, fileName);

  try {
    await api(`/documents/${documentId}/files/content`, {
      method: "POST",
      body: form,
    });
  } catch (err) {
    if (err instanceof TypeError) throw mapDrivePutError(err);
    if (err instanceof ApiError && err.code === "drive_reauth_required") {
      throw new ApiError(
        err.status,
        err.code,
        "Google Drive needs you to sign in again — open Settings, sign out, and sign back in with Google.",
      );
    }
    throw err;
  }
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
  const fileName = resolveUploadFileName(file);
  const title = titleFromFileName(fileName);

  let category = "other";
  try {
    const suggestion = await api<{ category: string | null }>(
      "/documents/suggest-category",
      {
        method: "POST",
        body: JSON.stringify({ title, fileName }),
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
