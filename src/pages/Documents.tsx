import { useQuery } from "@tanstack/react-query";
import { FileText, FolderOpen, Lock, Plus, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
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
import { useAuth } from "../context/AuthContext";

interface DocumentSummary {
  id: string;
  title: string;
  category: string;
  visibility: "family" | "private";
  expiryDate?: string | null;
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

export function Documents() {
  const navigate = useNavigate();
  const { activeFamily } = useAuth();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

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

  return (
    <>
      <AppBar title="Documents" />
      <Page className="space-y-4">
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
            description="Add your family's passports, insurance, licenses and more — and we'll remind you before they expire."
            action={
              <Button
                leadingIcon={<Plus className="size-4" />}
                onClick={() => navigate("/documents/new")}
              >
                Add document
              </Button>
            }
          />
        )}
      </Page>
      <Fab
        icon={Plus}
        label="Add document"
        onClick={() => navigate("/documents/new")}
      />
    </>
  );
}
