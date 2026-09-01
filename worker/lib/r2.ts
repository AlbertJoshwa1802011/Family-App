/**
 * Cloudflare R2 helpers for document file storage.
 *
 * Primary store for small important docs (passports, insurance PDFs, etc.).
 * Google Drive remains an optional/legacy path.
 */

/** Soft cap for multipart uploads through the Worker (bytes). */
export const R2_MAX_BYTES = 25 * 1024 * 1024;

/** Strip path separators / control chars so object keys stay predictable. */
export function safeFileName(name: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, " ").trim();
  const clipped = base.slice(0, 180);
  return clipped.length > 0 ? clipped : "file";
}

/**
 * Object key layout:
 *   families/{familyId}/documents/{documentId}/{fileId}/{safeFileName}
 */
export function buildR2Key(opts: {
  familyId: string;
  documentId: string;
  fileId: string;
  fileName: string;
}): string {
  return `families/${opts.familyId}/documents/${opts.documentId}/${opts.fileId}/${safeFileName(opts.fileName)}`;
}

export function isR2Configured(env: { FILES?: R2Bucket }): boolean {
  return !!env.FILES;
}

export async function putObject(
  bucket: R2Bucket,
  key: string,
  body: ArrayBuffer | ReadableStream | Blob | string | null,
  opts?: { contentType?: string; customMetadata?: Record<string, string> },
): Promise<R2Object> {
  return bucket.put(key, body, {
    httpMetadata: opts?.contentType
      ? { contentType: opts.contentType }
      : undefined,
    customMetadata: opts?.customMetadata,
  });
}

export async function getObject(
  bucket: R2Bucket,
  key: string,
): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

export async function deleteObject(
  bucket: R2Bucket,
  key: string,
): Promise<void> {
  await bucket.delete(key);
}
