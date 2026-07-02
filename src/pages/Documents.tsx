import { useQuery } from "@tanstack/react-query";
import { FileText, FolderOpen, Lock, Plus } from "lucide-react";
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
  const { activeFamily } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["documents", activeFamily?.id],
    // The API requires familyId and enforces family membership server-side.
    queryFn: () =>
      api<{ documents: DocumentSummary[] }>(
        `/documents?familyId=${activeFamily!.id}`,
      ),
    enabled: Boolean(activeFamily),
  });

  const docs = data?.documents ?? [];

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
              return (
                <ListItem
                  key={doc.id}
                  to={`/documents/${doc.id}`}
                  leading={
                    <span className="flex size-10 items-center justify-center rounded-xl bg-vault-500/10 text-vault-300">
                      <FileText className="size-5" aria-hidden="true" />
                    </span>
                  }
                  title={
                    <span className="inline-flex items-center gap-1.5">
                      {doc.title}
                      {doc.visibility === "private" && (
                        <Lock className="size-3.5 text-fg-subtle" aria-label="Private" />
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
