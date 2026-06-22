import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FolderOpen, Plus, Search, X } from "lucide-react";
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
import { api } from "../lib/api";
import { expiryStatus } from "../lib/expiry";
import { categoryMeta } from "../lib/categories";
import { cn } from "../lib/cn";
import { useAuth } from "../context/AuthContext";

interface DocumentSummary {
  id: string;
  title: string;
  category: string;
  description?: string | null;
  expiryDate?: string | null;
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

/** Expiry-first ordering: soonest expiry on top, undated documents after. */
function byUrgency(a: DocumentSummary, b: DocumentSummary): number {
  if (a.expiryDate && b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1;
  if (a.expiryDate) return -1;
  if (b.expiryDate) return 1;
  return a.title.localeCompare(b.title);
}

export function Documents() {
  const { families } = useAuth();
  const familyId = families[0]?.id;
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["documents", familyId],
    queryFn: () =>
      api<{ documents: DocumentSummary[] }>(`/documents?familyId=${familyId}`),
    enabled: Boolean(familyId),
  });

  const docs = useMemo(() => data?.documents ?? [], [data]);

  // Categories actually present, for the filter rail.
  const presentCats = useMemo(() => {
    const set = new Set(docs.map((d) => d.category));
    return [...set];
  }, [docs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs
      .filter((d) => (activeCat ? d.category === activeCat : true))
      .filter((d) =>
        q
          ? d.title.toLowerCase().includes(q) ||
            (d.description ?? "").toLowerCase().includes(q) ||
            categoryMeta(d.category).label.toLowerCase().includes(q)
          : true,
      )
      .sort(byUrgency);
  }, [docs, query, activeCat]);

  return (
    <>
      <AppBar title="Documents" />
      <Page className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents…"
            className="w-full rounded-xl border border-line bg-surface-2 py-2.5 pr-9 pl-9 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-vault-500/60 focus:ring-2 focus:ring-vault-400/30"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-fg-muted hover:bg-white/5"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Category filter rail */}
        {presentCats.length > 1 && (
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            <Chip active={!activeCat} onClick={() => setActiveCat(null)}>
              All
            </Chip>
            {presentCats.map((c) => (
              <Chip
                key={c}
                active={activeCat === c}
                onClick={() => setActiveCat(c)}
              >
                {categoryMeta(c).label}
              </Chip>
            ))}
          </div>
        )}

        {isLoading ? (
          <Card className="divide-y divide-line" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <DocSkeleton key={i} />
            ))}
          </Card>
        ) : filtered.length > 0 ? (
          <Card className="divide-y divide-line overflow-hidden">
            {filtered.map((doc) => {
              const status = expiryStatus(doc.expiryDate);
              const cat = categoryMeta(doc.category);
              const Icon = cat.icon;
              return (
                <ListItem
                  key={doc.id}
                  to={`/documents/${doc.id}`}
                  leading={
                    <span className="flex size-10 items-center justify-center rounded-xl bg-vault-500/10 text-vault-300">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                  }
                  title={doc.title}
                  subtitle={cat.label}
                  trailing={
                    status ? <Badge tone={status.tone}>{status.label}</Badge> : null
                  }
                />
              );
            })}
          </Card>
        ) : docs.length > 0 ? (
          <EmptyState
            icon={Search}
            title="No matches"
            description="Try a different search term or category."
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
      <Fab icon={Plus} label="Add document" onClick={() => navigate("/documents/new")} />
    </>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
        active
          ? "border-vault-500/40 bg-vault-500/15 text-vault-300"
          : "border-line text-fg-muted hover:bg-white/5",
      )}
    >
      {children}
    </button>
  );
}
