/**
 * FileUploadZone — drag-and-drop or click-to-upload.
 *
 * Prefers R2 multipart; automatically falls back to Google Drive when the
 * FILES binding is absent (R2 pending enablement on the Cloudflare account).
 */
import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CloudUpload, File, X, CheckCircle2, AlertCircle } from "lucide-react";
import { ApiError } from "../lib/api";
import { cn } from "../lib/cn";
import { useAuth } from "../context/AuthContext";
import { formatBytes, uploadDocumentFile } from "../lib/documents";

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

const MAX_BYTES = 25 * 1024 * 1024;

export function FileUploadZone({ documentId, onSuccess }: Props) {
  const { user } = useAuth();
  const [state, setState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [storagePending, setStoragePending] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError("");
      setStoragePending(false);
      setSelectedFile(file);

      if (file.size > MAX_BYTES) {
        setError("File too large. Maximum size is 25 MB.");
        return;
      }

      setState("uploading");
      setProgress(0);

      try {
        await uploadDocumentFile(documentId, file, (fraction) => {
          setProgress(Math.round(fraction * 100));
        });
        setProgress(100);
        setState("success");
        onSuccess();
      } catch (e) {
        const code = e instanceof ApiError ? e.code : "";
        const isPending =
          code === "storage_not_configured" ||
          code === "r2_not_configured" ||
          (e instanceof Error &&
            /storage_not_configured|r2_not_configured/i.test(e.message));
        setStoragePending(isPending);
        setError(
          isPending
            ? user?.isPlatformAdmin
              ? "File storage is not connected. Open Settings → Storage and connect the family Google Drive (the Gmail that holds files). Cloudflare R2 is optional."
              : "File storage is not ready yet. Ask a family admin to connect Google Drive under Settings → Storage."
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
    setStoragePending(false);
    setProgress(0);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-muted">
        Prefers Family Vault cloud (R2) when enabled; otherwise Google Drive.
      </p>
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
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all cursor-pointer",
            isDragging
              ? "border-vault-500 bg-vault-500/10"
              : "border-line hover:border-vault-500/50 hover:bg-white/3",
          )}
        >
          <div
            className={cn(
              "flex size-14 items-center justify-center rounded-2xl",
              isDragging
                ? "bg-vault-500/15 text-vault-400"
                : "bg-white/5 text-fg-subtle",
            )}
          >
            <CloudUpload className="size-7" />
          </div>
          <div>
            <p className="text-sm font-semibold text-fg">
              Drop file here or <span className="text-vault-400">browse</span>
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              PDF, images, Word, Excel — max 25 MB
            </p>
          </div>
        </div>
      ) : null}

      {state === "uploading" && selectedFile && (
        <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-vault-500/15 text-vault-400">
              <File className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">
                {selectedFile.name}
              </p>
              <p className="text-xs text-fg-muted">
                {formatBytes(selectedFile.size)}
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-fg-muted">
              <span>Uploading…</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-vault-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {state === "success" && selectedFile && (
        <div className="flex items-center gap-3 rounded-2xl border border-success/30 bg-success/8 p-4">
          <CheckCircle2 className="size-5 shrink-0 text-success" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">{selectedFile.name}</p>
            <p className="text-xs text-fg-muted">
              {formatBytes(selectedFile.size)} — uploaded successfully
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="text-fg-subtle hover:text-fg-muted"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {state === "error" && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-danger">{error}</p>
            {storagePending && user?.isPlatformAdmin && (
              <Link
                to="/admin/storage"
                className="mt-1 inline-block text-xs font-medium text-vault-300 underline hover:text-vault-200"
              >
                Open Admin → Storage
              </Link>
            )}
            <button
              type="button"
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
