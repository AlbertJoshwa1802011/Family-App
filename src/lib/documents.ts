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
  driveFileId: string;
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
 * Uploads a single file to an existing document via the resumable Drive flow:
 *   1. ask the Worker for a Drive resumable session URL,
 *   2. PUT the bytes directly to Drive (the Worker never sees them),
 *   3. record the resulting file metadata in D1.
 * `onProgress` receives 0..1 for the byte-transfer phase.
 */
export async function uploadDocumentFile(
  docId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const mimeType = file.type || "application/octet-stream";

  const { uploadUrl } = await api<{ uploadUrl: string }>(
    `/documents/${docId}/files/upload-url`,
    { method: "POST", body: JSON.stringify({ fileName: file.name, mimeType }) },
  );

  // Direct cross-origin PUT to Google Drive. Use XHR for progress events.
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
