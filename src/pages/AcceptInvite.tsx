import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Home } from "lucide-react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/ui/Spinner";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";

const ERROR_MESSAGES: Record<string, string> = {
  invite_email_mismatch:
    "This invite was sent to a different email address. Sign in with the Google account the invite was sent to.",
  invite_expired: "This invite has expired — ask for a new one.",
  invite_already_used: "This invite has already been used.",
  already_a_member: "You're already a member of this family.",
  not_found: "This invite link isn't valid.",
};

/** Landing page for invite links: POSTs the token once and reports the result. */
export function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { setActiveFamilyId } = useAuth();
  const fired = useRef(false);

  const accept = useMutation({
    mutationFn: () =>
      api<{ ok: true; familyId: string }>(
        `/families/invites/${token}/accept`,
        { method: "POST" },
      ),
    onSuccess: async (res) => {
      setActiveFamilyId(res.familyId);
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate("/family", { replace: true });
    },
  });

  // Fire exactly once on mount (StrictMode double-invokes effects).
  useEffect(() => {
    if (!fired.current && token) {
      fired.current = true;
      accept.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const errorKey =
    accept.error instanceof ApiError ? accept.error.message : undefined;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <Card className="p-6 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-vault-500/15 text-vault-300">
          <Home className="size-6" aria-hidden="true" />
        </span>
        {accept.isError ? (
          <>
            <h1 className="mt-4 text-lg font-semibold text-white">
              Couldn't join the family
            </h1>
            <p className="mt-2 text-sm text-fg-muted">
              {(errorKey && ERROR_MESSAGES[errorKey]) ??
                "Something went wrong accepting this invite."}
            </p>
            <Button
              variant="secondary"
              fullWidth
              className="mt-5"
              onClick={() => navigate("/", { replace: true })}
            >
              Go home
            </Button>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-lg font-semibold text-white">
              Joining the family…
            </h1>
            <div className="mt-4 flex justify-center">
              <Spinner />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
