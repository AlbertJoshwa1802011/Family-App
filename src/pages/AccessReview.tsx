import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { api, ApiError } from "../lib/api";

type ReviewState =
  | { kind: "working" }
  | { kind: "ok"; status: string }
  | { kind: "error"; message: string };

export function AccessReview() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const action = params.get("action") === "reject" ? "reject" : "approve";
  const [state, setState] = useState<ReviewState>(() =>
    token
      ? { kind: "working" }
      : { kind: "error", message: "This review link is missing a token." },
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api<{ ok: boolean; status: string }>("/access/review", {
          method: "POST",
          body: JSON.stringify({ token, action }),
        });
        if (!cancelled) setState({ kind: "ok", status: res.status });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === "already_reviewed") {
          setState({ kind: "ok", status: "already reviewed" });
          return;
        }
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : "Could not complete review.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, action]);

  const approved = state.kind === "ok" && state.status === "approved";
  const rejected = state.kind === "ok" && state.status === "rejected";

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex size-20 items-center justify-center rounded-3xl bg-vault-600/20 ring-1 ring-vault-500/30">
        {state.kind === "working" ? (
          <ShieldCheck className="size-9 text-vault-300" aria-hidden="true" />
        ) : approved ? (
          <CheckCircle2 className="size-9 text-success" aria-hidden="true" />
        ) : rejected ? (
          <XCircle className="size-9 text-danger" aria-hidden="true" />
        ) : (
          <ShieldCheck className="size-9 text-vault-300" aria-hidden="true" />
        )}
      </div>

      <h1 className="mt-6 text-2xl font-bold tracking-tight text-white">
        {state.kind === "working"
          ? "Applying your decision…"
          : approved
            ? "Access approved"
            : rejected
              ? "Request rejected"
              : state.kind === "ok"
                ? "Already handled"
                : "Couldn’t complete"}
      </h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-fg-muted">
        {state.kind === "working"
          ? "Hang tight while we update the access grant."
          : state.kind === "ok"
            ? approved
              ? "They can now sign in with Google using the email on their request."
              : rejected
                ? "They’ve been notified that access wasn’t approved."
                : "This access request was already reviewed."
            : state.message}
      </p>

      <div className="mt-8 flex flex-col items-center gap-3">
        <Link
          to="/admin/access"
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-white px-6 text-base font-semibold text-slate-900"
        >
          Open app access
        </Link>
        <Link to="/login" className="text-xs text-fg-subtle underline">
          Back to login
        </Link>
      </div>
    </div>
  );
}
