/**
 * DocumentDetail — full document view with file management and comments.
 *
 * Features:
 * - Document metadata display with expiry badges
 * - File upload (FileUploadZone → R2 multipart → record in D1)
 * - File version history with download links
 * - Comments (list + add + delete own)
 */
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  CalendarDays,
  Download,
  FileText,
  MessageSquare,
  Pencil,
  Send,
  Trash2,
  User,
  Clock,
  Tag,
  Eye,
  Lock,
  AlertCircle,
} from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Skeleton } from "../components/ui/Skeleton";
import { Avatar } from "../components/ui/Avatar";
import { FileUploadZone } from "../components/FileUploadZone";
import { api, ApiError } from "../lib/api";
import { expiryStatus } from "../lib/expiry";
import { useAuth } from "../context/AuthContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocumentFull {
  id: string;
  title: string;
  category: string;
  description: string | null;
  expiryDate: string | null;
  issuedDate: string | null;
  visibility: "family" | "private";
  ownerUserId: string;
  status: string;
  currentFileId: string | null;
  familyId: string;
  createdAt: number;
  updatedAt: number;
}

interface DocumentFile {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  version: number;
  isCurrent: boolean;
  status: string;
  createdAt: number;
}

interface DocComment {
  id: string;
  userId: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  authorName: string | null;
  authorPicture: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CATEGORY_EMOJI: Record<string, string> = {
  passport: "🛂",
  national_id: "🪪",
  license: "🚗",
  insurance: "🛡️",
  medical: "🏥",
  vaccination: "💉",
  tax: "📑",
  vehicle: "🚙",
  property: "🏠",
  warranty: "🔧",
  education: "🎓",
  financial: "💰",
  legal: "⚖️",
  other: "📄",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTimestamp(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// File list
// ---------------------------------------------------------------------------

function FileRow({
  file,
  docId,
}: {
  file: DocumentFile;
  docId: string;
}) {
  const downloadUrl = `/api/documents/${docId}/files/${file.id}/download`;
  return (
    <a
      href={downloadUrl}
      download={file.fileName}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-white/5 active:bg-white/10"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-info/15 text-info">
        <FileText className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{file.fileName}</p>
        <p className="text-xs text-fg-muted">
          v{file.version} · {formatBytes(file.sizeBytes)} ·{" "}
          {formatDate(new Date(file.createdAt * 1000).toISOString().slice(0, 10))}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {file.isCurrent && (
          <Badge tone="success">Current</Badge>
        )}
        <Download className="size-4 shrink-0 text-fg-subtle" />
      </div>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Comments section
// ---------------------------------------------------------------------------

function Comments({ docId }: { docId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [submitError, setSubmitError] = useState("");

  const { data } = useQuery({
    queryKey: ["doc-comments", docId],
    queryFn: () =>
      api<{ comments: DocComment[] }>(`/documents/${docId}/comments`),
    select: (d) => d.comments,
  });
  const comments = data ?? [];

  const addMutation = useMutation({
    mutationFn: (b: string) =>
      api(`/documents/${docId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: b }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["doc-comments", docId] });
      setBody("");
      setSubmitError("");
    },
    onError: (e) => {
      setSubmitError(e instanceof ApiError ? e.message : "Failed to post comment");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) =>
      api(`/documents/${docId}/comments/${commentId}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["doc-comments", docId] });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    addMutation.mutate(body.trim());
  }

  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
        <MessageSquare className="size-4 text-fg-muted" />
        Comments{comments.length > 0 && ` (${comments.length})`}
      </h3>

      {/* Add comment */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment…"
          maxLength={2000}
          className="flex-1 rounded-xl bg-ink-950 px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-subtle border border-line focus:border-vault-500 focus:outline-none"
        />
        <Button
          type="submit"
          size="md"
          loading={addMutation.isPending}
          disabled={!body.trim()}
          leadingIcon={<Send className="size-4" />}
        >
          Post
        </Button>
      </form>
      {submitError && <p className="text-xs text-danger">{submitError}</p>}

      {/* Comment list */}
      {comments.length === 0 ? (
        <p className="text-sm text-fg-muted">No comments yet. Be the first!</p>
      ) : (
        <div className="space-y-3">
          {comments.map((c) => (
            <div key={c.id} className="flex gap-3">
              <Avatar
                name={c.authorName}
                src={c.authorPicture}
                className="size-8 shrink-0 mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="rounded-2xl rounded-tl-none bg-surface border border-line px-3.5 py-2.5">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-xs font-semibold text-fg">
                      {c.authorName ?? "Family member"}
                    </span>
                    <span className="text-[10px] text-fg-subtle whitespace-nowrap">
                      {formatTimestamp(c.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm text-fg-muted whitespace-pre-wrap">{c.body}</p>
                </div>
                {c.userId === user?.id && (
                  <button
                    onClick={() => deleteMutation.mutate(c.id)}
                    className="mt-1 ml-1 text-xs text-fg-subtle hover:text-danger transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DocumentDetail() {
  const { id: docId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [showUpload, setShowUpload] = useState(false);

  const { data: docData, isLoading } = useQuery({
    queryKey: ["document", docId],
    queryFn: () => api<{ document: DocumentFull }>(`/documents/${docId}`),
    enabled: Boolean(docId),
    select: (d) => d.document,
  });

  // Files list (there's no dedicated endpoint in the backend, we get them from doc detail —
  // but the backend has files as a join. For now we list by querying the files via pattern)
  // Actually the backend doesn't expose GET /documents/:id/files directly. We can
  // fetch this separately — but for now display what we know from currentFileId.
  // We'll trigger a files query via a simple helper endpoint pattern.
  const { data: filesData, refetch: refetchFiles } = useQuery({
    queryKey: ["doc-files", docId],
    queryFn: () => api<{ files: DocumentFile[] }>(`/documents/${docId}/files`),
    enabled: Boolean(docId),
  });
  const files = filesData?.files ?? [];
  const currentFile = files.find((f) => f.isCurrent);

  const trashMutation = useMutation({
    mutationFn: () =>
      api(`/documents/${docId}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["documents"] });
      navigate("/documents", { replace: true });
    },
  });

  function handleTrash() {
    if (!confirm("Move this document to trash?")) return;
    trashMutation.mutate();
  }

  if (isLoading) {
    return (
      <>
        <AppBar title="Document" back />
        <Page width="list" className="space-y-4">
          <Card className="p-5">
            <div className="flex items-start gap-4">
              <Skeleton className="size-14 rounded-2xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            </div>
          </Card>
          <Card className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-xl" />
            ))}
          </Card>
        </Page>
      </>
    );
  }

  if (!docData) {
    return (
      <>
        <AppBar title="Document" back />
        <Page>
          <div className="flex flex-col items-center py-12 gap-4 text-center">
            <AlertCircle className="size-10 text-fg-subtle" />
            <p className="text-sm text-fg-muted">Document not found.</p>
          </div>
        </Page>
      </>
    );
  }

  const doc = docData;
  const expiry = expiryStatus(doc.expiryDate);
  const emoji = CATEGORY_EMOJI[doc.category] ?? "📄";
  const isOwner = doc.ownerUserId === user?.id;

  const createdDate = new Date(doc.createdAt * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <AppBar
        title="Document"
        back
        trailing={
          isOwner ? (
            <Button
              variant="ghost"
              size="md"
              leadingIcon={<Pencil className="size-4" />}
              onClick={() => navigate(`/documents/${docId}/edit`)}
            >
              Edit
            </Button>
          ) : undefined
        }
      />
      <Page width="list" className="space-y-5">
        {/* Header */}
        <Card className="p-5">
          <div className="flex items-start gap-4">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-vault-500/10 text-3xl">
              {emoji}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-fg leading-tight">{doc.title}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone="vault">{doc.category}</Badge>
                {expiry && <Badge tone={expiry.tone}>{expiry.label}</Badge>}
                {doc.visibility === "private" && (
                  <Badge tone="neutral">
                    <Lock className="size-3" />
                    Private
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Metadata */}
        <Card className="divide-y divide-line overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <CalendarDays className="size-4 shrink-0 text-fg-muted" />
            <div className="flex-1">
              <p className="text-xs text-fg-muted">Issue date</p>
              <p className="text-sm text-fg">{formatDate(doc.issuedDate)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <Clock className="size-4 shrink-0 text-fg-muted" />
            <div className="flex-1">
              <p className="text-xs text-fg-muted">Expiry date</p>
              <p className={`text-sm ${expiry ? (expiry.tone === "danger" ? "text-danger font-semibold" : expiry.tone === "warning" ? "text-warning font-medium" : "text-fg") : "text-fg"}`}>
                {formatDate(doc.expiryDate)}
              </p>
            </div>
          </div>
          {doc.description && (
            <div className="flex items-start gap-3 px-4 py-3">
              <Tag className="size-4 shrink-0 mt-0.5 text-fg-muted" />
              <div className="flex-1">
                <p className="text-xs text-fg-muted">Description</p>
                <p className="text-sm text-fg whitespace-pre-wrap">{doc.description}</p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 px-4 py-3">
            <Eye className="size-4 shrink-0 text-fg-muted" />
            <div className="flex-1">
              <p className="text-xs text-fg-muted">Visibility</p>
              <p className="text-sm text-fg">
                {doc.visibility === "family" ? "Shared with family" : "Private to you"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <User className="size-4 shrink-0 text-fg-muted" />
            <div className="flex-1">
              <p className="text-xs text-fg-muted">Added</p>
              <p className="text-sm text-fg">{createdDate}</p>
            </div>
          </div>
        </Card>

        {/* Preview section for images/PDFs */}
        {currentFile && (
          <Card className="p-4 overflow-hidden">
            <h3 className="text-sm font-semibold text-fg flex items-center gap-2 mb-3">
              <Eye className="size-4 text-fg-muted" />
              Document Preview
            </h3>
            {currentFile.mimeType.startsWith("image/") ? (
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-line bg-ink-950/50 flex items-center justify-center">
                <img
                  src={`/api/documents/${docId}/files/${currentFile.id}/download`}
                  alt={currentFile.fileName}
                  className="max-h-full max-w-full object-contain"
                  loading="lazy"
                />
              </div>
            ) : currentFile.mimeType === "application/pdf" ? (
              <div className="flex flex-col items-center justify-center p-6 rounded-xl border border-line bg-ink-950/30 text-center gap-3">
                <div className="size-12 rounded-2xl bg-danger/10 text-danger flex items-center justify-center font-bold text-xs">
                  PDF
                </div>
                <div>
                  <p className="text-sm font-medium text-fg">{currentFile.fileName}</p>
                  <p className="text-xs text-fg-muted mt-1">PDF Document · Click below to view or download</p>
                </div>
                <a
                  href={`/api/documents/${docId}/files/${currentFile.id}/download`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-vault-600 px-4 py-2 text-xs font-semibold text-white hover:bg-vault-700 transition-colors"
                >
                  <Eye className="size-3.5" />
                  View PDF
                </a>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-6 rounded-xl border border-line bg-ink-950/30 text-center gap-3">
                <div className="size-12 rounded-2xl bg-vault-500/10 text-vault-400 flex items-center justify-center">
                  <FileText className="size-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-fg">{currentFile.fileName}</p>
                  <p className="text-xs text-fg-muted mt-1">File preview not available for this format</p>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Files section */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <h3 className="text-sm font-semibold text-fg flex items-center gap-2">
              <FileText className="size-4 text-fg-muted" />
              Files
              {doc.currentFileId && (
                <span className="text-xs text-fg-muted font-normal">(1 file)</span>
              )}
            </h3>
            <Button
              variant="ghost"
              size="md"
              onClick={() => setShowUpload((s) => !s)}
            >
              {showUpload ? "Cancel" : "Upload file"}
            </Button>
          </div>

          {showUpload && (
            <div className="p-4 border-b border-line">
              <FileUploadZone
                documentId={docId!}
                onSuccess={() => {
                  setShowUpload(false);
                  void refetchFiles();
                  void qc.invalidateQueries({ queryKey: ["document", docId] });
                }}
              />
            </div>
          )}

          {!doc.currentFileId && !showUpload ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-fg-muted mb-3">No files uploaded yet.</p>
              <Button
                variant="secondary"
                size="md"
                onClick={() => setShowUpload(true)}
              >
                Upload the document file
              </Button>
            </div>
          ) : files.length > 0 ? (
            <div className="divide-y divide-line">
              {files.map((file) => (
                <FileRow key={file.id} file={file} docId={docId!} />
              ))}
            </div>
          ) : doc.currentFileId ? (
            <div className="px-4 py-4">
              <p className="text-xs text-fg-muted">
                A file is attached. Use the download button above, or upload a new version below.
              </p>
              <a
                href={`/api/documents/${docId}/files/${doc.currentFileId}/download`}
                download
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-white/5"
              >
                <Download className="size-4" />
                Download current file
              </a>
            </div>
          ) : null}
        </Card>

        {/* Comments */}
        <Card className="p-4">
          <Comments docId={docId!} />
        </Card>

        {/* Danger zone */}
        {isOwner && (
          <Button
            variant="danger"
            fullWidth
            leadingIcon={<Trash2 className="size-4" />}
            loading={trashMutation.isPending}
            onClick={handleTrash}
          >
            Move to trash
          </Button>
        )}
      </Page>
    </>
  );
}
