import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { useQueryClient } from "@tanstack/react-query";

export function Settings() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-white">Settings</h1>
      <div className="rounded-xl border border-white/10 bg-ink-800 p-4 text-sm text-slate-300">
        <div>Signed in as: {user?.email ?? "—"}</div>
        <p className="mt-2 text-slate-400">
          Reminder preferences (channels &amp; lead times) arrive in Phase 3.
        </p>
      </div>
      <button
        onClick={async () => {
          await api("/auth/logout", { method: "POST" });
          await qc.invalidateQueries({ queryKey: ["me"] });
        }}
        className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5"
      >
        Sign out
      </button>
    </div>
  );
}
