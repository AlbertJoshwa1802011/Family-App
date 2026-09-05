import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Receipt, Plus, Wallet } from "lucide-react";
import { useState } from "react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { Fab } from "../components/ui/Fab";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface ExpenseSummary {
  id: string;
  amount: number;
  amountCents: number;
  currency: string;
  category: string;
  note: string | null;
  spentOn: string;
}

function formatMoney(amount: number, currency: string): string {
  const formatted = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  if (currency === "INR") return `₹${formatted}`;
  if (currency === "USD") return `$${formatted}`;
  if (currency === "EUR") return `€${formatted}`;
  if (currency === "GBP") return `£${formatted}`;
  return `${formatted} ${currency}`;
}

const CATEGORIES = [
  "food",
  "groceries",
  "transport",
  "household",
  "medical",
  "education",
  "entertainment",
  "travel",
  "other",
] as const;

export function Expenses() {
  const { activeFamily } = useAuth();
  const [composerOpen, setComposerOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["expenses", activeFamily?.id],
    queryFn: () =>
      api<{ expenses: ExpenseSummary[]; total: number }>(
        `/expenses?familyId=${activeFamily!.id}`,
      ),
    enabled: Boolean(activeFamily),
  });

  const expenses = data?.expenses ?? [];
  const total = data?.total ?? 0;
  const currency = expenses[0]?.currency ?? "INR";

  return (
    <>
      <AppBar title="Expenses" back />
      <Page className="space-y-4">
        {isLoading ? (
          <Card className="divide-y divide-line" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex min-h-14 items-center gap-3 px-4 py-3">
                <Skeleton className="size-10 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </Card>
        ) : expenses.length === 0 && !composerOpen ? (
          <EmptyState
            icon={Wallet}
            title="No expenses yet"
            description="Log snacks, groceries, and bills — or just tell the assistant “add 100 for outside snacks”."
            action={
              <Button
                leadingIcon={<Plus className="size-4" />}
                onClick={() => setComposerOpen(true)}
              >
                Add expense
              </Button>
            }
          />
        ) : (
          <>
            <Card className="p-4">
              <div className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">
                All time
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-white">
                {formatMoney(total, currency)}
              </div>
              <div className="mt-0.5 text-xs text-fg-muted">
                {expenses.length} {expenses.length === 1 ? "entry" : "entries"}
              </div>
            </Card>
            <Card className="divide-y divide-line overflow-hidden">
              {expenses.map((e) => (
                <div key={e.id} className="flex min-h-14 items-center gap-3 px-4 py-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-vault-500/10 text-vault-300">
                    <Receipt className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-fg">
                      {e.note?.trim() || e.category}
                    </div>
                    <div className="mt-0.5 text-xs text-fg-muted">
                      {e.spentOn} · {e.category}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums text-fg">
                      {formatMoney(e.amount, e.currency)}
                    </div>
                    <Badge tone="neutral">{e.category}</Badge>
                  </div>
                </div>
              ))}
            </Card>
          </>
        )}

        {composerOpen && activeFamily && (
          <ExpenseComposer
            familyId={activeFamily.id}
            onClose={() => setComposerOpen(false)}
          />
        )}
      </Page>
      <Fab icon={Plus} label="Add expense" onClick={() => setComposerOpen(true)} />
    </>
  );
}

function ExpenseComposer({
  familyId,
  onClose,
}: {
  familyId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("food");
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api("/expenses", {
        method: "POST",
        body: JSON.stringify({
          familyId,
          amount: Number(amount),
          category,
          note: note.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["expenses"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setError("");
    create.mutate();
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4">
      <Card className="space-y-3 p-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
            Amount <span className="text-danger">*</span>
          </label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="100"
            autoFocus
            className="w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
            What for
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. outside snacks"
            className="w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
            Category
          </label>
          <select
            value={category}
            onChange={(e) =>
              setCategory(e.target.value as (typeof CATEGORIES)[number])
            }
            className="w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg focus:border-vault-500 focus:outline-none"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={create.isPending} className="flex-1">
            Add expense
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </Card>
    </form>
  );
}
