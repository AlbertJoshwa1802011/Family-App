import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Users, XCircle } from "lucide-react";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Spinner } from "../components/ui/Spinner";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";

/**
 * Invite-acceptance landing page (`/invite/:token` and `/join/:token`).
 * Requires login; AuthOnly preserves the path via `?next=` through Google OAuth.
 */
export function JoinInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAuthenticated, isLoading } = useAuth();

  const mutation = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; familyId: string }>(`/families/invites/${token}/accept`, {
        method: "POST",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: ["family-members"] });
    },
  });

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
    return (
      <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-vault-500/10 text-vault-300">
          <Users className="size-7" />
        </div>
        <h1 className="text-xl font-semibold text-fg">You've been invited</h1>
        <p className="text-sm text-fg-muted">
          Sign in with the invited Google account to join the family.
        </p>
        <Button
          fullWidth
          onClick={() =>
            navigate(`/login?next=${encodeURIComponent(`/invite/${token ?? ""}`)}`)
          }
        >
          Sign in to continue
        </Button>
      </div>
    );
  }

  const errMsg =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error instanceof Error
        ? mutation.error.message
        : "Could not accept this invite.";

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
          <h1 className="text-xl font-semibold text-fg">Invite couldn&apos;t be accepted</h1>
          <p className="text-sm text-fg-muted">{errMsg}</p>
          <Button fullWidth variant="secondary" onClick={() => navigate("/")}>
            Back home
          </Button>
        </Card>
      )}
    </div>
  );
}
