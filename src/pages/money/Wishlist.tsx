import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Gift, Plus, Sparkles, Trash2 } from "lucide-react";
import { AppBar } from "../../components/ui/AppBar";
import { Page } from "../../components/ui/Page";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Fab } from "../../components/ui/Fab";
import { Modal } from "../../components/ui/Modal";
import { Skeleton } from "../../components/ui/Skeleton";
import { EmptyState } from "../../components/ui/EmptyState";
import { MoneySubNav } from "../../components/money/MoneySubNav";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import { formatMoney, parseMajorToMinor, todayIsoDate } from "../../lib/money";
import type { Overview } from "../../lib/finance";
import { cn } from "../../lib/cn";

interface WishlistItem {
  id: string;
  name: string;
  notes: string | null;
  estimatedCostMinor: number;
  currency: string;
  priority: number;
  status: "wanted" | "saving" | "purchased" | "dropped";
  monthsToAfford: number | null;
  affordableFrom: string | null;
}

const PRIORITY_LABEL: Record<number, string> = {
  1: "Must have",
  2: "High",
  3: "Normal",
  4: "Low",
  5: "Someday",
};

const inputClass =
  "w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none";

function affordLabel(item: WishlistItem): string {
  if (item.status === "purchased") return "Bought";
  if (item.monthsToAfford === null) return "Not saving yet";
  if (item.monthsToAfford <= 0) return "Affordable now";
  if (item.monthsToAfford === 1) return "About a month away";
  return `About ${item.monthsToAfford} months away`;
}

export function Wishlist() {
  const { activeFamilyId } = useAuth();
  const qc = useQueryClient();
  const [today] = useState(() => todayIsoDate());
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<WishlistItem | null>(null);

  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [priority, setPriority] = useState(3);
  const [formError, setFormError] = useState<string | null>(null);

  // The surplus is what makes affordability real rather than a guess.
  const overviewQ = useQuery({
    queryKey: ["finance", "overview", activeFamilyId, today],
    queryFn: () =>
      api<Overview>(`/finance/overview?familyId=${activeFamilyId}&date=${today}&months=6`),
    enabled: Boolean(activeFamilyId),
  });
  const surplusMinor = Math.max(overviewQ.data?.plan.projectedSavingsMinor ?? 0, 0);
  const currency = overviewQ.data?.currency ?? "USD";

  const listQ = useQuery({
    queryKey: ["wishlist", activeFamilyId, surplusMinor],
    queryFn: () =>
      api<{ items: WishlistItem[]; totalWantedMinor: number }>(
        `/wishlist?familyId=${activeFamilyId}&surplusMinor=${surplusMinor}`,
      ),
    enabled: Boolean(activeFamilyId),
  });

  const create = useMutation({
    mutationFn: async () => {
      const minor = parseMajorToMinor(cost, currency);
      if (!name.trim()) throw new Error("Give it a name.");
      if (minor === null || minor <= 0) throw new Error("Enter a valid cost.");
      return api("/wishlist", {
        method: "POST",
        body: JSON.stringify({
          familyId: activeFamilyId,
          name: name.trim(),
          estimatedCostMinor: minor,
          currency,
          priority,
        }),
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["wishlist"] });
      setAddOpen(false);
      setName("");
      setCost("");
      setPriority(3);
    },
    onError: (e: unknown) => setFormError(e instanceof Error ? e.message : "Could not add it."),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: WishlistItem["status"] }) =>
      api(`/wishlist/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wishlist"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/wishlist/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["wishlist"] });
      setConfirmDelete(null);
    },
  });

  const items = listQ.data?.items ?? [];
  const open = items.filter((i) => i.status === "wanted" || i.status === "saving");
  const done = items.filter((i) => i.status === "purchased" || i.status === "dropped");

  return (
    <>
      <AppBar title="Wishlist" />
      <Page width="list" className="space-y-4 pb-24">
        <MoneySubNav />

        {open.length > 0 && (
          <Card className="p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
              Saving toward
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-fg">
              {formatMoney(listQ.data?.totalWantedMinor ?? 0, currency)}
            </p>
            <p className="mt-0.5 text-xs text-fg-subtle">
              {surplusMinor > 0 ? (
                <>
                  At {formatMoney(surplusMinor, currency)} spare a month, in priority order.
                </>
              ) : (
                <>Add income and a savings target to see when you can afford these.</>
              )}
            </p>
          </Card>
        )}

        {listQ.isLoading ? (
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
        ) : items.length === 0 ? (
          <EmptyState
            icon={Gift}
            title="Nothing on the list"
            description="Add things you want to buy. Family Vault ranks them by priority and tells you when each one becomes affordable."
            action={
              <Button leadingIcon={<Plus className="size-4" />} onClick={() => setAddOpen(true)}>
                Add something
              </Button>
            }
          />
        ) : (
          <>
            {open.length > 0 && (
              <Card className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {open.map((item) => (
                    // Two lines so the name and the "when can I afford it"
                    // answer both survive at phone width.
                    <li key={item.id} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-vault-600/20 text-vault-300"
                          aria-hidden="true"
                        >
                          <Sparkles className="size-4" />
                        </span>
                        <p className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                          {item.name}
                        </p>
                        <div className="flex shrink-0 items-center">
                          <button
                            type="button"
                            aria-label={`Mark ${item.name} as bought`}
                            onClick={() => setStatus.mutate({ id: item.id, status: "purchased" })}
                            className="flex size-9 items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-success/10 hover:text-success"
                          >
                            <Check className="size-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${item.name}`}
                            onClick={() => setConfirmDelete(item)}
                            className="flex size-9 items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-danger/10 hover:text-danger"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-0.5 flex items-baseline justify-between gap-3 pl-[3.25rem]">
                        <span className="truncate text-xs text-fg-muted">
                          {PRIORITY_LABEL[item.priority] ?? "Normal"} · {affordLabel(item)}
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">
                          {formatMoney(item.estimatedCostMinor, item.currency)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {done.length > 0 && (
              <div>
                <p className="px-1 pb-1.5 text-xs font-medium text-fg-subtle">Done</p>
                <Card className="overflow-hidden opacity-60">
                  <ul className="divide-y divide-line">
                    {done.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-fg line-through">
                            {item.name}
                          </p>
                        </div>
                        <Badge tone={item.status === "purchased" ? "success" : "neutral"}>
                          {item.status === "purchased" ? "Bought" : "Dropped"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            )}
          </>
        )}
      </Page>

      <Fab icon={Plus} label="Add to wishlist" onClick={() => setAddOpen(true)} />

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add to wishlist"
        footer={
          <>
            <Button variant="secondary" fullWidth onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button fullWidth loading={create.isPending} onClick={() => { setFormError(null); create.mutate(); }}>
              Add
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="wl-name" className="text-xs font-medium text-fg-subtle">
              What is it?
            </label>
            <input
              id="wl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Washing machine"
              className={cn(inputClass, "mt-1")}
            />
          </div>
          <div>
            <label htmlFor="wl-cost" className="text-xs font-medium text-fg-subtle">
              Roughly how much? ({currency})
            </label>
            <input
              id="wl-cost"
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="0.00"
              className={cn(inputClass, "mt-1 tabular-nums")}
            />
          </div>
          <div>
            <p className="text-xs font-medium text-fg-subtle">Priority</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  aria-pressed={priority === p}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    priority === p
                      ? "border-vault-500/40 bg-vault-500/15 text-vault-300"
                      : "border-line text-fg-muted hover:bg-white/5",
                  )}
                >
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          </div>
          {formError && (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Remove from wishlist?"
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
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">{confirmDelete?.name} will be removed.</p>
      </Modal>
    </>
  );
}
