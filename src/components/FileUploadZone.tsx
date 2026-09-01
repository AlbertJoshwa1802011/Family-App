/**
 * FileUploadZone — drag-and-drop or click-to-upload file uploader.
 *
 * Upload flow (Drive resumable upload — worker never sees file bytes):
 * 1. POST /documents/:docId/files/upload-url { fileName, mimeType }
 *    → server generates a Drive resumable upload session URL
 * 2. PUT the file bytes directly to the Drive URL (XHR for progress)
 * 3. POST /documents/:docId/files { driveFileId, fileName, mimeType, sizeBytes }
 *    → record the file metadata in D1
 */
import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CloudUpload, File, X, CheckCircle2, AlertCircle } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { cn } from "../lib/cn";
import { useAuth } from "../context/AuthContext";

interface Props {
  documentId: string;
  onSuccess: () => void;
}

type UploadState = "idle" | "uploading" | "success" | "error";

const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "image/gif": "GIF",
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "text/plain": "TXT",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUploadZone({ documentId, onSuccess }: Props) {
  const { user } = useAuth();
  const [state, setState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [storageNotConfigured, setStorageNotConfigured] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError("");
      setSelectedFile(file);

      if (file.size > 50 * 1024 * 1024) {
        setError("File too large. Maximum size is 50 MB.");
        return;
      }

      setState("uploading");
      setProgress(0);

      try {
        // Step 1: Get Drive resumable upload URL
        const { uploadUrl } = await api<{ uploadUrl: string }>(
          `/documents/${documentId}/files/upload-url`,
          {
            method: "POST",
            body: JSON.stringify({ fileName: file.name, mimeType: file.type || "application/octet-stream" }),
          },
        );

        // Step 2: Upload file directly to Drive using XHR for progress tracking
        const driveFileId = await new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadUrl);
          xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              setProgress(Math.round((e.loaded / e.total) * 90));
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              // Drive returns the file metadata as JSON with 'id'
              try {
                const resp = JSON.parse(xhr.responseText) as { id?: string };
                if (resp.id) {
                  resolve(resp.id);
                } else {
                  // Some resumable upload responses have the ID in headers
                  const loc = xhr.getResponseHeader("Location") ?? "";
                  const match = loc.match(/\/([^/]+)$/);
                  resolve(match?.[1] ?? "unknown");
                }
              } catch {
                resolve("unknown");
              }
            } else {
              reject(new Error(`Upload failed: ${xhr.statusText}`));
            }
          };

          xhr.onerror = () => reject(new Error("Network error during upload"));
          xhr.send(file);
        });

        setProgress(95);

        // Step 3: Record the file in D1
        await api(`/documents/${documentId}/files`, {
          method: "POST",
          body: JSON.stringify({
            driveFileId,
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
          }),
        });

        setProgress(100);
        setState("success");
        onSuccess();
      } catch (e) {
        const isStorageErr =
          e instanceof ApiError && e.message === "storage_not_configured";
        setStorageNotConfigured(isStorageErr);
        setError(
          isStorageErr
            ? user?.isPlatformAdmin
              ? "Google Drive storage is not configured yet."
              : "Google Drive storage is not configured yet. Please contact the family admin. Ask them to connect Google Drive under Admin → Storage."
            : e instanceof Error
            ? e.message
            : "Upload failed. Please try again.",
        );
        setState("error");
        setProgress(0);
      }
    },
    [documentId, onSuccess, user?.isPlatformAdmin],
  );

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  }

  function reset() {
    setState("idle");
    setSelectedFile(null);
    setError("");
    setStorageNotConfigured(false);
    setProgress(0);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept={Object.keys(ALLOWED_TYPES).join(",")}
        onChange={onInputChange}
        className="sr-only"
        id="file-upload-input"
        aria-label="Upload file"
      />

      {state === "idle" || state === "error" ? (
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop a file here or click to select"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all cursor-pointer",
            isDragging
              ? "border-vault-500 bg-vault-500/10"
              : "border-line hover:border-vault-500/50 hover:bg-white/3",
          )}
        >
          <div className={cn("flex size-14 items-center justify-center rounded-2xl", isDragging ? "bg-vault-500/15 text-vault-400" : "bg-white/5 text-fg-subtle")}>
            <CloudUpload className="size-7" />
          </div>
          <div>
            <p className="text-sm font-semibold text-fg">
              Drop file here or <span className="text-vault-400">browse</span>
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              PDF, images, Word, Excel — max 50 MB
            </p>
          </div>
        </div>
      ) : null}

      {/* Progress */}
      {state === "uploading" && selectedFile && (
        <div className="rounded-2xl border border-line bg-surface p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-vault-500/15 text-vault-400">
              <File className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">{selectedFile.name}</p>
              <p className="text-xs text-fg-muted">{formatBytes(selectedFile.size)}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-fg-muted">
              <span>Uploading…</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-vault-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Success */}
      {state === "success" && selectedFile && (
        <div className="flex items-center gap-3 rounded-2xl border border-success/30 bg-success/8 p-4">
          <CheckCircle2 className="size-5 shrink-0 text-success" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">{selectedFile.name}</p>
            <p className="text-xs text-fg-muted">{formatBytes(selectedFile.size)} — uploaded successfully</p>
          </div>
          <button onClick={reset} className="text-fg-subtle hover:text-fg-muted">
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* Error */}
      {state === "error" && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3">
          <AlertCircle className="size-4 shrink-0 mt-0.5 text-danger" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-danger">{error}</p>
            {storageNotConfigured && user?.isPlatformAdmin && (
              <Link
                to="/admin/storage"
                className="mt-1 inline-block text-xs font-medium text-vault-300 underline hover:text-vault-200"
              >
                Open Admin → Storage
              </Link>
            )}
            <button
              onClick={reset}
              className="mt-1 block text-xs text-fg-muted underline hover:text-fg"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
