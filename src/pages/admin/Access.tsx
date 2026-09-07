import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { Check, Inbox, Shield, UserPlus, X } from "lucide-react";
import { AppBar } from "../../components/ui/AppBar";
import { Page } from "../../components/ui/Page";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import { inputCls } from "../../lib/fieldCls";
import { cn } from "../../lib/cn";

interface DemoRequest {
  id: string;
  name: string;
  email: string;
  company: string | null;
  message: string | null;
  status: string;
  createdAt: number;
  reviewedAt: number | null;
}

interface AccessGrant {
  id: string;
  email: string;
  status: string;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

function formatWhen(secs: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(secs * 1000));
}

export function AdminAccess() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const qc = useQueryClient();
  const isAdmin = Boolean(user?.isPlatformAdmin);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteNote, setInviteNote] = useState("");

  const requests = useQuery({
    queryKey: ["admin", "demo-requests"],
    enabled: isAdmin,
    queryFn: () =>
      api<{ requests: DemoRequest[] }>("/access/admin/demo-requests?status=pending"),
  });

  const grants = useQuery({
    queryKey: ["admin", "grants"],
    enabled: isAdmin,
    queryFn: () => api<{ grants: AccessGrant[] }>("/access/admin/grants"),
  });

  const approve = useMutation({
    mutationFn: (id: string) =>
      api(`/access/admin/demo-requests/${id}/approve`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  const reject = useMutation({
    mutationFn: (id: string) =>
      api(`/access/admin/demo-requests/${id}/reject`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  const invite = useMutation({
    mutationFn: () =>
      api("/access/admin/grants", {
        method: "POST",
        body: JSON.stringify({
          email: inviteEmail,
          note: inviteNote || undefined,
        }),
      }),
    onSuccess: () => {
      setInviteEmail("");
      setInviteNote("");
      void qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  const revoke = useMutation({
    mutationFn: (email: string) =>
      api("/access/admin/grants/revoke", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted">
        Loading…
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;

  function onInvite(e: FormEvent) {
    e.preventDefault();
    invite.mutate();
  }

  return (
    <>
      <AppBar title="App access" back />
      <Page className="space-y-6">
        <Card className="flex items-start gap-3 p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-vault-500/20 text-vault-300">
            <Shield className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 text-sm text-fg-muted">
            <p className="font-semibold text-white">Platform admin</p>
            <p className="mt-1 leading-relaxed">
              Approve access requests and invite people to the app. Family roles
              stay separate — this controls who can sign in at all. Notifications
              go to your ACCESS_NOTIFY_EMAIL inbox.
            </p>
          </div>
        </Card>

        <section className="space-y-2">
          <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            Pending access requests
          </h3>
          {requests.isLoading ? (
            <Card className="space-y-3 p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </Card>
          ) : !requests.data?.requests.length ? (
            <EmptyState
              icon={Inbox}
              title="No pending requests"
              description="New requests from the login page show up here."
            />
          ) : (
            <div className="space-y-3">
              {requests.data.requests.map((r) => (
                <Card key={r.id} className="space-y-3 p-4 text-left">
                  <div>
                    <div className="font-semibold text-white">{r.name}</div>
                    <div className="text-sm text-fg-muted">{r.email}</div>
                    {r.company && (
                      <div className="mt-1 text-xs text-fg-subtle">{r.company}</div>
                    )}
                    {r.message && (
                      <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                        {r.message}
                      </p>
                    )}
                    <div className="mt-2 text-xs text-fg-subtle">
                      {formatWhen(r.createdAt)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="md"
                      loading={approve.isPending}
                      leadingIcon={<Check className="size-4" />}
                      onClick={() => approve.mutate(r.id)}
                    >
                      Approve
                    </Button>
                    <Button
                      size="md"
                      variant="danger"
                      loading={reject.isPending}
                      leadingIcon={<X className="size-4" />}
                      onClick={() => reject.mutate(r.id)}
                    >
                      Reject
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            Invite to the app
          </h3>
          <Card className="p-4">
            <form onSubmit={onInvite} className="space-y-3">
              <label className="block text-xs font-medium text-fg-muted">
                Email
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@example.com"
                  className={cn(inputCls, "mt-1")}
                />
              </label>
              <label className="block text-xs font-medium text-fg-muted">
                Note
                <input
                  value={inviteNote}
                  onChange={(e) => setInviteNote(e.target.value)}
                  placeholder="Optional"
                  className={cn(inputCls, "mt-1")}
                />
              </label>
              <Button type="submit" fullWidth loading={invite.isPending}>
                Grant access & email them
              </Button>
              {invite.isError && (
                <p className="text-xs text-danger">
                  {(invite.error as Error).message}
                </p>
              )}
              {invite.isSuccess && (
                <p className="text-xs text-success">Invite sent.</p>
              )}
            </form>
          </Card>
        </section>

        <section className="space-y-2">
          <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
            Access grants
          </h3>
          {grants.isLoading ? (
            <Card className="space-y-3 p-4">
              <Skeleton className="h-4 w-2/3" />
            </Card>
          ) : !grants.data?.grants.length ? (
            <EmptyState
              icon={UserPlus}
              title="No grants yet"
              description="Approved requests and direct invites appear here."
            />
          ) : (
            <Card className="divide-y divide-white/8 overflow-hidden">
              {grants.data.grants.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center gap-3 px-4 py-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">
                      {g.email}
                    </div>
                    <div className="text-xs text-fg-subtle">
                      {g.status}
                      {g.note ? ` · ${g.note}` : ""}
                    </div>
                  </div>
                  {g.status === "approved" && (
                    <Button
                      size="md"
                      variant="ghost"
                      loading={revoke.isPending}
                      onClick={() => revoke.mutate(g.email)}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
            </Card>
          )}
        </section>
      </Page>
    </>
  );
}
