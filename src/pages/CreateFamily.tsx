import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Home, LogOut, Shield, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { inputCls } from "../lib/fieldCls";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

/**
 * First-run onboarding: a signed-in user with no family memberships lands here.
 * Every other screen needs an active family (all API resources are
 * family-scoped), so this is the mandatory first step.
 */
export function CreateFamily() {
  const { user, setActiveFamilyId, signOut } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const isSuperAdmin = Boolean(user?.appRoles?.includes("super_admin"));

  const create = useMutation({
    mutationFn: () =>
      api<{ family: { id: string } }>("/families", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      }),
    onSuccess: async (res) => {
      setActiveFamilyId(res.family.id);
      // /auth/me returns the new membership → unlocks the rest of the app.
      await qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give your family vault a name");
      return;
    }
    setError("");
    create.mutate();
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <span className="lq lq-tint lq-raised mx-auto flex size-14 items-center justify-center rounded-full text-vault-300 [--lq-tint:var(--color-vault-400)]">
          <Home className="size-7" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-2xl font-bold text-white">
          Welcome{user?.name ? `, ${user.name.split(" ")[0]}` : ""} 👋
        </h1>
        <p className="mt-2 text-sm text-fg-muted">
          Create your family vault to start storing documents, tracking
          expiries, and coordinating together.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <Card className="p-4">
          <label
            htmlFor="family-name"
            className="mb-1.5 block text-xs font-semibold text-fg-muted"
          >
            Family name <span className="text-danger">*</span>
          </label>
          <input
            id="family-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. The Sharma Family"
            autoFocus
            className={inputCls}
          />
          {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
        </Card>

        <Button
          type="submit"
          variant="primary"
          fullWidth
          loading={create.isPending}
          className="mt-4"
        >
          Create family vault
        </Button>
      </form>

      <p className="mt-6 flex items-start gap-2 text-xs text-fg-subtle">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-vault-400" />
        You'll be the owner. Invite family members afterwards from the Family
        tab — you control who sees what.
      </p>

      {isSuperAdmin && (
        <Link
          to="/admin"
          className="lq lq-press mt-6 flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-fg"
        >
          <Shield className="size-4" aria-hidden="true" />
          Review demo requests
        </Link>
      )}

      <Button
        type="button"
        variant="ghost"
        fullWidth
        loading={signingOut}
        leadingIcon={<LogOut className="size-4" />}
        className="mt-8"
        onClick={() => {
          setSigningOut(true);
          void signOut();
        }}
      >
        Sign out
      </Button>
    </div>
  );
}
