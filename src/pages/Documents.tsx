import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, FolderOpen, Plus, Search, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { ListItem } from "../components/ui/ListItem";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { Fab } from "../components/ui/Fab";
import { Modal } from "../components/ui/Modal";
import { api } from "../lib/api";
import { expiryStatus } from "../lib/expiry";
import { useAuth } from "../context/AuthContext";
import {
  DOCUMENT_CATEGORIES,
  formatBytes,
  uploadDocumentFile,
  type DocumentSummary,
} from "../lib/documents";

function DocSkeleton() {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <Skeleton className="size-10 rounded-xl" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  DOCUMENT_CATEGORIES.map((c) => [c.value, c.label]),
);

function NewDocumentModal({
  familyId,
  open,
  onClose,
}: {
  familyId: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("other");
  const [expiryDate, setExpiryDate] = useState("");
  const [visibility, setVisibility] = useState<"family" | "private">("family");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const single = files.length === 1;

  function reset() {
    setFiles([]);
    setTitle("");
    setCategory("other");
    setExpiryDate("");
    setVisibility("family");
    setProgress(null);
    mutation.reset();
  }

  function close() {
    if (mutation.isPending) return;
    reset();
    onClose();
  }

  function onFilesPicked(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const arr = Array.from(picked);
    setFiles(arr);
    if (arr.length === 1 && !title) setTitle(stripExt(arr[0].name));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const docs = single
        ? [{ title: title.trim() || stripExt(files[0].name), file: files[0] }]
        : files.map((f) => ({ title: stripExt(f.name), file: f }));

      setProgress({ done: 0, total: docs.length });
      let firstId: string | null = null;

      for (let i = 0; i < docs.length; i++) {
        const { document } = await api<{ document: DocumentSummary }>("/documents", {
          method: "POST",
          body: JSON.stringify({
            familyId,
            title: docs[i].title,
            category,
            visibility,
            expiryDate: single && expiryDate ? expiryDate : undefined,
          }),
        });
        firstId ??= document.id;
        await uploadDocumentFile(document.id, docs[i].file);
        setProgress({ done: i + 1, total: docs.length });
      }
      return firstId;
    },
    onSuccess: (firstId) => {
      void qc.invalidateQueries({ queryKey: ["documents"] });
      void qc.invalidateQueries({ queryKey: ["family-activity"] });
      reset();
      onClose();
      if (single && firstId) navigate(`/documents/${firstId}`);
    },
  });

  return (
    <Modal open={open} onClose={close} title="Add document">
      <div className="space-y-4 pb-2">
        {/* File picker */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => onFilesPicked(e.target.files)}
        />
        {files.length === 0 ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-ink-950 px-6 py-8 text-center transition-colors hover:border-vault-500/50"
          >
            <span className="flex size-12 items-center justify-center rounded-2xl bg-vault-500/10 text-vault-300">
              <Upload className="size-6" />
            </span>
            <span className="text-sm font-medium text-fg">Choose files</span>
            <span className="text-xs text-fg-subtle">
              Photos or PDFs · select multiple to add several at once
            </span>
          </button>
        ) : (
          <div className="space-y-2">
            {files.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-xl border border-line bg-ink-950 px-3 py-2.5"
              >
                <FileText className="size-4 shrink-0 text-vault-300" />
                <span className="min-w-0 flex-1 truncate text-sm text-fg">
                  {f.name}
                </span>
                <span className="shrink-0 text-xs text-fg-subtle">
                  {formatBytes(f.size)}
                </span>
                {!mutation.isPending && (
                  <button
                    type="button"
                    aria-label="Remove file"
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="shrink-0 text-fg-subtle hover:text-danger"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            ))}
            {!mutation.isPending && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs font-medium text-vault-300 hover:text-vault-400"
              >
                + Add more
              </button>
            )}
          </div>
        )}

        {single && (
          <>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Mum's passport"
                className="w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
                Expiry date (optional)
              </label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg focus:border-vault-500 focus:outline-none"
              />
            </div>
          </>
        )}

        {files.length > 1 && (
          <p className="rounded-xl border border-line bg-ink-950 px-3.5 py-2.5 text-xs text-fg-muted">
            {files.length} files — each is saved as its own document (named from
            the filename). Add details to each one afterwards.
          </p>
        )}

        {/* Category */}
        {files.length > 0 && (
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
        )}

        {/* Visibility */}
        {files.length > 0 && (
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
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium capitalize transition-colors ${
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
        )}

        {mutation.isError && (
          <p className="text-sm text-danger">{(mutation.error as Error).message}</p>
        )}

        {progress && mutation.isPending && (
          <div className="space-y-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-vault-500 transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
            <p className="text-xs text-fg-muted">
              Uploading {progress.done} of {progress.total}…
            </p>
          </div>
        )}

        <Button
          fullWidth
          loading={mutation.isPending}
          disabled={files.length === 0}
          leadingIcon={<Upload className="size-4" />}
          onClick={() => mutation.mutate()}
        >
          {files.length > 1 ? `Upload ${files.length} documents` : "Upload document"}
        </Button>
      </div>
    </Modal>
  );
}

export function Documents() {
  const { currentFamily } = useAuth();
  const familyId = currentFamily?.id;
  const [uploadOpen, setUploadOpen] = useState(false);
  const [query, setQuery] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["documents", familyId],
    enabled: Boolean(familyId),
    queryFn: () =>
      api<{ documents: DocumentSummary[] }>(`/documents?familyId=${familyId}`),
  });

  const docs = (data?.documents ?? []).filter((d) =>
    query.trim()
      ? d.title.toLowerCase().includes(query.trim().toLowerCase())
      : true,
  );
  const hasAny = (data?.documents ?? []).length > 0;

  return (
    <>
      <AppBar title="Documents" />
      <Page className="space-y-4">
        {hasAny && (
          <div className="relative">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search documents"
              className="w-full rounded-xl border border-line bg-ink-950 py-2.5 pr-3 pl-9 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
            />
          </div>
        )}

        {isLoading ? (
          <Card className="divide-y divide-line" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <DocSkeleton key={i} />
            ))}
          </Card>
        ) : docs.length > 0 ? (
          <Card className="divide-y divide-line overflow-hidden">
            {docs.map((doc) => {
              const status = expiryStatus(doc.expiryDate);
              return (
                <ListItem
                  key={doc.id}
                  to={`/documents/${doc.id}`}
                  leading={
                    <span className="flex size-10 items-center justify-center rounded-xl bg-vault-500/10 text-vault-300">
                      <FileText className="size-5" aria-hidden="true" />
                    </span>
                  }
                  title={doc.title}
                  subtitle={CATEGORY_LABELS[doc.category] ?? doc.category}
                  trailing={
                    status ? <Badge tone={status.tone}>{status.label}</Badge> : null
                  }
                />
              );
            })}
          </Card>
        ) : hasAny ? (
          <EmptyState
            icon={Search}
            title="No matches"
            description={`Nothing matches "${query}". Try a different search.`}
          />
        ) : (
          <EmptyState
            icon={FolderOpen}
            title="No documents yet"
            description="Add your family's passports, insurance, licenses and more — and we'll remind you before they expire."
            action={
              <Button
                leadingIcon={<Plus className="size-4" />}
                onClick={() => setUploadOpen(true)}
              >
                Add document
              </Button>
            }
          />
        )}
      </Page>
      <Fab icon={Plus} label="Add document" onClick={() => setUploadOpen(true)} />
      {familyId && (
        <NewDocumentModal
          familyId={familyId}
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
        />
      )}
    </>
  );
}
