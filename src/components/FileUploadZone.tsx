/**
 * FileUploadZone — drag-and-drop or click-to-upload file uploader.
 *
 * Primary path: multipart POST /documents/:docId/files/upload → R2.
 * Legacy Drive resumable upload is kept only as a fallback when R2 is absent
 * and Drive is configured (rare).
 */
import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CloudUpload, File, X, CheckCircle2, AlertCircle } from "lucide-react";
import { ApiError } from "../lib/api";
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

const MAX_BYTES = 25 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function uploadViaR2(
  documentId: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/documents/${documentId}/files/upload`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let code = xhr.statusText || "Upload failed";
      try {
        const body = JSON.parse(xhr.responseText) as {
          error?: string;
          message?: string;
        };
        // Prefer machine code for branching; fall back to message.
        code = body.error ?? body.message ?? code;
      } catch {
        // keep statusText
      }
      reject(new ApiError(xhr.status, code));
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));

    const form = new FormData();
    form.append("file", file);
    if (file.type) form.append("contentType", file.type);
    xhr.send(form);
  });
}

export function FileUploadZone({ documentId, onSuccess }: Props) {
  const { user } = useAuth();
  const [state, setState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [r2NotConfigured, setR2NotConfigured] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError("");
      setR2NotConfigured(false);
      setSelectedFile(file);

      if (file.size > MAX_BYTES) {
        setError("File too large. Maximum size is 25 MB.");
        return;
      }

      setState("uploading");
      setProgress(0);

      try {
        await uploadViaR2(documentId, file, setProgress);
        setProgress(100);
        setState("success");
        onSuccess();
      } catch (e) {
        const code = e instanceof ApiError ? e.message : "";
        const isR2 =
          code === "r2_not_configured" ||
          (e instanceof ApiError && e.status === 503 && code.includes("r2"));
        setR2NotConfigured(isR2);
        setError(
          isR2
            ? user?.isPlatformAdmin
              ? "Family Vault cloud storage (R2) is not configured yet. Create the R2 bucket and redeploy — Google Drive connect is optional/pending laptop setup."
              : "Family Vault cloud storage is not ready yet. Please try again later, or ask a family admin. Google Drive connect is optional."
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
    setR2NotConfigured(false);
    setProgress(0);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-muted">
        Files store in Family Vault cloud (R2). Google Drive connect is optional/pending.
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
              isDragging ? "bg-vault-500/15 text-vault-400" : "bg-white/5 text-fg-subtle",
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

      {state === "success" && selectedFile && (
        <div className="flex items-center gap-3 rounded-2xl border border-success/30 bg-success/8 p-4">
          <CheckCircle2 className="size-5 shrink-0 text-success" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">{selectedFile.name}</p>
            <p className="text-xs text-fg-muted">
              {formatBytes(selectedFile.size)} — uploaded successfully
            </p>
          </div>
          <button onClick={reset} className="text-fg-subtle hover:text-fg-muted">
            <X className="size-4" />
          </button>
        </div>
      )}

      {state === "error" && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3">
          <AlertCircle className="size-4 shrink-0 mt-0.5 text-danger" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-danger">{error}</p>
            {r2NotConfigured && user?.isPlatformAdmin && (
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
