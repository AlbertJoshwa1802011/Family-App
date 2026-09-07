import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  FileText,
  FolderOpen,
  Lock,
  Plus,
  Search,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { inputCls } from "../lib/fieldCls";
import { api } from "../lib/api";
import { expiryStatus } from "../lib/expiry";
import { titleFromFileName } from "../lib/documentTitle";
import { createAndUploadDocument } from "../lib/uploadDocumentFile";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/cn";

/** Stay under the upload-url rate limit (30/min) with headroom for retries. */
const MAX_BATCH = 20;

interface DocumentSummary {
  id: string;
  title: string;
  category: string;
  visibility: "family" | "private";
  expiryDate?: string | null;
}

type BatchItemStatus = "pending" | "uploading" | "done" | "error";

interface BatchItem {
  key: string;
  fileName: string;
  title: string;
  status: BatchItemStatus;
  error?: string;
  documentId?: string;
}

function DocSkeleton() {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

function statusIcon(status: BatchItemStatus) {
  if (status === "done") {
    return <CheckCircle2 className="size-4 text-success" aria-hidden="true" />;
  }
  if (status === "error") {
    return <XCircle className="size-4 text-danger" aria-hidden="true" />;
  }
  if (status === "uploading") {
    return (
      <span
        className="size-4 animate-pulse rounded-full bg-vault-400"
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className="size-4 rounded-full border border-white/20"
      aria-hidden="true"
    />
  );
}

export function Documents() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeFamily } = useAuth();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [batch, setBatch] = useState<BatchItem[] | null>(null);
  const [batchError, setBatchError] = useState("");
  const [busy, setBusy] = useState(false);

  // Debounce so we don't hit the API per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ["documents", activeFamily?.id, debounced],
    // The API requires familyId and enforces family membership server-side.
    queryFn: () =>
      api<{ documents: DocumentSummary[] }>(
        `/documents?familyId=${activeFamily!.id}${
          debounced ? `&q=${encodeURIComponent(debounced)}` : ""
        }`,
      ),
    enabled: Boolean(activeFamily),
  });

  const docs = data?.documents ?? [];
  const searching = debounced.length > 0;

  async function runBatch(files: File[]) {
    if (!activeFamily) return;
    setBatchError("");
    if (files.length === 0) return;
    if (files.length > MAX_BATCH) {
      setBatchError(
        `You can upload up to ${MAX_BATCH} files at once. Selected ${files.length}.`,
      );
      return;
    }

    const items: BatchItem[] = files.map((file, i) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${i}`,
      fileName: file.name,
      title: titleFromFileName(file.name),
      status: "pending",
    }));
    setBatch(items);
    setBusy(true);

    for (let i = 0; i < files.length; i++) {
      setBatch((prev) =>
        prev
          ? prev.map((item, idx) =>
              idx === i ? { ...item, status: "uploading" } : item,
            )
          : prev,
      );
      try {
        const doc = await createAndUploadDocument(activeFamily.id, files[i]!);
        setBatch((prev) =>
          prev
            ? prev.map((item, idx) =>
                idx === i
                  ? { ...item, status: "done", documentId: doc.id }
                  : item,
              )
            : prev,
        );
      } catch (e) {
        setBatch((prev) =>
          prev
            ? prev.map((item, idx) =>
                idx === i
                  ? {
                      ...item,
                      status: "error",
                      error: (e as Error).message,
                    }
                  : item,
              )
            : prev,
        );
      }
    }

    setBusy(false);
    void qc.invalidateQueries({ queryKey: ["documents", activeFamily.id] });
  }

  // After a one-file success, open that document once the batch row has an id.
  useEffect(() => {
    if (!batch || busy || batch.length !== 1) return;
    const only = batch[0];
    if (only?.status === "done" && only.documentId) {
      navigate(`/documents/${only.documentId}`, { replace: false });
    }
  }, [batch, busy, navigate]);

  function onFilesPicked(list: FileList | null) {
    if (!list || list.length === 0) return;
    void runBatch(Array.from(list));
  }

  return (
    <>
      <AppBar
        title="Documents"
        trailing={
          <button
            type="button"
            aria-label="Upload files"
            disabled={busy || !activeFamily}
            onClick={() => fileInputRef.current?.click()}
            className="lq-press flex size-10 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-white/8 hover:text-fg disabled:opacity-40"
          >
            <Upload className="size-5" aria-hidden="true" />
          </button>
        }
      />
      <Page className="space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.heic"
          hidden
          onChange={(e) => {
            onFilesPicked(e.target.files);
            e.target.value = "";
          }}
        />

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 z-1 size-4 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, category, notes…"
            aria-label="Search documents"
            className={`${inputCls} pr-10 pl-10`}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-3 z-1 -translate-y-1/2 text-fg-subtle hover:text-fg"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {batchError && (
          <p className="text-sm text-danger" role="alert">
            {batchError}
          </p>
        )}

        {batch && (
          <Card className="space-y-3 p-4" aria-live="polite">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-fg">
                  {busy
                    ? `Uploading ${batch.filter((b) => b.status === "done").length + 1} of ${batch.length}…`
                    : `Uploaded ${batch.filter((b) => b.status === "done").length} of ${batch.length}`}
                </div>
                <p className="mt-0.5 text-xs text-fg-muted">
                  Each file becomes its own document. You can edit details
                  after.
                </p>
              </div>
              {!busy && (
                <button
                  type="button"
                  aria-label="Dismiss upload progress"
                  onClick={() => setBatch(null)}
                  className="lq-press rounded-full p-1.5 text-fg-subtle hover:text-fg"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <ul className="divide-y divide-white/8 overflow-hidden rounded-xl">
              {batch.map((item) => (
                <li
                  key={item.key}
                  className="flex min-h-11 items-center gap-3 px-1 py-2"
                >
                  {statusIcon(item.status)}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-fg">{item.title}</div>
                    {item.error ? (
                      <div className="truncate text-xs text-danger">
                        {item.error}
                      </div>
                    ) : (
                      <div className="truncate text-xs text-fg-subtle">
                        {item.fileName}
                      </div>
                    )}
                  </div>
                  {item.status === "done" && item.documentId && (
                    <button
                      type="button"
                      className="text-xs font-semibold text-vault-300"
                      onClick={() => navigate(`/documents/${item.documentId}`)}
                    >
                      Open
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!busy && (
              <Button
                variant="secondary"
                fullWidth
                leadingIcon={<Upload className="size-4" />}
                onClick={() => fileInputRef.current?.click()}
              >
                Upload more
              </Button>
            )}
          </Card>
        )}

        {isLoading ? (
          <Card className="divide-y divide-white/8" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <DocSkeleton key={i} />
            ))}
          </Card>
        ) : docs.length > 0 ? (
          <Card className="divide-y divide-white/8 overflow-hidden">
            {docs.map((doc) => {
              const status = expiryStatus(doc.expiryDate);
              return (
                <ListItem
                  key={doc.id}
                  to={`/documents/${doc.id}`}
                  leading={
                    <span className="lq lq-flat lq-tint flex size-10 items-center justify-center rounded-full text-vault-300 [--lq-tint:var(--color-vault-400)]">
                      <FileText className="size-5" aria-hidden="true" />
                    </span>
                  }
                  title={
                    // `text-overflow: ellipsis` only applies to inline text in
                    // the overflowing block, so the title text carries its own
                    // `truncate` rather than relying on ListItem's wrapper.
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{doc.title}</span>
                      {doc.visibility === "private" && (
                        <Lock
                          className="size-3.5 shrink-0 text-fg-subtle"
                          aria-label="Private"
                        />
                      )}
                    </span>
                  }
                  subtitle={doc.category}
                  trailing={
                    status ? <Badge tone={status.tone}>{status.label}</Badge> : null
                  }
                />
              );
            })}
          </Card>
        ) : searching ? (
          <EmptyState
            icon={Search}
            title="No matches"
            description={`Nothing found for "${debounced}". Try a different name or category.`}
          />
        ) : (
          <EmptyState
            icon={FolderOpen}
            title="No documents yet"
            description="Upload passports, insurance, licenses and more — pick one file or many at once."
            action={
              <div className="flex w-full flex-col gap-2">
                <Button
                  leadingIcon={<Upload className="size-4" />}
                  disabled={busy || !activeFamily}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Upload files
                </Button>
                <Button
                  variant="secondary"
                  leadingIcon={<Plus className="size-4" />}
                  onClick={() => navigate("/documents/new")}
                >
                  Add without a file
                </Button>
              </div>
            }
          />
        )}
      </Page>
      <Fab
        icon={Plus}
        label="Add document"
        className={cn(busy && "pointer-events-none opacity-40")}
        onClick={() => navigate("/documents/new")}
      />
    </>
  );
}
