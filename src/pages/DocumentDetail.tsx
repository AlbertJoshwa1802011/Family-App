import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileText,
  Lock,
  MessageSquare,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Avatar } from "../components/ui/Avatar";
import { Skeleton } from "../components/ui/Skeleton";
import { Modal } from "../components/ui/Modal";
import { api } from "../lib/api";
import { expiryStatus } from "../lib/expiry";
import {
  DOCUMENT_CATEGORIES,
  formatBytes,
  uploadDocumentFile,
  type DocComment,
  type DocumentSummary,
  type FileVersion,
} from "../lib/documents";

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  DOCUMENT_CATEGORIES.map((c) => [c.value, c.label]),
);

function fmtDate(unixOrIso: number | string | null): string {
  if (!unixOrIso) return "—";
  const d =
    typeof unixOrIso === "number"
      ? new Date(unixOrIso * 1000)
      : new Date(`${unixOrIso}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function EditModal({
  doc,
  open,
  onClose,
}: {
  doc: DocumentSummary;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(doc.title);
  const [category, setCategory] = useState(doc.category);
  const [expiryDate, setExpiryDate] = useState(doc.expiryDate ?? "");
  const [visibility, setVisibility] = useState(doc.visibility);

  const mutation = useMutation({
    mutationFn: () =>
      api(`/documents/${doc.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: title.trim(),
          category,
          expiryDate: expiryDate || undefined,
          visibility,
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["document", doc.id] });
      void qc.invalidateQueries({ queryKey: ["documents"] });
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Edit document">
      <div className="space-y-4 pb-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg focus:border-vault-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-2 block text-xs font-semibold text-fg-muted">
            Category
          </label>
          <div className="flex flex-wrap gap-2">
            {DOCUMENT_CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategory(c.value)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  category === c.value
                    ? "bg-vault-600 text-white"
                    : "bg-white/5 text-fg-muted hover:bg-white/10"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
            Expiry date
          </label>
          <input
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            className="w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg focus:border-vault-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-2 block text-xs font-semibold text-fg-muted">
            Visibility
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(["family", "private"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVisibility(v)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                  visibility === v
                    ? "border-vault-500 bg-vault-600/15 text-vault-300"
                    : "border-line bg-ink-950 text-fg-muted hover:border-line-strong"
                }`}
              >
                {v === "family" ? "Whole family" : "Private"}
              </button>
            ))}
          </div>
        </div>
        {mutation.isError && (
          <p className="text-sm text-danger">{(mutation.error as Error).message}</p>
        )}
        <Button fullWidth loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Save changes
        </Button>
      </div>
    </Modal>
  );
}

function Comments({ docId }: { docId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const { data } = useQuery({
    queryKey: ["doc-comments", docId],
    queryFn: () => api<{ comments: DocComment[] }>(`/documents/${docId}/comments`),
  });
  const comments = data?.comments ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      api(`/documents/${docId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: body.trim() }),
      }),
    onSuccess: () => {
      setBody("");
      void qc.invalidateQueries({ queryKey: ["doc-comments", docId] });
    },
  });

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
        <MessageSquare className="size-3.5" />
        Notes ({comments.length})
      </h3>
      <Card className="space-y-3 p-4">
        {comments.length > 0 && (
          <div className="space-y-3">
            {comments.map((cm) => (
              <div key={cm.id} className="flex gap-2.5">
                <Avatar
                  name={cm.authorName}
                  src={cm.authorPicture}
                  className="size-7"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-fg">
                    {cm.authorName ?? "Member"}{" "}
                    <span className="font-normal text-fg-subtle">
                      · {fmtDate(cm.createdAt)}
                    </span>
                  </p>
                  <p className="text-sm text-fg-muted">{cm.body}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) mutation.mutate();
          }}
        >
          <input
            type="text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a note…"
            className="flex-1 rounded-xl border border-line bg-ink-950 px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
          />
          <Button
            type="submit"
            loading={mutation.isPending}
            disabled={!body.trim()}
          >
            Post
          </Button>
        </form>
      </Card>
    </section>
  );
}

export function DocumentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [uploadingVersion, setUploadingVersion] = useState(false);

  const { data: docData, isLoading } = useQuery({
    queryKey: ["document", id],
    enabled: Boolean(id),
    queryFn: () => api<{ document: DocumentSummary }>(`/documents/${id}`),
  });
  const { data: filesData } = useQuery({
    queryKey: ["document-files", id],
    enabled: Boolean(id),
    queryFn: () => api<{ files: FileVersion[] }>(`/documents/${id}/files`),
  });

  const doc = docData?.document;
  const files = filesData?.files ?? [];

  const deleteMutation = useMutation({
    mutationFn: () => api(`/documents/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["documents"] });
      navigate("/documents", { replace: true });
    },
  });

  async function onNewVersion(picked: FileList | null) {
    if (!picked?.[0] || !id) return;
    setUploadingVersion(true);
    try {
      await uploadDocumentFile(id, picked[0]);
      void qc.invalidateQueries({ queryKey: ["document-files", id] });
      void qc.invalidateQueries({ queryKey: ["document", id] });
    } finally {
      setUploadingVersion(false);
    }
  }

  function download(fileId: string) {
    // Same-origin GET; the session cookie authorizes it. Attachment disposition
    // is set server-side, so this triggers a download rather than navigation.
    window.open(`/api/documents/${id}/files/${fileId}/download`, "_blank");
  }

  if (isLoading) {
    return (
      <>
        <AppBar title="Document" back />
        <Page className="space-y-5">
          <Card className="space-y-3 p-5">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </Card>
        </Page>
      </>
    );
  }

  if (!doc) {
    return (
      <>
        <AppBar title="Document" back />
        <Page>
          <Card className="p-6 text-center text-sm text-fg-muted">
            This document couldn't be found.
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
        {/* Header */}
        <Card className="p-5">
          <div className="flex items-start gap-4">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-vault-500/10 text-vault-300">
              <FileText className="size-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-white">{doc.title}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge tone="neutral">
                  {CATEGORY_LABELS[doc.category] ?? doc.category}
                </Badge>
                {doc.visibility === "private" && (
                  <Badge tone="warning">
                    <Lock className="size-3" /> Private
                  </Badge>
                )}
                {status && <Badge tone={status.tone}>{status.label}</Badge>}
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              leadingIcon={<Pencil className="size-4" />}
              onClick={() => setEditOpen(true)}
            >
              Edit
            </Button>
            <Button
              variant="danger"
              leadingIcon={<Trash2 className="size-4" />}
              loading={deleteMutation.isPending}
              onClick={() => {
                if (confirm("Move this document to trash?")) deleteMutation.mutate();
              }}
            >
              Delete
            </Button>
          </div>
        </Card>

        {/* Metadata */}
        <Card className="divide-y divide-line overflow-hidden">
          <Row label="Expiry date" value={doc.expiryDate ? fmtDate(doc.expiryDate) : "—"} />
          <Row label="Issued date" value={doc.issuedDate ? fmtDate(doc.issuedDate) : "—"} />
          <Row
            label="Visibility"
            value={doc.visibility === "private" ? "Private to me" : "Whole family"}
          />
          {doc.description && <Row label="Notes" value={doc.description} />}
        </Card>

        {/* Files & versions */}
        <section className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              Files {files.length > 0 && `· ${files.length}`}
            </h3>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              onChange={(e) => onNewVersion(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingVersion}
              className="flex items-center gap-1 text-xs font-medium text-vault-300 hover:text-vault-400 disabled:opacity-50"
            >
              <Upload className="size-3.5" />
              {uploadingVersion ? "Uploading…" : "New version"}
            </button>
          </div>
          {files.length === 0 ? (
            <Card className="p-5 text-center text-sm text-fg-muted">
              No file attached yet. Use “New version” to add one.
            </Card>
          ) : (
            <Card className="divide-y divide-line overflow-hidden">
              {files.map((f) => (
                <div
                  key={f.id}
                  className="flex min-h-14 items-center gap-3 px-4 py-3"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-vault-500/10 text-vault-300">
                    <FileText className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">
                      {f.fileName}
                    </p>
                    <p className="text-xs text-fg-subtle">
                      v{f.version} · {formatBytes(f.sizeBytes)} · {fmtDate(f.createdAt)}
                      {f.isCurrent && " · current"}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Download"
                    onClick={() => download(f.id)}
                    className="flex size-9 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-white/5 hover:text-fg active:scale-95"
                  >
                    <Download className="size-4" />
                  </button>
                </div>
              ))}
            </Card>
          )}
        </section>

        <Comments docId={doc.id} />
      </Page>

      <EditModal doc={doc} open={editOpen} onClose={() => setEditOpen(false)} />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="shrink-0 text-sm text-fg-muted">{label}</span>
      <span className="text-right text-sm text-fg">{value}</span>
    </div>
  );
}
