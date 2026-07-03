import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Download,
  FileText,
  Lock,
  Pencil,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { ListItem } from "../components/ui/ListItem";
import { Skeleton } from "../components/ui/Skeleton";
import { api, ApiError } from "../lib/api";
import { expiryStatus } from "../lib/expiry";

interface DocumentDetailPayload {
  id: string;
  title: string;
  category: string;
  description: string | null;
  expiryDate: string | null;
  issuedDate: string | null;
  visibility: "family" | "private";
  currentFileId: string | null;
}

interface FileVersion {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  version: number;
  isCurrent: boolean;
}

function formatBytes(n: number): string {
  if (n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["document", id],
    queryFn: () => api<{ document: DocumentDetailPayload }>(`/documents/${id}`),
    retry: false,
  });

  const doc = data?.document;

  const del = useMutation({
    mutationFn: () => api(`/documents/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["documents"] });
      navigate("/documents", { replace: true });
    },
  });

  /**
   * Upload flow (Worker never sees file bytes):
   * 1. POST /files/upload-url → Drive resumable session URL
   * 2. PUT the file straight to Drive
   * 3. POST /files to record the Drive fileId + metadata in D1
   */
  async function handleUpload(file: File) {
    setUploadError("");
    setUploading(true);
    try {
      const { uploadUrl } = await api<{ uploadUrl: string }>(
        `/documents/${id}/files/upload-url`,
        {
          method: "POST",
          body: JSON.stringify({ fileName: file.name, mimeType: file.type || "application/octet-stream" }),
        },
      );

      const driveRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!driveRes.ok) throw new Error(`Drive upload failed (${driveRes.status})`);
      const driveFile = (await driveRes.json()) as { id: string };

      await api(`/documents/${id}/files`, {
        method: "POST",
        body: JSON.stringify({
          driveFileId: driveFile.id,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        }),
      });
      void qc.invalidateQueries({ queryKey: ["document", id] });
    } catch (e) {
      if (e instanceof ApiError && e.message === "drive_not_configured") {
        setUploadError(
          "File storage isn't connected yet — ask the family owner to finish Google Drive setup.",
        );
      } else {
        setUploadError((e as Error).message);
      }
    } finally {
      setUploading(false);
    }
  }

  if (isLoading) {
    return (
      <>
        <AppBar title="Document" back />
        <Page className="space-y-4" aria-busy="true">
          <Card className="space-y-3 p-5">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </Card>
        </Page>
      </>
    );
  }

  if (error || !doc) {
    return (
      <>
        <AppBar title="Document" back />
        <Page>
          <Card className="p-5 text-sm text-fg-muted">
            This document doesn't exist or you don't have access to it.
          </Card>
        </Page>
      </>
    );
  }

  const status = expiryStatus(doc.expiryDate);

  return (
    <>
      <AppBar title="Document" back />
      <Page className="space-y-5">
        <Card className="p-5">
          <div className="flex items-start gap-4">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-vault-500/10 text-vault-300">
              <FileText className="size-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-white">{doc.title}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge>{doc.category}</Badge>
                {status && <Badge tone={status.tone}>{status.label}</Badge>}
                <span className="flex items-center gap-1 text-xs text-fg-subtle">
                  {doc.visibility === "private" ? (
                    <>
                      <Lock className="size-3.5" /> Only me
                    </>
                  ) : (
                    <>
                      <Users className="size-3.5" /> Whole family
                    </>
                  )}
                </span>
              </div>
            </div>
          </div>

          {doc.description && (
            <p className="mt-4 text-sm whitespace-pre-wrap text-fg-muted">
              {doc.description}
            </p>
          )}

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              leadingIcon={<Upload className="size-4" />}
              loading={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              Upload file
            </Button>
            {doc.currentFileId ? (
              <a
                href={`/api/documents/${doc.id}/files/${doc.currentFileId}/download`}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 px-4 text-sm font-medium text-fg hover:border-line-strong"
              >
                <Download className="size-4" />
                Download
              </a>
            ) : (
              <Button variant="secondary" disabled leadingIcon={<Download className="size-4" />}>
                No file yet
              </Button>
            )}
            <Button
              variant="secondary"
              leadingIcon={<Pencil className="size-4" />}
              onClick={() => navigate(`/documents/${doc.id}/edit`)}
            >
              Edit
            </Button>
            <Button
              variant="danger"
              leadingIcon={<Trash2 className="size-4" />}
              loading={del.isPending}
              onClick={() => {
                if (window.confirm("Move this document to trash?")) del.mutate();
              }}
            >
              Delete
            </Button>
          </div>

          {uploadError && (
            <p className="mt-3 text-sm text-danger">{uploadError}</p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
              e.target.value = "";
            }}
          />
        </Card>

        <Card className="divide-y divide-line overflow-hidden">
          <ListItem
            title="Expiry date"
            trailing={
              <span className="text-sm text-fg-muted">
                {doc.expiryDate ?? "—"}
              </span>
            }
          />
          <ListItem
            title="Issued date"
            trailing={
              <span className="text-sm text-fg-muted">
                {doc.issuedDate ?? "—"}
              </span>
            }
          />
        </Card>

        <FileVersions docId={doc.id} />
      </Page>
    </>
  );
}

function FileVersions({ docId }: { docId: string }) {
  const { data } = useQuery({
    queryKey: ["document-files", docId],
    // The document GET doesn't embed versions; reuse the detail response's
    // currentFileId for the primary action and show history when present.
    queryFn: () => api<{ files: FileVersion[] }>(`/documents/${docId}/files`),
    retry: false,
  });

  const files = data?.files ?? [];
  if (files.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
        Files & versions
      </h3>
      <Card className="divide-y divide-line overflow-hidden">
        {files.map((f) => (
          <ListItem
            key={f.id}
            leading={<FileText className="size-5 text-fg-muted" />}
            title={f.fileName}
            subtitle={`v${f.version}${f.sizeBytes ? ` · ${formatBytes(f.sizeBytes)}` : ""}`}
            trailing={
              <a
                href={`/api/documents/${docId}/files/${f.id}/download`}
                className="text-vault-300"
                aria-label={`Download ${f.fileName}`}
              >
                <Download className="size-5" />
              </a>
            }
          />
        ))}
      </Card>
    </section>
  );
}
