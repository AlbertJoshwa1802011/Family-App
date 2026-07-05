import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Plus } from "lucide-react";
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

export function Documents() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: () => api<{ documents: DocumentSummary[] }>("/documents"),
  });

  const docs = data?.documents ?? [];

  function handleAdd() {
    navigate("/documents/new");
  }

  return (
    <>
      <AppBar title="Documents" />
      <Page>
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
                    status ? <Badge tone={status.tone}>{status.label}</Badge> : null
                  }
                />
              );
            })}
          </Card>
        ) : (
          <EmptyState
            icon={FolderOpen}
            title="No documents yet"
            description="Add your family's passports, insurance, licenses and more — and we'll remind you before they expire."
            action={
              <Button
                leadingIcon={<Plus className="size-4" />}
                onClick={handleAdd}
              >
                Add document
              </Button>
            }
          />
        )}
      </Page>
      <Fab icon={Plus} label="Add document" onClick={handleAdd} />
    </>
  );
}
