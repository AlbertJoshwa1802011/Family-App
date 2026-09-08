import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Shield } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";
import { ModuleAccessPicker } from "../components/ModuleAccessPicker";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  FAMILY_MODULES,
  MODULE_META,
  type FamilyModule,
} from "../lib/modules";

interface FamilyMember {
  id: string;
  userId: string | null;
  memberType: "user" | "dependent";
  displayName: string | null;
  name: string | null;
  email: string | null;
  picture: string | null;
  role: "owner" | "admin" | "member";
  status: "active" | "invited" | "removed";
  modules: FamilyModule[];
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/**
 * Admin page: one place to decide which modules each person can use.
 * Invite flow sets the same fields; this page edits them later.
 */
export function FamilyAccessPage() {
  const { activeFamily, user } = useAuth();
  const qc = useQueryClient();
  const familyId = activeFamily?.id;
  const canEdit =
    activeFamily?.role === "owner" || activeFamily?.role === "admin";

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftById, setDraftById] = useState<Record<string, FamilyModule[]>>(
    {},
  );
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["family-members", familyId],
    queryFn: () =>
      api<{ members: FamilyMember[] }>(`/families/${familyId}/members`),
    enabled: Boolean(familyId) && canEdit,
  });

  const members = (data?.members ?? []).filter(
    (m) => m.status === "active" && m.memberType === "user",
  );
  const selected = members.find((m) => m.id === selectedId) ?? null;
  const draft =
    selected == null
      ? [...FAMILY_MODULES]
      : (draftById[selected.id] ?? [...selected.modules]);

  function selectMember(m: FamilyMember) {
    setSelectedId(m.id);
    setDraftById((prev) =>
      prev[m.id] ? prev : { ...prev, [m.id]: [...m.modules] },
    );
    setError("");
  }

  const save = useMutation({
    mutationFn: () =>
      api(`/families/${familyId}/members/${selected!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ modules: draft }),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["family-members"] });
      await qc.invalidateQueries({ queryKey: ["me"] });
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!canEdit) {
    return (
      <>
        <AppBar title="Member access" back />
        <Page>
          <EmptyState
            icon={Shield}
            title="Admins only"
            description="Only family owners and admins can customise which menus each person sees."
          />
        </Page>
      </>
    );
  }

  return (
    <>
      <AppBar title="Member access" back />
      <Page className="space-y-5">
        <p className="text-sm text-fg-muted">
          Choose the areas each person can open. Changes apply immediately —
          their menus update on the next refresh.
        </p>

        {isLoading ? (
          <Card className="space-y-3 p-4">
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </Card>
        ) : (
          <section className="space-y-2">
            <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              People
            </h3>
            <Card className="divide-y divide-white/8 overflow-hidden">
              {members.map((m) => {
                const label = m.displayName ?? m.name ?? m.email ?? "Member";
                const active = m.id === selectedId;
                const summary =
                  m.role === "owner"
                    ? "All modules"
                    : m.modules.length === FAMILY_MODULES.length
                      ? "All modules"
                      : m.modules.length === 0
                        ? "No modules"
                        : m.modules
                            .map((id) => MODULE_META[id].label)
                            .join(" · ");
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => selectMember(m)}
                    className={`lq-press flex w-full items-center gap-3 px-4 py-3 text-left ${
                      active ? "bg-white/6" : ""
                    }`}
                  >
                    <Avatar name={label} src={m.picture} email={m.email} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-fg">
                          {label}
                          {m.userId === user?.id ? " (you)" : ""}
                        </span>
                        <Badge tone="neutral">{ROLE_LABELS[m.role]}</Badge>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-fg-subtle">
                        {summary}
                      </span>
                    </span>
                  </button>
                );
              })}
            </Card>
          </section>
        )}

        {selected && (
          <Card className="space-y-4 p-4">
            <div>
              <p className="text-sm font-medium text-fg">
                Access for{" "}
                {selected.displayName ??
                  selected.name ??
                  selected.email ??
                  "member"}
              </p>
              <p className="mt-1 text-xs text-fg-subtle">
                Turn off anything they don&apos;t need. API calls to those
                areas are blocked too.
              </p>
            </div>
            <ModuleAccessPicker
              value={draft}
              onChange={(next) =>
                setDraftById((prev) => ({ ...prev, [selected.id]: next }))
              }
              locked={selected.role === "owner"}
              disabled={save.isPending}
            />
            {error && <p className="text-xs text-danger">{error}</p>}
            {selected.role !== "owner" && (
              <Button
                variant="primary"
                fullWidth
                loading={save.isPending}
                onClick={() => save.mutate()}
              >
                Save access
              </Button>
            )}
          </Card>
        )}
      </Page>
    </>
  );
}
