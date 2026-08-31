import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Plus, Repeat, Trash2 } from "lucide-react";
import { AppBar } from "../../components/ui/AppBar";
import { Page } from "../../components/ui/Page";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Fab } from "../../components/ui/Fab";
import { Modal } from "../../components/ui/Modal";
import { Skeleton } from "../../components/ui/Skeleton";
import { EmptyState } from "../../components/ui/EmptyState";
import { MoneySubNav } from "../../components/money/MoneySubNav";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import { formatMoney } from "../../lib/money";
import { KIND_LABEL, type Commitment, type CommitmentKind } from "../../lib/finance";
import { cn } from "../../lib/cn";

const KIND_TONE: Record<CommitmentKind, string> = {
  emi: "bg-m3-purple-bg text-m3-purple",
  loan: "bg-m3-purple-bg text-m3-purple",
  insurance: "bg-m3-blue-bg text-m3-blue",
  investment: "bg-m3-green-bg text-m3-green",
  subscription: "bg-m3-cyan-bg text-m3-cyan",
  giving: "bg-m3-red-bg text-m3-red",
  rent: "bg-m3-yellow-bg text-m3-yellow",
  utility: "bg-m3-cyan-bg text-m3-cyan",
  other: "bg-white/5 text-fg-muted",
};

function amountLabel(c: Commitment): string {
  if (c.amountKind === "percent_of_income") {
    return `${((c.percentBp ?? 0) / 100).toFixed(c.percentBp && c.percentBp % 100 ? 1 : 0)}% of income`;
  }
  return formatMoney(c.amountMinor ?? 0, c.currency);
}

export function Commitments() {
  const { activeFamilyId } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<Commitment | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["finance", "commitments", activeFamilyId],
    queryFn: () => api<{ commitments: Commitment[] }>(`/finance/commitments?familyId=${activeFamilyId}`),
    enabled: Boolean(activeFamilyId),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Commitment["status"] }) =>
      api(`/finance/commitments/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/finance/commitments/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["finance"] });
      setConfirmDelete(null);
    },
  });

  const commitments = data?.commitments ?? [];
  const active = commitments.filter((c) => c.status === "active");
  const inactive = commitments.filter((c) => c.status !== "active");

  const monthlyTotal = active
    .filter((c) => c.amountKind === "fixed" && c.cadence === "monthly")
    .reduce((s, c) => s + (c.amountMinor ?? 0), 0);
  const currency = commitments[0]?.currency ?? "USD";

  function renderRow(c: Commitment) {
    return (
      <li key={c.id} className="px-4 py-3">
        {/* Two lines: the name gets the full row width, and the amount gets its
            own slot underneath. A single line could not fit a real EMI name
            plus an amount plus two actions at phone width. */}
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl",
              KIND_TONE[c.kind],
            )}
            aria-hidden="true"
          >
            <Repeat className="size-4" />
          </span>
          <button
            type="button"
            onClick={() => navigate(`/money/commitments/${c.id}/edit`)}
            className="min-w-0 flex-1 text-left"
          >
            <span className="block truncate text-sm font-medium text-fg">{c.name}</span>
          </button>
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              aria-label={c.status === "active" ? `Pause ${c.name}` : `Resume ${c.name}`}
              onClick={() =>
                setStatus.mutate({ id: c.id, status: c.status === "active" ? "paused" : "active" })
              }
              className="flex size-9 items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-white/5"
            >
              {c.status === "active" ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
            <button
              type="button"
              aria-label={`Delete ${c.name}`}
              onClick={() => setConfirmDelete(c)}
              className="flex size-9 items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-3 pl-[3.25rem]">
          <span className="truncate text-xs text-fg-muted">
            {KIND_LABEL[c.kind]} · {c.cadence}
            {c.totalInstallments ? ` · ${c.totalInstallments} instalments` : ""}
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">
            {amountLabel(c)}
          </span>
        </div>
      </li>
    );
  }

  return (
    <>
      <AppBar title="Committed" />
      <Page width="list" className="space-y-4 pb-24">
        <MoneySubNav />

        {isLoading ? (
          <Card className="divide-y divide-line overflow-hidden">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-10 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </Card>
        ) : commitments.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title="Nothing committed yet"
            description="Add your EMIs, insurance premiums, investments and giving so the plan knows what's already spoken for each month."
            action={
              <Button leadingIcon={<Plus className="size-4" />} onClick={() => navigate("/money/commitments/new")}>
                Add a commitment
              </Button>
            }
          />
        ) : (
          <>
            {monthlyTotal > 0 && (
              <Card className="p-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                  Fixed every month
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-fg">
                  {formatMoney(monthlyTotal, currency)}
                </p>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  {active.length} active commitment{active.length === 1 ? "" : "s"}
                </p>
              </Card>
            )}

            {active.length > 0 && (
              <Card className="overflow-hidden">
                <ul className="divide-y divide-line">{active.map(renderRow)}</ul>
              </Card>
            )}

            {inactive.length > 0 && (
              <div>
                <p className="px-1 pb-1.5 text-xs font-medium text-fg-subtle">Paused &amp; finished</p>
                <Card className="overflow-hidden opacity-60">
                  <ul className="divide-y divide-line">{inactive.map(renderRow)}</ul>
                </Card>
              </div>
            )}
          </>
        )}
      </Page>

      <Fab icon={Plus} label="Add commitment" onClick={() => navigate("/money/commitments/new")} />

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete this commitment?"
        footer={
          <>
            <Button variant="secondary" fullWidth onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              fullWidth
              loading={remove.isPending}
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          {confirmDelete?.name} will stop counting toward your monthly plan. Expenses already
          recorded for it are kept.
        </p>
      </Modal>
    </>
  );
}
