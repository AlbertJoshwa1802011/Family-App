import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  CalendarClock,
  Download,
  FileText,
  Lock,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ListItem } from "../components/ui/ListItem";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { Avatar } from "../components/ui/Avatar";
import { api } from "../lib/api";
import { expiryStatus } from "../lib/expiry";
import { categoryMeta } from "../lib/categories";
import { attachFileToDocument, formatBytes, type UploadProgress } from "../lib/upload";

interface DocumentRecord {
  id: string;
  title: string;
  category: string;
  description?: string | null;
  expiryDate?: string | null;
  issuedDate?: string | null;
  currentFileId?: string | null;
  visibility: "family" | "private";
}

interface FileRecord {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  version: number;
  isCurrent: boolean;
  createdAt: number;
}

interface Comment {
  id: string;
  body: string;
  createdAt: number;
  authorName?: string | null;
  authorPicture?: string | null;
}

export function DocumentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [comment, setComment] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["document", id],
    queryFn: () => api<{ document: DocumentRecord }>(`/documents/${id}`),
  });
  const doc = data?.document;

  const { data: filesData } = useQuery({
    queryKey: ["document-files", id],
    queryFn: () => api<{ files: FileRecord[] }>(`/documents/${id}/files`),
    enabled: Boolean(id),
  });
  const files = filesData?.files ?? [];

  const { data: commentsData } = useQuery({
    queryKey: ["document-comments", id],
    queryFn: () => api<{ comments: Comment[] }>(`/documents/${id}/comments`),
    enabled: Boolean(id),
  });
  const comments = commentsData?.comments ?? [];

  const del = useMutation({
    mutationFn: () => api(`/documents/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["documents"] });
      navigate("/documents", { replace: true });
    },
  });

  const addComment = useMutation({
    mutationFn: (body: string) =>
      api(`/documents/${id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    onSuccess: async () => {
      setComment("");
      await qc.invalidateQueries({ queryKey: ["document-comments", id] });
    },
  });

  async function uploadNewVersion(file: File) {
    if (!id) return;
    setProgress({ loaded: 0, total: file.size, pct: 0 });
    try {
      await attachFileToDocument(id, file, setProgress);
      await qc.invalidateQueries({ queryKey: ["document-files", id] });
      await qc.invalidateQueries({ queryKey: ["document", id] });
    } finally {
      setProgress(null);
    }
  }

  if (isLoading || !doc) {
    return (
      <>
        <AppBar title="Document" back />
        <Page className="space-y-4">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </Page>
      </>
    );
  }

  const status = expiryStatus(doc.expiryDate);
  const cat = categoryMeta(doc.category);
  const Icon = cat.icon;
  const current = files.find((f) => f.isCurrent) ?? files[0];

  return (
    <>
      <AppBar title="Document" back />
      <Page className="space-y-5">
        <Card className="p-5">
          <div className="flex items-start gap-4">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-vault-500/10 text-vault-300">
              <Icon className="size-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg leading-snug font-semibold text-fg">
                {doc.title}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge tone="vault">{cat.label}</Badge>
                {doc.visibility === "private" && (
                  <Badge tone="neutral">
                    <Lock className="mr-1 inline size-3" />
                    Private
                  </Badge>
                )}
                {status && <Badge tone={status.tone}>{status.label}</Badge>}
              </div>
            </div>
          </div>

          {doc.description && (
            <p className="mt-4 text-sm leading-relaxed whitespace-pre-wrap text-fg-muted">
              {doc.description}
            </p>
          )}

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              leadingIcon={<Download className="size-4" />}
              disabled={!current}
              onClick={() => {
                if (current)
                  window.location.href = `/api/documents/${id}/files/${current.id}/download`;
              }}
            >
              Download
            </Button>
            <Link to={`/documents/${id}/edit`} className="contents">
              <Button variant="secondary" leadingIcon={<Pencil className="size-4" />} fullWidth>
                Edit
              </Button>
            </Link>
            <label className="contents">
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadNewVersion(f);
                }}
              />
              <Button
                variant="secondary"
                leadingIcon={<Plus className="size-4" />}
                fullWidth
                type="button"
                onClick={(e) =>
                  (e.currentTarget.previousElementSibling as HTMLInputElement)?.click()
                }
              >
                New version
              </Button>
            </label>
            <Button
              variant="danger"
              leadingIcon={<Trash2 className="size-4" />}
              loading={del.isPending}
              onClick={() => {
                if (confirm("Move this document to trash?")) del.mutate();
              }}
            >
              Delete
            </Button>
          </div>

          {progress && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-fg-muted">
                <span>Uploading…</span>
                <span className="tabular-nums">{progress.pct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-vault-500 transition-all"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
            </div>
          )}
        </Card>

        {/* Metadata */}
        <Card className="divide-y divide-line overflow-hidden">
          <ListItem
            leading={<CalendarClock className="size-5 text-fg-muted" />}
            title="Expiry date"
            trailing={
              <span className="text-sm text-fg-muted">{doc.expiryDate ?? "—"}</span>
            }
          />
          <ListItem
            leading={<CalendarClock className="size-5 text-fg-muted" />}
            title="Issued date"
            trailing={
              <span className="text-sm text-fg-muted">{doc.issuedDate ?? "—"}</span>
            }
          />
          <ListItem
            leading={
              doc.visibility === "private" ? (
                <Lock className="size-5 text-fg-muted" />
              ) : (
                <Users className="size-5 text-fg-muted" />
              )
            }
            title="Visibility"
            trailing={
              <span className="text-sm text-fg-muted capitalize">
                {doc.visibility}
              </span>
            }
          />
        </Card>

        {/* Files / versions */}
        <section className="space-y-2">
          <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            Files &amp; versions
          </h3>
          {files.length > 0 ? (
            <Card className="divide-y divide-line overflow-hidden">
              {files.map((f) => (
                <ListItem
                  key={f.id}
                  leading={
                    <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-fg-muted">
                      <FileText className="size-5" />
                    </span>
                  }
                  title={f.fileName}
                  subtitle={`v${f.version} · ${formatBytes(f.sizeBytes)}`}
                  trailing={
                    <a
                      href={`/api/documents/${id}/files/${f.id}/download`}
                      className="flex size-9 items-center justify-center rounded-full text-fg-muted hover:bg-white/5"
                      aria-label={`Download ${f.fileName}`}
                    >
                      <Download className="size-4" />
                    </a>
                  }
                />
              ))}
            </Card>
          ) : (
            <Card className="px-4 py-3 text-sm text-fg-subtle">
              No file attached yet. Use “New version” to upload one.
            </Card>
          )}
        </section>

        {/* Comments */}
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            <MessageSquare className="size-3.5" /> Comments
          </h3>
          <Card className="divide-y divide-line overflow-hidden">
            {comments.map((cm) => (
              <div key={cm.id} className="flex gap-3 px-4 py-3">
                <Avatar name={cm.authorName} src={cm.authorPicture} className="size-8" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-fg">
                    {cm.authorName ?? "Someone"}
                  </div>
                  <div className="text-sm whitespace-pre-wrap text-fg-muted">
                    {cm.body}
                  </div>
                </div>
              </div>
            ))}
            <div className="flex items-center gap-2 px-3 py-2.5">
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && comment.trim())
                    addComment.mutate(comment.trim());
                }}
                placeholder="Add a comment…"
                className="flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-vault-500/60"
              />
              <button
                onClick={() => comment.trim() && addComment.mutate(comment.trim())}
                disabled={!comment.trim() || addComment.isPending}
                aria-label="Send comment"
                className="flex size-9 items-center justify-center rounded-full bg-vault-600 text-white disabled:opacity-40"
              >
                <Send className="size-4" />
              </button>
            </div>
          </Card>
        </section>
      </Page>
    </>
  );
}
