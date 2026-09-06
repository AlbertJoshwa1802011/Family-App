import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Cake, FileText, FolderOpen, Mail } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { ListItem } from "../components/ui/ListItem";
import { EmptyState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { expiryStatus } from "../lib/expiry";

interface FamilyMember {
  id: string;
  userId: string | null;
  memberType: "user" | "dependent";
  displayName: string | null;
  dateOfBirth: string | null;
  name: string | null;
  email: string | null;
  picture: string | null;
  role: "owner" | "admin" | "member";
  status: string;
}

interface DocumentSummary {
  id: string;
  title: string;
  category: string;
  expiryDate?: string | null;
}

/** Per-member view: profile + every document assigned to this person. */
export function MemberProfile() {
  const { id: memberId } = useParams<{ id: string }>();
  const { activeFamily } = useAuth();
  const familyId = activeFamily?.id;

  const { data: membersData, isLoading } = useQuery({
    queryKey: ["family-members", familyId],
    queryFn: () =>
      api<{ members: FamilyMember[] }>(`/families/${familyId}/members`),
    enabled: Boolean(familyId),
  });

  const member = membersData?.members.find((m) => m.id === memberId);

  const { data: docsData } = useQuery({
    queryKey: ["documents", familyId, "member", memberId],
    queryFn: () =>
      api<{ documents: DocumentSummary[] }>(
        `/documents?familyId=${familyId}&member=${memberId}`,
      ),
    enabled: Boolean(familyId && memberId),
  });

  const docs = docsData?.documents ?? [];
  const displayName =
    member?.displayName ?? member?.name ?? member?.email ?? "Member";

  if (isLoading) {
    return (
      <>
        <AppBar title="Member" back />
        <Page className="space-y-4" aria-busy="true">
          <Card className="flex items-center gap-4 p-5">
            <Skeleton className="size-14 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </Card>
        </Page>
      </>
    );
  }

  if (!member) {
    return (
      <>
        <AppBar title="Member" back />
        <Page>
          <Card className="p-5 text-sm text-fg-muted">
            This member doesn't exist in the current family.
          </Card>
        </Page>
      </>
    );
  }

  return (
    <>
      <AppBar title={displayName} back />
      <Page className="space-y-5">
        <Card className="p-5">
          <div className="flex items-center gap-4">
            <Avatar
              name={displayName}
              email={member.email}
              src={member.picture}
              className="size-14"
            />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold text-white">
                {displayName}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    member.role === "owner"
                      ? "vault"
                      : member.role === "admin"
                        ? "warning"
                        : undefined
                  }
                >
                  {member.memberType === "dependent"
                    ? "Dependent"
                    : member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                </Badge>
              </div>
            </div>
          </div>
          {(member.email || member.dateOfBirth) && (
            <div className="mt-4 space-y-1.5 text-sm text-fg-muted">
              {member.email && (
                <div className="flex items-center gap-2">
                  <Mail className="size-4 shrink-0" />
                  <span className="truncate">{member.email}</span>
                </div>
              )}
              {member.dateOfBirth && (
                <div className="flex items-center gap-2">
                  <Cake className="size-4 shrink-0" />
                  <span>{member.dateOfBirth}</span>
                </div>
              )}
            </div>
          )}
        </Card>

        <section className="space-y-2">
          <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            {displayName}'s documents
          </h3>
          {docs.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="No documents yet"
              description={`Documents assigned to ${displayName} (via "Belongs to" when adding a document) will appear here.`}
            />
          ) : (
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
                    title={doc.title}
                    subtitle={doc.category}
                    trailing={
                      status ? <Badge tone={status.tone}>{status.label}</Badge> : null
                    }
                  />
                );
              })}
            </Card>
          )}
        </section>
      </Page>
    </>
  );
}
