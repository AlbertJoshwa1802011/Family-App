import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function Login() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) navigate("/", { replace: true });
  }, [isAuthenticated, navigate]);

  return (
    <div className="flex min-h-full flex-col items-center justify-center p-6 text-center">
      <div className="text-5xl">🗄️</div>
      <h1 className="mt-4 text-2xl font-bold text-white">Family Vault</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-400">
        Keep your family's important documents safe, organized, and never miss an
        expiry again.
      </p>

      <button
        disabled={isLoading}
        onClick={() => {
          // Phase 1: kick off Google OAuth (Auth Code + PKCE).
          window.location.href = "/api/auth/google/start";
        }}
        className="mt-8 flex items-center gap-3 rounded-xl bg-white px-5 py-3 font-medium text-slate-800 shadow hover:bg-slate-100 disabled:opacity-50"
      >
        <span className="text-lg">🔐</span>
        Continue with Google
      </button>

      <p className="mt-6 text-xs text-slate-500">
        Phase 0 scaffold — Google sign-in is wired up in Phase 1.
      </p>
    </div>
  );
}
