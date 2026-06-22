import { api } from "./api";

export interface UploadProgress {
  loaded: number;
  total: number;
  pct: number;
}

/**
 * Uploads file bytes directly to a Google Drive resumable-upload session URL.
 * The Worker never sees the bytes (it only issued the signed session URL), which
 * sidesteps the Worker request-size limit. Uses XMLHttpRequest for real upload
 * progress events (fetch() can't report upload progress in browsers yet).
 */
export function uploadToDriveUrl(
  uploadUrl: string,
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream",
    );
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({
          loaded: e.loaded,
          total: e.total,
          pct: Math.round((e.loaded / e.total) * 100),
        });
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as { id: string });
        } catch {
          reject(new Error("Drive returned an unexpected response"));
        }
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(file);
  });
}

/**
 * Full attach flow for an existing document:
 *  1. ask the Worker for a Drive resumable upload URL,
 *  2. PUT the bytes straight to Drive (with progress),
 *  3. record the new file/version in D1.
 */
export async function attachFileToDocument(
  documentId: string,
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<void> {
  const mimeType = file.type || "application/octet-stream";

  const { uploadUrl } = await api<{ uploadUrl: string }>(
    `/documents/${documentId}/files/upload-url`,
    {
      method: "POST",
      body: JSON.stringify({ fileName: file.name, mimeType }),
    },
  );

  const { id: driveFileId } = await uploadToDriveUrl(uploadUrl, file, onProgress);

  await api(`/documents/${documentId}/files`, {
    method: "POST",
    body: JSON.stringify({
      driveFileId,
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
    }),
  });
}

/** Human-readable byte size (e.g. 2.4 MB). */
export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const val = bytes / Math.pow(1024, i);
  return `${val >= 10 || i === 0 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}
