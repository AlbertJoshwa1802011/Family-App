import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, UserPlus, Users, X } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { ListItem } from "../components/ui/ListItem";
import { Skeleton } from "../components/ui/Skeleton";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/cn";

interface FamilyMember {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  picture: string | null;
  role: "owner" | "admin" | "member";
  status: "active" | "invited" | "removed";
}

interface ActivityItem {
  id: string;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: number;
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

function MemberSkeleton() {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

function formatRelativeTime(unixSec: number): string {
  const diffSec = Math.floor(Date.now() / 1000) - unixSec;
  if (diffSec < 60) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function formatAction(action: string, targetType: string | null): string {
  const type = targetType ?? "item";
  const labels: Record<string, string> = {
    "document.upload": `Uploaded a ${type}`,
    "document.download": `Downloaded a ${type}`,
    "document.delete": `Deleted a ${type}`,
    "document.create": `Added a ${type}`,
    "member.invite": "Invited a member",
    "member.remove": "Removed a member",
    "member.role_change": "Updated a member's role",
    "event.create": "Created an event",
    "event.cancel": "Cancelled an event",
    "task.create": "Added a task",
    "task.complete": "Completed a task",
  };
  return labels[action] ?? action;
}

export function FamilyPage() {
  const qc = useQueryClient();
  const { families } = useAuth();
  const activeFamilyId = families[0]?.id;

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ["family-members"],
    queryFn: () => api<{ members: FamilyMember[] }>("/families/me/members"),
  });

  const { data: activityData } = useQuery({
    queryKey: ["family-activity"],
    queryFn: () => api<{ activities: ActivityItem[] }>("/families/me/activity"),
  });

  const inviteMutation = useMutation({
    mutationFn: (payload: { email: string; role: "admin" | "member" }) =>
      api(`/families/${activeFamilyId}/invites`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["family-members"] });
      setInviteEmail("");
      setInviteSuccess("Invitation sent!");
      setInviteError("");
      setTimeout(() => setInviteSuccess(""), 4000);
      setShowInviteForm(false);
    },
    onError: (err) => {
      setInviteError(err instanceof Error ? err.message : "Failed to invite member");
    },
  });

  const members = membersData?.members ?? [];
  const activities = activityData?.activities ?? [];
  const activeMembers = members.filter((m) => m.status === "active");
  const pendingMembers = members.filter((m) => m.status === "invited");

  function handleInviteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    inviteMutation.mutate({
      email: inviteEmail.trim(),
      role: inviteRole,
    });
  }

  return (
    <>
      <AppBar
        title="Family"
        trailing={
          <Button
            size="md"
            leadingIcon={<UserPlus className="size-4" />}
            onClick={() => {
              setShowInviteForm((s) => !s);
              setInviteError("");
            }}
          >
            Invite
          </Button>
        }
      />
      <Page className="space-y-6">
        {/* Success message */}
        {inviteSuccess && (
          <div className="rounded-xl bg-success/15 border border-success/30 p-3 text-sm text-success flex items-center gap-2">
            <span>✓</span> {inviteSuccess}
          </div>
        )}

        {/* Invite Form */}
        {showInviteForm && (
          <Card className="p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-2.5">
              <h3 className="text-sm font-semibold text-fg flex items-center gap-2">
                <UserPlus className="size-4 text-fg-muted" />
                Invite Family Member
              </h3>
              <button
                onClick={() => {
                  setShowInviteForm(false);
                  setInviteError("");
                }}
                className="rounded-lg p-1 text-fg-muted hover:bg-white/5 hover:text-fg"
              >
                <X className="size-4" />
              </button>
            </div>
            
            <form onSubmit={handleInviteSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-fg-muted mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="e.g. spouse@email.com, sibling@email.com"
                  className="w-full rounded-xl bg-ink-950 px-3.5 py-2.5 text-sm text-fg border border-line focus:border-vault-500 focus:outline-none"
                />
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-fg-muted mb-1.5">
                  Role
                </label>
                <div className="flex gap-2">
                  {(["member", "admin"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setInviteRole(r)}
                      className={cn(
                        "flex-1 rounded-xl px-3 py-2 text-xs font-medium transition-all border",
                        inviteRole === r
                          ? "bg-vault-500/15 border-vault-500/40 text-vault-300"
                          : "bg-transparent border-line text-fg-muted hover:bg-white/5"
                      )}
                    >
                      {r === "admin" ? "🛠️ Admin" : "👤 Member"}
                    </button>
                  ))}
                </div>
              </div>
              
              {inviteError && (
                <p className="text-xs text-danger">{inviteError}</p>
              )}
              
              <div className="flex gap-2.5 justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => {
                    setShowInviteForm(false);
                    setInviteError("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="md"
                  loading={inviteMutation.isPending}
                >
                  Send Invitation
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Members section */}
        <section className="space-y-2">
          <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            Members
          </h3>
          {membersLoading ? (
            <Card className="divide-y divide-line">
              {Array.from({ length: 3 }).map((_, i) => (
                <MemberSkeleton key={i} />
              ))}
            </Card>
          ) : activeMembers.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Build your family circle"
              description="Invite family members so everyone can access shared documents and stay on top of renewals together."
              action={
                <Button
                  leadingIcon={<UserPlus className="size-4" />}
                  onClick={() => {
                    setShowInviteForm(true);
                    setInviteError("");
                  }}
                >
                  Invite a member
                </Button>
              }
            />
          ) : (
            <Card className="divide-y divide-line overflow-hidden">
              {activeMembers.map((m) => (
                <ListItem
                  key={m.id}
                  leading={
                    <Avatar
                      name={m.name}
                      email={m.email}
                      src={m.picture}
                      className="size-10"
                    />
                  }
                  title={m.name ?? m.email ?? "Member"}
                  subtitle={m.email ?? undefined}
                  trailing={
                    <Badge
                      tone={
                        m.role === "owner"
                          ? "vault"
                          : m.role === "admin"
                            ? "warning"
                            : undefined
                      }
                    >
                      {ROLE_LABELS[m.role] ?? m.role}
                    </Badge>
                  }
                />
              ))}
            </Card>
          )}
        </section>

        {/* Pending invites */}
        {pendingMembers.length > 0 && (
          <section className="space-y-2">
            <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              Pending invites
            </h3>
            <Card className="divide-y divide-line overflow-hidden">
              {pendingMembers.map((m) => (
                <ListItem
                  key={m.id}
                  leading={
                    <Avatar
                      name={m.name}
                      email={m.email}
                      src={m.picture}
                      className="size-10"
                    />
                  }
                  title={m.email ?? "Invited member"}
                  subtitle="Invite pending"
                  trailing={<Badge tone="warning">Pending</Badge>}
                />
              ))}
            </Card>
          </section>
        )}

        {/* Activity feed */}
        {activities.length > 0 && (
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              <Activity className="size-3.5" />
              Recent activity
            </h3>
            <Card className="divide-y divide-line overflow-hidden">
              {activities.slice(0, 10).map((a) => (
                <div
                  key={a.id}
                  className="flex min-h-12 items-start gap-3 px-4 py-3"
                >
                  <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-vault-500/10">
                    <Activity className="size-3.5 text-vault-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg">
                      <span className="font-medium">
                        {a.actorName ?? "Someone"}
                      </span>{" "}
                      {formatAction(a.action, a.targetType)}
                    </p>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      {formatRelativeTime(a.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </Card>
          </section>
        )}
      </Page>
    </>
  );
}
