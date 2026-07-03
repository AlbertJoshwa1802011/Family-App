import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  BellRing,
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
import { Avatar } from "../components/ui/Avatar";
import { ListItem } from "../components/ui/ListItem";
import { Skeleton } from "../components/ui/Skeleton";
import { api } from "../lib/api";
import { expiryStatus } from "../lib/expiry";
import { useAuth } from "../context/AuthContext";

interface DocumentDetailPayload {
  id: string;
  familyId: string;
  ownerUserId: string;
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
      setUploadError((e as Error).message);
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

        <RemindSomeone doc={doc} />

        <FileVersions docId={doc.id} />

        <Comments docId={doc.id} />
      </Page>
    </>
  );
}

interface MemberOption {
  id: string;
  userId: string | null;
  memberType: "user" | "dependent";
  displayName: string | null;
  name: string | null;
  email: string | null;
}

/** Tag a family member: they get an in-app notification + email. */
function RemindSomeone({ doc }: { doc: DocumentDetailPayload }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState("");

  const { data } = useQuery({
    queryKey: ["family-members", doc.familyId],
    queryFn: () =>
      api<{ members: MemberOption[] }>(`/families/${doc.familyId}/members`),
    enabled: open,
  });

  const remind = useMutation({
    mutationFn: (target: MemberOption) =>
      api(`/documents/${doc.id}/remind`, {
        method: "POST",
        body: JSON.stringify({
          userId: target.userId,
          note: note.trim() || undefined,
        }),
      }),
    onSuccess: (_res, target) => {
      setSentTo(target.name ?? target.email ?? "them");
      setNote("");
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  // Only user-members (not dependents, not yourself) can be reminded; private
  // docs can only nudge their owner.
  const candidates = (data?.members ?? []).filter(
    (m) =>
      m.memberType === "user" &&
      m.userId &&
      m.userId !== user?.id &&
      (doc.visibility !== "private" || m.userId === doc.ownerUserId),
  );

  return (
    <Card className="p-4">
      <button
        onClick={() => {
          setOpen((v) => !v);
          setSentTo(null);
        }}
        className="flex w-full items-center gap-2 text-sm font-medium text-fg"
      >
        <BellRing className="size-4 text-vault-300" />
        Remind a family member
      </button>

      {sentTo && (
        <p className="mt-2 text-xs text-success">
          Done — {sentTo} got a notification{" "}
          <span className="text-fg-subtle">(and an email if they have them on)</span>.
        </p>
      )}

      {open && !sentTo && (
        <div className="mt-3 space-y-3">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note — e.g. please renew this before Friday"
            maxLength={500}
            className="w-full rounded-xl border border-line bg-ink-950 px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
          />
          {candidates.length === 0 ? (
            <p className="text-xs text-fg-subtle">
              No one to remind here — invite family members first
              {doc.visibility === "private" && ", or this is a private document"}.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {candidates.map((m) => (
                <button
                  key={m.id}
                  disabled={remind.isPending}
                  onClick={() => remind.mutate(m)}
                  className="rounded-full bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-fg-muted transition-colors hover:bg-vault-600 hover:text-white disabled:opacity-50"
                >
                  {m.name ?? m.email ?? "Member"}
                </button>
              ))}
            </div>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </Card>
  );
}

interface Comment {
  id: string;
  userId: string;
  body: string;
  createdAt: number;
  authorName: string | null;
  authorPicture: string | null;
}

function Comments({ docId }: { docId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");

  const { data } = useQuery({
    queryKey: ["document-comments", docId],
    queryFn: () => api<{ comments: Comment[] }>(`/documents/${docId}/comments`),
    retry: false,
  });

  const post = useMutation({
    mutationFn: (body: string) =>
      api(`/documents/${docId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      setDraft("");
      void qc.invalidateQueries({ queryKey: ["document-comments", docId] });
    },
  });

  const remove = useMutation({
    mutationFn: (commentId: string) =>
      api(`/documents/${docId}/comments/${commentId}`, { method: "DELETE" }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["document-comments", docId] }),
  });

  const comments = data?.comments ?? [];

  return (
    <section className="space-y-2">
      <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
        Notes & comments {comments.length > 0 && `(${comments.length})`}
      </h3>
      <Card className="divide-y divide-line overflow-hidden">
        {comments.map((cm) => (
          <div key={cm.id} className="group flex items-start gap-3 px-4 py-3">
            <Avatar
              name={cm.authorName}
              email={null}
              src={cm.authorPicture}
              className="mt-0.5 size-8"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium text-fg">
                  {cm.authorName ?? "Member"}
                </span>
                <span className="text-xs text-fg-subtle">
                  {new Intl.DateTimeFormat(undefined, {
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(cm.createdAt * 1000))}
                </span>
              </div>
              <p className="mt-0.5 text-sm break-words whitespace-pre-wrap text-fg-muted">
                {cm.body}
              </p>
            </div>
            {cm.userId === user?.id && (
              <button
                onClick={() => remove.mutate(cm.id)}
                aria-label="Delete comment"
                className="hidden text-fg-subtle group-hover:block hover:text-danger"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const body = draft.trim();
            if (body && !post.isPending) post.mutate(body);
          }}
          className="flex items-center gap-2 px-4 py-3"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a note — renewal steps, where the original is…"
            aria-label="Add a comment"
            maxLength={2000}
            className="min-h-10 flex-1 rounded-xl border border-line bg-ink-950 px-3.5 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
          />
          <Button type="submit" size="md" loading={post.isPending} disabled={!draft.trim()}>
            Post
          </Button>
        </form>
      </Card>
    </section>
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
