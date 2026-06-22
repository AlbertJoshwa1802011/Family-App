import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Lock, Paperclip, Upload, Users, X } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Skeleton } from "../components/ui/Skeleton";
import { cn } from "../lib/cn";
import { api, ApiError } from "../lib/api";
import { CATEGORIES } from "../lib/categories";
import { attachFileToDocument, formatBytes, type UploadProgress } from "../lib/upload";
import { useAuth } from "../context/AuthContext";

interface DocumentRecord {
  id: string;
  familyId: string;
  title: string;
  category: string;
  description?: string | null;
  expiryDate?: string | null;
  issuedDate?: string | null;
  subjectMemberId?: string | null;
  visibility: "family" | "private";
}

interface Member {
  id: string;
  name?: string | null;
  displayName?: string | null;
}

interface Initial {
  title: string;
  category: string;
  description: string;
  expiryDate: string;
  issuedDate: string;
  subjectMemberId: string;
  visibility: "family" | "private";
}

const EMPTY: Initial = {
  title: "",
  category: "other",
  description: "",
  expiryDate: "",
  issuedDate: "",
  subjectMemberId: "",
  visibility: "family",
};

const inputCls =
  "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-vault-500/60 focus:ring-2 focus:ring-vault-400/30";
const labelCls = "mb-1.5 block text-xs font-semibold tracking-wide text-fg-subtle uppercase";

/** Outer loader: for edit mode it waits for the record, then mounts the form
 *  with concrete initial values (so the inner form can init state without an
 *  effect — avoids react-hooks/set-state-in-effect). */
export function DocumentForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);

  const { data: membersData } = useQuery({
    queryKey: ["family-members"],
    queryFn: () => api<{ members: Member[] }>("/families/me/members"),
  });

  const { data: existing, isLoading } = useQuery({
    queryKey: ["document", id],
    queryFn: () => api<{ document: DocumentRecord }>(`/documents/${id}`),
    enabled: isEdit,
  });

  if (isEdit && isLoading) {
    return (
      <>
        <AppBar title="Edit document" back />
        <Page className="space-y-4">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </Page>
      </>
    );
  }

  const d = existing?.document;
  const initial: Initial = d
    ? {
        title: d.title,
        category: d.category,
        description: d.description ?? "",
        expiryDate: d.expiryDate ?? "",
        issuedDate: d.issuedDate ?? "",
        subjectMemberId: d.subjectMemberId ?? "",
        visibility: d.visibility,
      }
    : EMPTY;

  return (
    <FormFields
      key={id ?? "new"}
      docId={id}
      isEdit={isEdit}
      initial={initial}
      members={membersData?.members ?? []}
    />
  );
}

function FormFields({
  docId,
  isEdit,
  initial,
  members,
}: {
  docId?: string;
  isEdit: boolean;
  initial: Initial;
  members: Member[];
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { families } = useAuth();
  const familyId = families[0]?.id;

  const [title, setTitle] = useState(initial.title);
  const [category, setCategory] = useState(initial.category);
  const [description, setDescription] = useState(initial.description);
  const [expiryDate, setExpiryDate] = useState(initial.expiryDate);
  const [issuedDate, setIssuedDate] = useState(initial.issuedDate);
  const [subjectMemberId, setSubjectMemberId] = useState(initial.subjectMemberId);
  const [visibility, setVisibility] = useState<"family" | "private">(initial.visibility);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function pickFile(f: File | null) {
    setFile(f);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Please give the document a title.");
      return;
    }
    if (!familyId) {
      setError("No family found. Create a family first.");
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      familyId,
      title: title.trim(),
      category,
      description: description.trim() || undefined,
      expiryDate: expiryDate || undefined,
      issuedDate: issuedDate || undefined,
      subjectMemberId: subjectMemberId || undefined,
      visibility,
    };

    try {
      let id = docId;
      if (isEdit && id) {
        await api(`/documents/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        const res = await api<{ document: { id: string } }>("/documents", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        id = res.document.id;
      }

      if (file && id) {
        setProgress({ loaded: 0, total: file.size, pct: 0 });
        await attachFileToDocument(id, file, setProgress);
      }

      await qc.invalidateQueries({ queryKey: ["documents"] });
      if (id) await qc.invalidateQueries({ queryKey: ["document", id] });
      navigate(id ? `/documents/${id}` : "/documents", { replace: true });
    } catch (err) {
      const msg =
        err instanceof ApiError && err.message === "drive_not_configured"
          ? "File storage isn't connected yet — the document was saved without the file."
          : err instanceof Error
            ? err.message
            : "Something went wrong.";
      setError(msg);
      setProgress(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <AppBar title={isEdit ? "Edit document" : "Add document"} back />
      <Page>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files?.[0]) pickFile(e.dataTransfer.files[0]);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-7 text-center transition-colors",
              dragging
                ? "border-vault-500 bg-vault-500/10"
                : "border-line hover:border-line-strong",
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div className="flex w-full items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-vault-500/15 text-vault-300">
                  <Paperclip className="size-5" />
                </span>
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-medium text-fg">{file.name}</div>
                  <div className="text-xs text-fg-muted">{formatBytes(file.size)}</div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    pickFile(null);
                  }}
                  className="flex size-8 items-center justify-center rounded-full text-fg-muted hover:bg-white/5"
                  aria-label="Remove file"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <>
                <span className="flex size-11 items-center justify-center rounded-2xl bg-vault-500/10 text-vault-300">
                  <Upload className="size-5" />
                </span>
                <div className="mt-2 text-sm font-medium text-fg">
                  Tap to upload or drop a file
                </div>
                <div className="text-xs text-fg-muted">PDF, image or any document</div>
              </>
            )}
          </div>

          {progress && (
            <div>
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

          <div>
            <label className={labelCls} htmlFor="doc-title">
              Title
            </label>
            <input
              id="doc-title"
              className={inputCls}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Maya's passport"
              autoFocus={!isEdit}
            />
          </div>

          <div>
            <label className={labelCls} htmlFor="doc-category">
              Category
            </label>
            <select
              id="doc-category"
              className={inputCls}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="doc-expiry">
                Expiry date
              </label>
              <input
                id="doc-expiry"
                type="date"
                className={inputCls}
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="doc-issued">
                Issued date
              </label>
              <input
                id="doc-issued"
                type="date"
                className={inputCls}
                value={issuedDate}
                onChange={(e) => setIssuedDate(e.target.value)}
              />
            </div>
          </div>

          {members.length > 0 && (
            <div>
              <label className={labelCls} htmlFor="doc-member">
                Belongs to
              </label>
              <select
                id="doc-member"
                className={inputCls}
                value={subjectMemberId}
                onChange={(e) => setSubjectMemberId(e.target.value)}
              >
                <option value="">Whole family</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name ?? m.displayName ?? "Member"}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className={labelCls} htmlFor="doc-desc">
              Notes
            </label>
            <textarea
              id="doc-desc"
              className={cn(inputCls, "min-h-20 resize-y")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional notes…"
            />
          </div>

          <Card className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-xl bg-vault-500/10 text-vault-300">
                {visibility === "private" ? (
                  <Lock className="size-4" />
                ) : (
                  <Users className="size-4" />
                )}
              </span>
              <div>
                <div className="text-sm font-medium text-fg">
                  {visibility === "private" ? "Private" : "Family"}
                </div>
                <div className="text-xs text-fg-muted">
                  {visibility === "private"
                    ? "Only you can see this"
                    : "Everyone in the family can see this"}
                </div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={visibility === "private"}
              aria-label="Toggle private visibility"
              onClick={() =>
                setVisibility((v) => (v === "private" ? "family" : "private"))
              }
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                visibility === "private" ? "bg-vault-600" : "bg-white/10",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-5 rounded-full bg-white transition-transform",
                  visibility === "private" ? "translate-x-5" : "translate-x-0.5",
                )}
              />
            </button>
          </Card>

          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
              {error}
            </div>
          )}

          <Button type="submit" fullWidth size="lg" loading={saving}>
            {isEdit ? "Save changes" : "Add document"}
          </Button>
        </form>
      </Page>
    </>
  );
}
