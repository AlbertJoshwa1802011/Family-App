import { api } from "./api";

export interface DocumentSummary {
  id: string;
  familyId: string;
  ownerUserId: string;
  title: string;
  category: string;
  description: string | null;
  expiryDate: string | null;
  issuedDate: string | null;
  currentFileId: string | null;
  visibility: "family" | "private";
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface FileVersion {
  id: string;
  documentId: string;
  storageProvider?: "r2" | "drive";
  r2Key?: string | null;
  driveFileId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  version: number;
  isCurrent: boolean;
  createdAt: number;
}

export interface DocComment {
  id: string;
  userId: string;
  authorName: string | null;
  authorPicture: string | null;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export const DOCUMENT_CATEGORIES = [
  { value: "passport", label: "Passport" },
  { value: "license", label: "License" },
  { value: "insurance", label: "Insurance" },
  { value: "medical", label: "Medical" },
  { value: "warranty", label: "Warranty" },
  { value: "financial", label: "Financial" },
  { value: "education", label: "Education" },
  { value: "other", label: "Other" },
] as const;

export function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Uploads a single file to an existing document.
 * Prefers R2 (`POST /documents/:id/files/upload`). When the FILES binding is
 * absent (R2 not enabled on the Cloudflare account yet), falls back to the
 * Google Drive resumable flow automatically.
 * `onProgress` receives 0..1 for the byte-transfer phase.
 */
export async function uploadDocumentFile(
  docId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const mimeType = file.type || "application/octet-stream";

  const r2Result = await new Promise<"ok" | "r2_missing">((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/documents/${docId}/files/upload`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve("ok");
        return;
      }
      let errorCode = "";
      let message = `Upload failed (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText) as {
          error?: string;
          message?: string;
        };
        errorCode = body.error ?? "";
        message = body.message ?? body.error ?? message;
      } catch {
        // keep default
      }
      if (xhr.status === 503 && errorCode === "r2_not_configured") {
        resolve("r2_missing");
        return;
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    const form = new FormData();
    form.append("file", file);
    form.append("contentType", mimeType);
    xhr.send(form);
  });

  if (r2Result === "ok") return;
  await uploadDocumentFileViaDrive(docId, file, onProgress);
}

/** Drive path — used automatically when R2 is not bound; also callable directly. */
export async function uploadDocumentFileViaDrive(
  docId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const mimeType = file.type || "application/octet-stream";

  const { uploadUrl } = await api<{ uploadUrl: string }>(
    `/documents/${docId}/files/upload-url`,
    { method: "POST", body: JSON.stringify({ fileName: file.name, mimeType }) },
  );

  const driveFileId = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", mimeType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText) as { id: string };
          resolve(body.id);
        } catch {
          reject(new Error("Drive returned an unexpected response"));
        }
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });

  await api(`/documents/${docId}/files`, {
    method: "POST",
    body: JSON.stringify({
      driveFileId,
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
    }),
  });
}
