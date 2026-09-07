import { useMemo, useRef, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  FolderOpen,
  Plus,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { ListItem } from "../components/ui/ListItem";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { Fab } from "../components/ui/Fab";
import { SectionSubNav } from "../components/ui/SectionSubNav";
import { makeTabActive, tabFromSearch } from "../lib/sectionTabs";
import { api } from "../lib/api";
import { expiryStatus } from "../lib/expiry";
import {
  createAndUploadDocument,
  MAX_MULTI_UPLOAD,
  titleFromFileName,
} from "../lib/documents";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/cn";

interface DocumentSummary {
  id: string;
  title: string;
  category: string;
  expiryDate?: string | null;
  visibility: "family" | "private";
}

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

const DOC_TABS = [
  { id: "all", label: "All", to: "/documents" },
  { id: "expiring", label: "Expiring", to: "/documents?tab=expiring" },
  { id: "private", label: "Private", to: "/documents?tab=private" },
  { id: "shared", label: "Shared", to: "/documents?tab=shared" },
] as const;

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
      <Skeleton className="size-10 rounded-xl" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

function isExpiringSoon(expiryDate?: string | null): boolean {
  const status = expiryStatus(expiryDate);
  if (!status) return false;
  return status.tone === "danger" || status.tone === "warning";
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
      className="size-4 rounded-full border border-line"
      aria-hidden="true"
    />
  );
}

export function Documents() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeFamily } = useAuth();
  const [searchParams] = useSearchParams();
  const tab = tabFromSearch(searchParams.toString());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [batch, setBatch] = useState<BatchItem[] | null>(null);
  const [batchError, setBatchError] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: () => api<{ documents: DocumentSummary[] }>("/documents"),
  });

  const docs = useMemo(() => {
    const all = data?.documents ?? [];
    switch (tab) {
      case "expiring":
        return all.filter((d) => isExpiringSoon(d.expiryDate));
      case "private":
        return all.filter((d) => d.visibility === "private");
      case "shared":
        return all.filter((d) => d.visibility === "family");
      default:
        return all;
    }
  }, [data?.documents, tab]);

  function handleAdd() {
    navigate("/documents/new");
  }

  async function runBatch(files: File[]) {
    setBatchError("");
    if (files.length === 0) return;
    if (files.length > MAX_MULTI_UPLOAD) {
      setBatchError(
        `You can upload up to ${MAX_MULTI_UPLOAD} files at once. Selected ${files.length}.`,
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
        const doc = await createAndUploadDocument(files[i]!, {
          familyId: activeFamily?.id,
        });
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
    void qc.invalidateQueries({ queryKey: ["documents"] });
  }

  // Single successful upload → open the new document.
  useEffect(() => {
    if (!batch || busy || batch.length !== 1) return;
    const only = batch[0];
    if (only?.status === "done" && only.documentId) {
      navigate(`/documents/${only.documentId}`);
    }
  }, [batch, busy, navigate]);

  function onFilesPicked(list: FileList | null) {
    if (!list || list.length === 0) return;
    void runBatch(Array.from(list));
  }

  const emptyCopy =
    tab === "expiring"
      ? {
          title: "Nothing expiring soon",
          description:
            "Documents with expiry dates in the next 30 days will show up here.",
        }
      : tab === "private"
        ? {
            title: "No private documents",
            description:
              "Private docs are only visible to you (and family admins).",
          }
        : tab === "shared"
          ? {
              title: "No shared documents",
              description: "Family-visible documents will appear in this list.",
            }
          : {
              title: "No documents yet",
              description:
                "Upload passports, insurance, licenses and more — pick one file or many at once.",
            };

  return (
    <>
      <AppBar
        title="Documents"
        trailing={
          <button
            type="button"
            aria-label="Upload files"
            disabled={busy}
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
          accept="image/*,application/pdf,.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.heic,.xls,.xlsx,.txt"
          className="sr-only"
          aria-label="Upload multiple documents"
          onChange={(e) => {
            onFilesPicked(e.target.files);
            e.target.value = "";
          }}
        />

        <SectionSubNav
          ariaLabel="Document filters"
          items={DOC_TABS.map((t) => ({
            to: t.to,
            label: t.label,
            end: t.id === "all",
            isActive: makeTabActive("/documents", t.id),
          }))}
        />

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
                  Each file becomes its own document. Edit details after if
                  needed.
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
            <ul className="divide-y divide-line overflow-hidden rounded-xl">
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
          <Card className="divide-y divide-line" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <DocSkeleton key={i} />
            ))}
          </Card>
        ) : docs.length > 0 ? (
          <Card className="divide-y divide-line overflow-hidden">
            {docs.map((doc) => {
              const status = expiryStatus(doc.expiryDate);
              const emoji = CATEGORY_EMOJI[doc.category] ?? "📄";
              return (
                <ListItem
                  key={doc.id}
                  to={`/documents/${doc.id}`}
                  leading={
                    <span className="flex size-10 items-center justify-center rounded-xl bg-vault-500/10 text-xl">
                      {emoji}
                    </span>
                  }
                  title={doc.title}
                  subtitle={doc.category}
                  trailing={
                    status ? (
                      <Badge tone={status.tone}>{status.label}</Badge>
                    ) : null
                  }
                />
              );
            })}
          </Card>
        ) : (
          <EmptyState
            icon={FolderOpen}
            title={emptyCopy.title}
            description={emptyCopy.description}
            action={
              tab === "all" ? (
                <div className="flex w-full flex-col gap-2">
                  <Button
                    leadingIcon={<Upload className="size-4" />}
                    disabled={busy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Upload files
                  </Button>
                  <Button
                    variant="secondary"
                    leadingIcon={<Plus className="size-4" />}
                    onClick={handleAdd}
                  >
                    Add without a file
                  </Button>
                </div>
              ) : undefined
            }
          />
        )}
      </Page>
      <Fab
        icon={Plus}
        label="Add document"
        className={cn(busy && "pointer-events-none opacity-40")}
        onClick={handleAdd}
      />
    </>
  );
}
