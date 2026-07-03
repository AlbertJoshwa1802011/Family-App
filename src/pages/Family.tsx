import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Activity,
  Baby,
  Check,
  ChevronRight,
  Copy,
  Settings,
  UserPlus,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface FamilyMember {
  id: string;
  userId: string | null;
  memberType: "user" | "dependent";
  displayName: string | null;
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

// Keys mirror worker audit actions (worker/lib/audit callers).
const ACTION_LABELS: Record<string, string> = {
  family_created: "Created the family",
  member_joined: "Joined the family",
  member_updated: "Updated a member",
  invite_created: "Invited a member",
  document_created: "Added a document",
  document_uploaded: "Uploaded a file",
  document_downloaded: "Downloaded a document",
  document_deleted: "Deleted a document",
  event_created: "Created an event",
  event_updated: "Updated an event",
  event_cancelled: "Cancelled an event",
  event_deleted: "Deleted an event",
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

function formatRelativeTime(unixSec: number, nowSec: number): string {
  const diffSec = nowSec - unixSec;
  if (diffSec < 60) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function FamilyPage() {
  const { activeFamily, families, setActiveFamilyId, user } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [dependentOpen, setDependentOpen] = useState(false);
  const [manageMember, setManageMember] = useState<FamilyMember | null>(null);
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  const familyId = activeFamily?.id;
  const canInvite =
    activeFamily?.role === "owner" || activeFamily?.role === "admin";

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ["family-members", familyId],
    queryFn: () =>
      api<{ members: FamilyMember[] }>(`/families/${familyId}/members`),
    enabled: Boolean(familyId),
  });

  const { data: activityData } = useQuery({
    queryKey: ["family-activity", familyId],
    queryFn: () =>
      api<{ activities: ActivityItem[] }>(`/families/${familyId}/activity`),
    enabled: Boolean(familyId),
  });

  const members = membersData?.members ?? [];
  const activities = activityData?.activities ?? [];
  const activeMembers = members.filter((m) => m.status === "active");

  return (
    <>
      <AppBar
        title="Family"
        trailing={
          <div className="flex items-center gap-1">
            {canInvite && (
              <Button
                size="md"
                leadingIcon={<UserPlus className="size-4" />}
                onClick={() => setInviteOpen((v) => !v)}
              >
                Invite
              </Button>
            )}
            <Link
              to="/settings"
              aria-label="Settings"
              className="flex size-11 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-white/5"
            >
              <Settings className="size-5" />
            </Link>
          </div>
        }
      />
      <Page className="space-y-6">
        {/* Family switcher — shown only for multi-family users */}
        {families.length > 1 && (
          <section className="space-y-2">
            <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              Your families
            </h3>
            <div className="flex flex-wrap gap-2">
              {families.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setActiveFamilyId(f.id)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    f.id === familyId
                      ? "bg-vault-600 text-white"
                      : "bg-white/5 text-fg-muted hover:bg-white/10"
                  }`}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </section>
        )}

        {inviteOpen && familyId && (
          <InviteCard familyId={familyId} onClose={() => setInviteOpen(false)} />
        )}

        {dependentOpen && familyId && (
          <AddDependentCard
            familyId={familyId}
            onClose={() => setDependentOpen(false)}
          />
        )}

        {manageMember && familyId && (
          <ManageMemberCard
            familyId={familyId}
            member={manageMember}
            isSelf={manageMember.userId === user?.id}
            onClose={() => setManageMember(null)}
          />
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
                canInvite ? (
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
                <div key={m.id} className="flex items-center">
                  <Link
                    to={`/family/members/${m.id}`}
                    className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-3 transition-colors hover:bg-white/5"
                  >
                    <Avatar
                      name={m.displayName ?? m.name}
                      email={m.email}
                      src={m.picture}
                      className="size-10"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {m.displayName ?? m.name ?? m.email ?? "Member"}
                      </span>
                      <span className="block truncate text-xs text-fg-muted">
                        {m.memberType === "dependent"
                          ? "Dependent"
                          : (m.email ?? "")}
                      </span>
                    </span>
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
                    <ChevronRight className="size-4 shrink-0 text-fg-subtle" />
                  </Link>
                  {canInvite && m.role !== "owner" && (
                    <button
                      onClick={() => setManageMember(m)}
                      className="mr-2 rounded-lg px-2 py-1 text-xs font-medium text-fg-muted hover:bg-white/5 hover:text-fg"
                    >
                      Manage
                    </button>
                  )}
                </div>
              ))}
            </Card>
          )}
          {canInvite && (
            <button
              onClick={() => setDependentOpen((v) => !v)}
              className="flex items-center gap-1.5 px-1 text-xs font-medium text-vault-400 hover:text-vault-300"
            >
              <Baby className="size-3.5" />
              Add a child or dependent (no account needed)
            </button>
          )}
        </section>

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
                      {ACTION_LABELS[a.action] ?? a.action}
                    </p>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      {formatRelativeTime(a.createdAt, now)}
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

function InviteCard({
  familyId,
  onClose,
}: {
  familyId: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [error, setError] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      api<{ invite: { token: string } }>(`/families/${familyId}/invites`, {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), role }),
      }),
    onSuccess: (res) => {
      // Invite links are accepted in-app: the invitee signs in with the
      // invited email, then the app POSTs the token.
      setInviteLink(`${window.location.origin}/invite/${res.invite.token}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError("Email is required");
      return;
    }
    setError("");
    create.mutate();
  }

  if (inviteLink) {
    return (
      <Card className="space-y-3 p-4">
        <p className="text-sm font-medium text-fg">
          Invite created for {email}
        </p>
        <p className="text-xs text-fg-muted">
          Share this link with them. It only works for the Google account with
          that email, and expires in 7 days.
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-ink-950 px-3 py-2 text-xs text-fg-muted">
            {inviteLink}
          </code>
          <Button
            size="md"
            variant="secondary"
            leadingIcon={
              copied ? <Check className="size-4" /> : <Copy className="size-4" />
            }
            onClick={async () => {
              await navigator.clipboard.writeText(inviteLink);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <Button variant="ghost" fullWidth onClick={onClose}>
          Done
        </Button>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card className="space-y-3 p-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
            Email <span className="text-danger">*</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="family.member@example.com"
            autoFocus
            className="w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
          />
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold text-fg-muted">Role</p>
          <div className="flex gap-2">
            {(["member", "admin"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  role === r
                    ? "bg-vault-600 text-white"
                    : "bg-white/5 text-fg-muted hover:bg-white/10"
                }`}
              >
                {ROLE_LABELS[r]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-fg-subtle">
            Admins can see all documents (including private ones), invite
            members, and manage roles.
          </p>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={create.isPending} className="flex-1">
            Create invite
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </Card>
    </form>
  );
}

function AddDependentCard({
  familyId,
  onClose,
}: {
  familyId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api(`/families/${familyId}/members`, {
        method: "POST",
        body: JSON.stringify({
          displayName: displayName.trim(),
          dateOfBirth: dateOfBirth || undefined,
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["family-members"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) {
      setError("Name is required");
      return;
    }
    setError("");
    create.mutate();
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card className="space-y-3 p-4">
        <p className="text-sm font-medium text-fg">Add a dependent</p>
        <p className="text-xs text-fg-muted">
          For children or relatives without their own login. You can assign
          documents and health info to them.
        </p>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
            Name <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Ella"
            autoFocus
            className="w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
            Date of birth (optional)
          </label>
          <input
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            className="w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg focus:border-vault-500 focus:outline-none"
          />
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={create.isPending} className="flex-1">
            Add dependent
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </Card>
    </form>
  );
}

function ManageMemberCard({
  familyId,
  member,
  isSelf,
  onClose,
}: {
  familyId: string;
  member: FamilyMember;
  isSelf: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState("");

  const update = useMutation({
    mutationFn: (patch: { role?: "admin" | "member"; status?: "removed" }) =>
      api(`/families/${familyId}/members/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["family-members"] });
      void qc.invalidateQueries({ queryKey: ["family-activity"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const name = member.displayName ?? member.name ?? member.email ?? "this member";

  return (
    <Card className="space-y-3 p-4">
      <p className="text-sm font-medium text-fg">Manage {name}</p>
      {member.memberType === "user" && (
        <div className="flex gap-2">
          {member.role === "member" ? (
            <Button
              variant="secondary"
              className="flex-1"
              loading={update.isPending}
              onClick={() => update.mutate({ role: "admin" })}
            >
              Make admin
            </Button>
          ) : (
            <Button
              variant="secondary"
              className="flex-1"
              loading={update.isPending}
              onClick={() => update.mutate({ role: "member" })}
            >
              Make member
            </Button>
          )}
        </div>
      )}
      <Button
        variant="danger"
        fullWidth
        loading={update.isPending}
        onClick={() => {
          if (
            window.confirm(
              isSelf
                ? "Remove yourself from this family? You'll lose access to its documents."
                : `Remove ${name} from the family? They'll lose access to all family documents.`,
            )
          ) {
            update.mutate({ status: "removed" });
          }
        }}
      >
        Remove from family
      </Button>
      {error && <p className="text-xs text-danger">{error}</p>}
      <Button variant="ghost" fullWidth onClick={onClose}>
        Close
      </Button>
    </Card>
  );
}
