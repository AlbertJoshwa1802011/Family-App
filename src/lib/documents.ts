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

/** Soft cap so a single picker action stays under upload rate limits. */
export const MAX_MULTI_UPLOAD = 20;

/** Matches FileUploadZone — reject oversized files before creating a document. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Derive a human document title from an uploaded file name.
 * Strips a final extension and collapses leftover whitespace / underscores.
 */
export function titleFromFileName(fileName: string): string {
  const base = fileName.trim().split(/[/\\]/).pop() ?? fileName.trim();
  const withoutExt = base.replace(/\.[^.]+$/, "");
  const cleaned = withoutExt.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || base || "Untitled document").slice(0, 300);
}

/** Lightweight filename → category guess (no AI). Unknown → other. */
export function guessCategoryFromFileName(fileName: string): string {
  const hay = fileName.toLowerCase().replace(/[_-]+/g, " ");
  if (/\b(passport|visa|aadhaar|aadhar|pan)\b/.test(hay)) return "passport";
  if (/\b(licen[cs]e|dl|driving)\b/.test(hay)) return "license";
  if (/\b(insurance|policy|mediclaim)\b/.test(hay)) return "insurance";
  if (/\b(medical|prescription|vaccine|hospital|lab)\b/.test(hay)) return "medical";
  if (/\b(warranty|guarantee|amc)\b/.test(hay)) return "warranty";
  if (/\b(bank|tax|invoice|loan|statement|salary)\b/.test(hay)) return "financial";
  if (/\b(school|college|degree|diploma|transcript|marksheet)\b/.test(hay)) {
    return "education";
  }
  return "other";
}

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
      if (xhr.status === 503 && (errorCode === "r2_not_configured" || errorCode === "storage_not_configured")) {
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

export interface CreatedDocument {
  id: string;
  title: string;
  category: string;
}

/**
 * Create a document from a file (title + guessed category) and upload bytes
 * via the normal R2→Drive path.
 */
export async function createAndUploadDocument(
  file: File,
  opts?: { familyId?: string; onProgress?: (fraction: number) => void },
): Promise<CreatedDocument> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("File too large. Maximum size is 25 MB.");
  }

  const title = titleFromFileName(file.name);
  const category = guessCategoryFromFileName(file.name);
  const body: Record<string, string> = {
    title,
    category,
    visibility: "family",
  };
  if (opts?.familyId) body.familyId = opts.familyId;

  const { document } = await api<{ document: CreatedDocument }>("/documents", {
    method: "POST",
    body: JSON.stringify(body),
  });

  await uploadDocumentFile(document.id, file, opts?.onProgress);
  return document;
}
