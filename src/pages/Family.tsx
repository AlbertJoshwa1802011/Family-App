import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Check, Copy, Shield, Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { ListItem } from "../components/ui/ListItem";
import { Skeleton } from "../components/ui/Skeleton";
import { Modal } from "../components/ui/Modal";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

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

// Maps the backend audit-log action verbs (dotted, from lib/audit ACTIONS) to
// friendly sentences for the activity feed.
function formatAction(action: string): string {
  const labels: Record<string, string> = {
    "family.created": "Created the family",
    "family.updated": "Updated the family",
    "member.invited": "Invited a member",
    "member.joined": "Joined the family",
    "member.role_changed": "Changed a member's role",
    "member.updated": "Updated a member",
    "member.removed": "Removed a member",
    "document.created": "Added a document",
    "document.updated": "Updated a document",
    "document.uploaded": "Uploaded a file",
    "document.downloaded": "Downloaded a document",
    "document.trashed": "Deleted a document",
    "document.restored": "Restored a document",
    "event.created": "Created an event",
    "event.updated": "Updated an event",
    "event.cancelled": "Cancelled an event",
    "event.trashed": "Deleted an event",
    "task.created": "Added a task",
    "task.updated": "Updated a task",
    "task.completed": "Completed a task",
    "task.deleted": "Deleted a task",
    "contact.created": "Added a contact",
    "contact.updated": "Updated a contact",
    "contact.deleted": "Deleted a contact",
  };
  return labels[action] ?? action.replace(/[._]/g, " ");
}

function InviteModal({
  familyId,
  open,
  onClose,
}: {
  familyId: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      api<{ invite: { token: string } }>(`/families/${familyId}/invites`, {
        method: "POST",
        body: JSON.stringify({ email, role }),
      }),
    onSuccess: (data) => {
      const link = `${window.location.origin}/join/${data.invite.token}`;
      setInviteLink(link);
      void qc.invalidateQueries({ queryKey: ["family-activity"] });
    },
  });

  function reset() {
    setEmail("");
    setRole("member");
    setInviteLink(null);
    setCopied(false);
    mutation.reset();
  }

  function close() {
    reset();
    onClose();
  }

  async function copyLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal open={open} onClose={close} title="Invite a family member">
      {inviteLink ? (
        <div className="space-y-4 pb-2">
          <p className="text-sm text-fg-muted">
            Share this secure link with{" "}
            <span className="font-medium text-fg">{email}</span>. It expires in 7 days.
          </p>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-ink-950 p-2">
            <span className="flex-1 truncate px-1 text-xs text-fg-muted">
              {inviteLink}
            </span>
            <Button
              size="md"
              variant={copied ? "secondary" : "primary"}
              leadingIcon={
                copied ? <Check className="size-4" /> : <Copy className="size-4" />
              }
              onClick={copyLink}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button variant="secondary" fullWidth onClick={close}>
            Done
          </Button>
        </div>
      ) : (
        <form
          className="space-y-4 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) mutation.mutate();
          }}
        >
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
              Email address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="family@example.com"
              className="w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
              Role
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["member", "admin"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                    role === r
                      ? "border-vault-500 bg-vault-600/15 text-vault-300"
                      : "border-line bg-ink-950 text-fg-muted hover:border-line-strong"
                  }`}
                >
                  {ROLE_LABELS[r]}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-fg-subtle">
              {role === "admin"
                ? "Admins can invite members and manage the family."
                : "Members can view and add shared documents and events."}
            </p>
          </div>
          {mutation.isError && (
            <p className="text-sm text-danger">
              {(mutation.error as Error).message}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={mutation.isPending}
            leadingIcon={<UserPlus className="size-4" />}
          >
            Create invite link
          </Button>
        </form>
      )}
    </Modal>
  );
}

function MemberActionsModal({
  familyId,
  member,
  canManage,
  onClose,
}: {
  familyId: string;
  member: FamilyMember | null;
  canManage: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: { role?: string; status?: string }) =>
      api(`/families/${familyId}/members/${member!.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["family-members"] });
      void qc.invalidateQueries({ queryKey: ["family-activity"] });
      onClose();
    },
  });

  if (!member) return null;
  const isOwner = member.role === "owner";

  return (
    <Modal
      open={Boolean(member)}
      onClose={onClose}
      title={member.name ?? member.email ?? "Member"}
    >
      <div className="space-y-4 pb-2">
        <div className="flex items-center gap-3">
          <Avatar
            name={member.name}
            email={member.email}
            src={member.picture}
            className="size-12"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-fg">
              {member.name ?? "Member"}
            </p>
            <p className="truncate text-xs text-fg-muted">{member.email}</p>
          </div>
        </div>

        {isOwner ? (
          <p className="rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg-muted">
            <Shield className="mr-1.5 inline size-4 text-vault-400" />
            This member is the family owner and can't be changed.
          </p>
        ) : canManage ? (
          <>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-fg-muted">Role</p>
              <div className="grid grid-cols-2 gap-2">
                {(["member", "admin"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate({ role: r })}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                      member.role === r
                        ? "border-vault-500 bg-vault-600/15 text-vault-300"
                        : "border-line bg-ink-950 text-fg-muted hover:border-line-strong"
                    }`}
                  >
                    {ROLE_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>
            <Button
              variant="danger"
              fullWidth
              loading={mutation.isPending}
              leadingIcon={<Trash2 className="size-4" />}
              onClick={() => {
                if (confirm(`Remove ${member.name ?? member.email} from the family?`))
                  mutation.mutate({ status: "removed" });
              }}
            >
              Remove from family
            </Button>
          </>
        ) : (
          <p className="rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg-muted">
            Only owners and admins can manage members.
          </p>
        )}
      </div>
    </Modal>
  );
}

export function FamilyPage() {
  const { currentFamily } = useAuth();
  const familyId = currentFamily?.id;
  const canManage =
    currentFamily?.role === "owner" || currentFamily?.role === "admin";

  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<FamilyMember | null>(null);

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ["family-members"],
    queryFn: () => api<{ members: FamilyMember[] }>("/families/me/members"),
  });

  const { data: activityData } = useQuery({
    queryKey: ["family-activity", familyId],
    queryFn: () =>
      api<{ activities: ActivityItem[] }>(`/families/me/activity`),
  });

  const members = membersData?.members ?? [];
  const activities = activityData?.activities ?? [];
  const activeMembers = members.filter((m) => m.status === "active");
  const pendingMembers = members.filter((m) => m.status === "invited");

  return (
    <>
      <AppBar
        title="Family"
        trailing={
          canManage ? (
            <Button
              size="md"
              leadingIcon={<UserPlus className="size-4" />}
              onClick={() => setInviteOpen(true)}
            >
              Invite
            </Button>
          ) : undefined
        }
      />
      <Page className="space-y-6">
        {/* Members section */}
        <section className="space-y-2">
          <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            Members{activeMembers.length > 0 ? ` · ${activeMembers.length}` : ""}
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
                canManage ? (
                  <Button
                    leadingIcon={<UserPlus className="size-4" />}
                    onClick={() => setInviteOpen(true)}
                  >
                    Invite a member
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Card className="divide-y divide-line overflow-hidden">
              {activeMembers.map((m) => (
                <ListItem
                  key={m.id}
                  onClick={
                    canManage && m.role !== "owner"
                      ? () => setSelectedMember(m)
                      : undefined
                  }
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
                            : "neutral"
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
                      {formatAction(a.action)}
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

      {familyId && (
        <InviteModal
          familyId={familyId}
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
        />
      )}
      {familyId && (
        <MemberActionsModal
          familyId={familyId}
          member={selectedMember}
          canManage={canManage}
          onClose={() => setSelectedMember(null)}
        />
      )}
    </>
  );
}
