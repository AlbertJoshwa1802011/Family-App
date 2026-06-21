import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Users, XCircle } from "lucide-react";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Spinner } from "../components/ui/Spinner";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

/**
 * Invite-acceptance landing page (`/join/:token`). Requires the visitor to be
 * logged in; if not, bounces to /login first. On success, refetches auth and
 * lands them in the family.
 */
export function JoinInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();

  const mutation = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; familyId: string }>(`/families/invites/${token}/accept`, {
        method: "POST",
      }),
  });

  // Once authenticated, attempt acceptance exactly once.
  useEffect(() => {
    if (!isLoading && isAuthenticated && token && mutation.isIdle) {
      mutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isAuthenticated, token]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Preserve the invite so login can return here.
    sessionStorage.setItem("pendingInvite", token ?? "");
    return (
      <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-vault-500/10 text-vault-300">
          <Users className="size-7" />
        </div>
        <h1 className="text-xl font-semibold text-fg">You've been invited</h1>
        <p className="text-sm text-fg-muted">
          Sign in to join the family and access shared documents and events.
        </p>
        <Button fullWidth onClick={() => navigate("/login")}>
          Sign in to continue
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      {mutation.isPending || mutation.isIdle ? (
        <>
          <Spinner className="size-7" />
          <p className="text-sm text-fg-muted">Accepting your invite…</p>
        </>
      ) : mutation.isSuccess ? (
        <Card className="w-full space-y-4 p-6">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-success/15 text-success">
            <CheckCircle2 className="size-7" />
          </div>
          <h1 className="text-xl font-semibold text-fg">Welcome to the family!</h1>
          <p className="text-sm text-fg-muted">
            You now have access to shared documents, events, and reminders.
          </p>
          <Button fullWidth onClick={() => navigate("/")}>
            Go to dashboard
          </Button>
        </Card>
      ) : (
        <Card className="w-full space-y-4 p-6">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-danger/15 text-danger">
            <XCircle className="size-7" />
          </div>
          <h1 className="text-xl font-semibold text-fg">Invite unavailable</h1>
          <p className="text-sm text-fg-muted">
            {(() => {
              const msg = (mutation.error as Error)?.message;
              if (msg === "invite_expired") return "This invite has expired. Ask for a new one.";
              if (msg === "invite_already_used") return "This invite has already been used.";
              if (msg === "already_a_member") return "You're already part of this family.";
              if (msg === "not_found") return "This invite link is invalid.";
              return "We couldn't accept this invite.";
            })()}
          </p>
          <Button variant="secondary" fullWidth onClick={() => navigate("/")}>
            Go home
          </Button>
        </Card>
      )}
    </div>
  );
}
