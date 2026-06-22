import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/Button";

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

export function Login() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) navigate("/", { replace: true });
  }, [isAuthenticated, navigate]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex size-20 items-center justify-center rounded-3xl bg-vault-600/20 ring-1 ring-vault-500/30">
        <ShieldCheck className="size-10 text-vault-300" aria-hidden="true" />
      </div>

      <h1 className="mt-6 text-3xl font-bold tracking-tight text-fg">
        Family Vault
      </h1>
      <p className="mt-3 max-w-xs text-sm leading-relaxed text-fg-muted">
        Keep your family's important documents safe, organized, and never miss
        an expiry again.
      </p>

      <Button
        size="lg"
        variant="white"
        fullWidth
        loading={isLoading}
        leadingIcon={<GoogleIcon />}
        onClick={() => {
          // Phase 1: kick off Google OAuth (Auth Code + PKCE).
          window.location.href = "/api/auth/google/start";
        }}
        className="mt-10 max-w-xs"
      >
        Continue with Google
      </Button>

      <p className="mt-8 text-xs text-fg-subtle">
        Phase 0 scaffold · sign-in activates in Phase 1
      </p>
    </div>
  );
}
