import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/Button";
import { Field, Input, Textarea } from "../components/ui/Field";
import { api, ApiError } from "../lib/api";

function GoogleIcon() {
  return (
    <svg className="size-5" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.3C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.1-11.3-7.5l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.5l6.2 5.3C39.9 36.2 44 30.7 44 24c0-1.3-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}

const LOGIN_ERRORS: Record<string, string> = {
  access_denied:
    "This app is invite-only. Request a demo below and we'll email you when you're approved.",
  access_revoked:
    "Your access was revoked. Contact your team admin if you think that's a mistake.",
  rate_limited: "Too many sign-in attempts — wait a moment and try again.",
  oauth_not_configured: "Sign-in isn't configured on this server yet.",
  missing_params: "Sign-in didn't finish — please try again.",
  invalid_state: "Sign-in expired — please try again.",
  token_exchange_failed: "Google sign-in failed — please try again.",
  token_invalid: "Google sign-in failed — please try again.",
  user_create_failed: "We couldn't create your account — please try again.",
};

type Mode = "request" | "signin";

export function Login() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const oauthError = params.get("error");

  const initialMode: Mode =
    oauthError === "access_denied" || oauthError === "access_revoked"
      ? "request"
      : "signin";

  const [mode, setMode] = useState<Mode>(initialMode);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(() =>
    oauthError
      ? (LOGIN_ERRORS[oauthError] ?? "Sign-in didn't work — please try again.")
      : "",
  );
  const [success, setSuccess] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (isAuthenticated) navigate("/", { replace: true });
  }, [isAuthenticated, navigate]);

  async function startGoogle() {
    setStarting(true);
    setError("");
    setSuccess("");
    // Full-page GET so phones never sit on a JSON 404. The Worker 302s to Google.
    window.location.assign("/api/auth/google/start");
  }

  async function submitDemo(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const res = await api<{ ok: boolean; status: string; deduped?: boolean }>(
        "/access/demo-requests",
        {
          method: "POST",
          body: JSON.stringify({
            name,
            email,
            company: company || undefined,
            message: message || undefined,
          }),
        },
      );
      if (res.status === "already_approved") {
        setSuccess("You're already approved — sign in with Google below.");
        setMode("signin");
      } else if (res.deduped) {
        setSuccess(
          "We already have your request. We'll email you when an admin approves access.",
        );
      } else {
        setSuccess(
          "Request sent. Check your email for confirmation — we'll notify you when you're approved.",
        );
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not send your request.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12 text-center">
      <div className="lq lq-tint lq-raised flex size-22 items-center justify-center rounded-full [--lq-tint:var(--color-vault-400)]">
        <ShieldCheck className="size-10 text-vault-300" aria-hidden="true" />
      </div>

      <h1 className="mt-6 text-3xl font-bold tracking-tight text-white">
        Family Vault
      </h1>
      <p className="mt-3 max-w-xs text-sm leading-relaxed text-fg-muted">
        Sign in with Google to open your family vault. New teammates can request
        a demo for approval.
      </p>

      <div className="mt-8 flex w-full max-w-xs gap-2">
        <button
          type="button"
          onClick={() => setMode("signin")}
          className={`lq lq-press flex-1 rounded-2xl px-3 py-2 text-sm font-medium ${
            mode === "signin" ? "lq-primary text-white" : "text-fg-muted"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode("request")}
          className={`lq lq-press flex-1 rounded-2xl px-3 py-2 text-sm font-medium ${
            mode === "request" ? "lq-primary text-white" : "text-fg-muted"
          }`}
        >
          Request demo
        </button>
      </div>

      {mode === "request" ? (
        <form
          onSubmit={submitDemo}
          className="mt-6 w-full max-w-xs space-y-3 text-left"
        >
          <Field label="Your name" required>
            <Input
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex"
            />
          </Field>
          <Field label="Work email" required>
            <Input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </Field>
          <Field label="Company / team">
            <Input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Field label="Why do you need access?">
            <Textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Optional note for the admin"
            />
          </Field>
          <Button type="submit" size="lg" fullWidth loading={submitting}>
            Request access
          </Button>
        </form>
      ) : (
        <Button
          type="button"
          size="lg"
          variant="white"
          fullWidth
          loading={isLoading || starting}
          leadingIcon={<GoogleIcon />}
          onClick={() => void startGoogle()}
          className="mt-6 max-w-xs"
        >
          Continue with Google
        </Button>
      )}

      {error && (
        <p className="mt-3 max-w-xs text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="mt-3 max-w-xs text-xs text-success" role="status">
          {success}
        </p>
      )}

      <p className="mt-8 text-xs text-fg-subtle">
        New here?{" "}
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => setMode("request")}
        >
          Request a demo
        </button>
        .
      </p>
    </div>
  );
}
