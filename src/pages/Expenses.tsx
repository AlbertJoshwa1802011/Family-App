import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Lock,
  Plus,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Fab } from "../components/ui/Fab";
import { EmptyState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";
import { AiAssistant } from "../components/AiAssistant";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../lib/api";
import {
  currencyExponent,
  formatMajorFromMinor,
  formatMoney,
  monthRange,
  parseMajorToMinor,
  todayIsoDate,
} from "../lib/money";
import { cn } from "../lib/cn";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SummaryResponse {
  view: "mine" | "family";
  currency: string;
  totalMinor: number;
  count: number;
  privateMinor: number;
  sharedMinor: number;
  byCategory: {
    categoryId: string | null;
    name: string;
    icon: string | null;
    color: string | null;
    totalMinor: number;
    count: number;
  }[];
  byMonth: { month: string; totalMinor: number }[];
  byWeek: { week: string; totalMinor: number }[];
  recurringMonthlyMinor: number;
  budget: {
    incomeMinor: number;
    titheDueMinor: number;
    childrenGivingMinor: number;
    savingsGoalMinor: number;
    leftoverMinor: number;
  };
  spendAdvice: string;
}

interface ExpenseListItem {
  id: string;
  amountMinor: number;
  currency: string;
  expenseDate: string;
  merchant: string | null;
  description: string | null;
  visibility: "family" | "private";
  category: { id: string; name: string; color: string | null } | null;
}

interface MoneyPlan {
  id: string | null;
  familyId: string;
  userId: string;
  monthlyIncomeMinor: number;
  currency: string;
  tithePercent: number;
  childrenGivingMinor: number;
  savingsGoalMinor: number;
  createdAt: number | null;
  updatedAt: number | null;
}

type RecurringKind =
  | "emi"
  | "insurance"
  | "investment"
  | "subscription"
  | "tithe"
  | "children"
  | "other";

interface RecurringExpense {
  id: string;
  title: string;
  kind: RecurringKind;
  amountMinor: number;
  currency: string;
  interval: "monthly" | "weekly" | "yearly";
  startDate: string;
  dayOfMonth: number | null;
  visibility: "family" | "private";
  active: boolean;
}

type WishlistPriority = "must" | "should" | "want";
type WishlistStatus = "open" | "bought" | "dropped";

interface WishlistItem {
  id: string;
  title: string;
  estimatedMinor: number | null;
  currency: string;
  priority: WishlistPriority;
  status: WishlistStatus;
  url: string | null;
  notes: string | null;
}

type View = "mine" | "family";
type Tab = "spend" | "recurring" | "wishlist" | "plan";

const TABS: { key: Tab; label: string }[] = [
  { key: "spend", label: "Spend" },
  { key: "recurring", label: "Recurring" },
  { key: "wishlist", label: "Wishlist" },
  { key: "plan", label: "Plan" },
];

const RECURRING_KINDS: { value: RecurringKind; label: string }[] = [
  { value: "emi", label: "EMI" },
  { value: "insurance", label: "Insurance" },
  { value: "investment", label: "Investment" },
  { value: "subscription", label: "Subscription" },
  { value: "tithe", label: "Tithe" },
  { value: "children", label: "Children" },
  { value: "other", label: "Other" },
];

const PRIORITY_ORDER: Record<WishlistPriority, number> = {
  must: 0,
  should: 1,
  want: 2,
};

const inputClass =
  "w-full rounded-xl border border-line bg-ink-950 px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none";

// ---------------------------------------------------------------------------
// Month helpers
// ---------------------------------------------------------------------------

function shiftMonth(iso: string, delta: number): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function monthLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function weekShortLabel(week: string): string {
  // "2026-W12" → "W12"
  const m = week.match(/W(\d+)/);
  return m ? `W${m[1]}` : week.slice(-3);
}

// ---------------------------------------------------------------------------
// Category breakdown
// ---------------------------------------------------------------------------

function CategoryBreakdown({
  rows,
  currency,
  totalMinor,
}: {
  rows: SummaryResponse["byCategory"];
  currency: string;
  totalMinor: number;
}) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.totalMinor), 1);

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-fg">Where it went</h2>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => {
          const share = totalMinor > 0 ? (r.totalMinor / totalMinor) * 100 : 0;
          return (
            <li key={r.categoryId ?? "none"}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: r.color ?? "var(--color-fg-subtle)" }}
                  />
                  <span className="truncate text-sm text-fg">{r.name}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">
                  {formatMoney(r.totalMinor, currency)}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-vault-500"
                    style={{ width: `${Math.max((r.totalMinor / max) * 100, 2)}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-fg-subtle">
                  {share.toFixed(0)}%
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Six-month trend
// ---------------------------------------------------------------------------

function TrendStrip({
  byMonth,
  currency,
  selectedMonth,
  onSelect,
}: {
  byMonth: SummaryResponse["byMonth"];
  currency: string;
  selectedMonth: string;
  onSelect: (monthStart: string) => void;
}) {
  if (byMonth.length < 2) return null;
  const max = Math.max(...byMonth.map((m) => m.totalMinor), 1);
  const selectedKey = selectedMonth.slice(0, 7);

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-fg">Last 6 months</h2>
      <div className="mt-3 flex items-end justify-between gap-2">
        {byMonth.map((m) => {
          const active = m.month === selectedKey;
          const heightPct = Math.max((m.totalMinor / max) * 100, 3);
          return (
            <button
              key={m.month}
              type="button"
              onClick={() => onSelect(`${m.month}-01`)}
              className="group flex flex-1 flex-col items-center gap-1.5"
              aria-label={`${m.month}: ${formatMoney(m.totalMinor, currency)}`}
              aria-pressed={active}
            >
              <span className="flex h-20 w-full items-end justify-center">
                <span
                  className={cn(
                    "w-full max-w-8 rounded-t-[4px] transition-colors",
                    active ? "bg-vault-400" : "bg-vault-500/35 group-hover:bg-vault-500/60",
                  )}
                  style={{ height: `${heightPct}%` }}
                />
              </span>
              <span
                className={cn(
                  "text-[10px] tabular-nums",
                  active ? "font-semibold text-fg" : "text-fg-subtle",
                )}
              >
                {m.month.slice(5)}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function WeekStrip({
  byWeek,
  currency,
}: {
  byWeek: SummaryResponse["byWeek"];
  currency: string;
}) {
  if (byWeek.length === 0) return null;
  const max = Math.max(...byWeek.map((w) => w.totalMinor), 1);

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-fg">By week</h2>
      <div className="mt-3 flex items-end justify-between gap-2">
        {byWeek.map((w) => {
          const heightPct = Math.max((w.totalMinor / max) * 100, 3);
          return (
            <div
              key={w.week}
              className="group flex flex-1 flex-col items-center gap-1.5"
              title={`${w.week}: ${formatMoney(w.totalMinor, currency)}`}
            >
              <span className="flex h-16 w-full items-end justify-center">
                <span
                  className="w-full max-w-8 rounded-t-[4px] bg-vault-500/45"
                  style={{ height: `${heightPct}%` }}
                />
              </span>
              <span className="text-[10px] tabular-nums text-fg-subtle">
                {weekShortLabel(w.week)}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function BudgetCard({
  summary,
  spentMinor,
}: {
  summary: SummaryResponse;
  spentMinor: number;
}) {
  const { budget, currency, recurringMonthlyMinor, spendAdvice } = summary;
  const rows: { label: string; minor: number; tone?: "danger" | "success" }[] = [
    { label: "Income", minor: budget.incomeMinor },
    { label: "Tithe", minor: budget.titheDueMinor },
    { label: "Children giving", minor: budget.childrenGivingMinor },
    { label: "Savings goal", minor: budget.savingsGoalMinor },
    { label: "Spent", minor: spentMinor },
    { label: "Recurring / mo", minor: recurringMonthlyMinor },
    {
      label: "Leftover",
      minor: budget.leftoverMinor,
      tone: budget.leftoverMinor < 0 ? "danger" : "success",
    },
  ];

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold text-fg">Budget this month</h2>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.label} className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-fg-muted">{r.label}</span>
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                r.tone === "danger"
                  ? "text-danger"
                  : r.tone === "success"
                    ? "text-success"
                    : "text-fg",
              )}
            >
              {formatMoney(r.minor, currency)}
            </span>
          </li>
        ))}
      </ul>
      {spendAdvice && (
        <p className="rounded-xl border border-vault-500/25 bg-vault-500/10 px-3 py-2 text-xs leading-relaxed text-vault-200">
          {spendAdvice}
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Plan tab
// ---------------------------------------------------------------------------

function PlanTab({ familyId }: { familyId: string }) {
  const qc = useQueryClient();
  const planQ = useQuery({
    queryKey: ["expenses", "plan", familyId],
    queryFn: () =>
      api<{ plan: MoneyPlan }>(`/expenses/plan?familyId=${familyId}`),
  });

  if (planQ.isLoading || !planQ.data) {
    return (
      <Card className="space-y-3 p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </Card>
    );
  }

  return (
    <PlanForm
      key={`${planQ.data.plan.updatedAt ?? "new"}-${planQ.data.plan.monthlyIncomeMinor}`}
      familyId={familyId}
      plan={planQ.data.plan}
      onSaved={() => qc.invalidateQueries({ queryKey: ["expenses"] })}
    />
  );
}

function PlanForm({
  familyId,
  plan,
  onSaved,
}: {
  familyId: string;
  plan: MoneyPlan;
  onSaved: () => void;
}) {
  const currency = plan.currency || "USD";
  const [income, setIncome] = useState(() =>
    formatMajorFromMinor(plan.monthlyIncomeMinor, currency),
  );
  const [tithePercent, setTithePercent] = useState(String(plan.tithePercent));
  const [childrenGiving, setChildrenGiving] = useState(() =>
    formatMajorFromMinor(plan.childrenGivingMinor, currency),
  );
  const [savingsGoal, setSavingsGoal] = useState(() =>
    formatMajorFromMinor(plan.savingsGoalMinor, currency),
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const monthlyIncomeMinor = parseMajorToMinor(income, currency);
      if (monthlyIncomeMinor === null || monthlyIncomeMinor < 0) {
        throw new Error(
          `Enter income with at most ${currencyExponent(currency)} decimal places.`,
        );
      }
      const childrenGivingMinor = parseMajorToMinor(childrenGiving || "0", currency);
      if (childrenGivingMinor === null || childrenGivingMinor < 0) {
        throw new Error("Enter a valid children giving amount.");
      }
      const savingsGoalMinor = parseMajorToMinor(savingsGoal || "0", currency);
      if (savingsGoalMinor === null || savingsGoalMinor < 0) {
        throw new Error("Enter a valid savings goal.");
      }
      const pct = Number(tithePercent);
      if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
        throw new Error("Tithe percent must be a whole number 0–100.");
      }
      return api<{ plan: MoneyPlan }>(`/expenses/plan?familyId=${familyId}`, {
        method: "PUT",
        body: JSON.stringify({
          monthlyIncomeMinor,
          currency,
          tithePercent: pct,
          childrenGivingMinor,
          savingsGoalMinor,
        }),
      });
    },
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (e: unknown) => {
      setError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : "Could not save plan.",
      );
    },
  });

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-fg">Money plan</h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          Income and giving goals power the budget card on Spend.
        </p>
      </div>
      <div>
        <label htmlFor="plan-income" className="text-xs font-medium text-fg-subtle">
          Monthly income
        </label>
        <input
          id="plan-income"
          inputMode="decimal"
          value={income}
          onChange={(e) => setIncome(e.target.value)}
          className={cn(inputClass, "mt-1")}
        />
        <p className="mt-1 text-[11px] text-fg-subtle">{currency}</p>
      </div>
      <div>
        <label htmlFor="plan-tithe" className="text-xs font-medium text-fg-subtle">
          Tithe %
        </label>
        <input
          id="plan-tithe"
          inputMode="numeric"
          value={tithePercent}
          onChange={(e) => setTithePercent(e.target.value)}
          className={cn(inputClass, "mt-1")}
        />
      </div>
      <div>
        <label htmlFor="plan-children" className="text-xs font-medium text-fg-subtle">
          Children giving
        </label>
        <input
          id="plan-children"
          inputMode="decimal"
          value={childrenGiving}
          onChange={(e) => setChildrenGiving(e.target.value)}
          className={cn(inputClass, "mt-1")}
        />
      </div>
      <div>
        <label htmlFor="plan-savings" className="text-xs font-medium text-fg-subtle">
          Savings goal
        </label>
        <input
          id="plan-savings"
          inputMode="decimal"
          value={savingsGoal}
          onChange={(e) => setSavingsGoal(e.target.value)}
          className={cn(inputClass, "mt-1")}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button
        type="button"
        fullWidth
        loading={save.isPending}
        onClick={() => save.mutate()}
      >
        Save plan
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Recurring tab
// ---------------------------------------------------------------------------

function RecurringTab({
  familyId,
  currency,
}: {
  familyId: string;
  currency: string;
}) {
  const qc = useQueryClient();
  const [today] = useState(() => todayIsoDate());
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<RecurringKind>("emi");
  const [error, setError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["expenses", "recurring", familyId],
    queryFn: () =>
      api<{ recurring: RecurringExpense[] }>(
        `/expenses/recurring?familyId=${familyId}`,
      ),
  });

  const create = useMutation({
    mutationFn: async () => {
      const amountMinor = parseMajorToMinor(amount, currency);
      if (!title.trim()) throw new Error("Enter a title.");
      if (amountMinor === null || amountMinor <= 0) {
        throw new Error("Enter a valid amount.");
      }
      return api<{ recurring: RecurringExpense }>("/expenses/recurring", {
        method: "POST",
        body: JSON.stringify({
          familyId,
          title: title.trim(),
          kind,
          amountMinor,
          currency,
          interval: "monthly",
          startDate: today,
          visibility: "private",
        }),
      });
    },
    onSuccess: async () => {
      setTitle("");
      setAmount("");
      setError(null);
      await qc.invalidateQueries({ queryKey: ["expenses", "recurring"] });
      await qc.invalidateQueries({ queryKey: ["expenses", "summary"] });
    },
    onError: (e: unknown) => {
      setError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : "Could not add recurring.",
      );
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean }>(`/expenses/recurring/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["expenses", "recurring"] });
      await qc.invalidateQueries({ queryKey: ["expenses", "summary"] });
    },
  });

  const rows = listQ.data?.recurring ?? [];

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold text-fg">Add recurring</h2>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (EMI, insurance…)"
          maxLength={200}
          className={inputClass}
        />
        <div className="flex gap-2">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            className={cn(inputClass, "flex-1")}
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as RecurringKind)}
            className={cn(inputClass, "w-[40%]")}
          >
            {RECURRING_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button
          type="button"
          fullWidth
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          Add
        </Button>
      </Card>

      {listQ.isLoading ? (
        <Card className="space-y-2 p-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No recurring yet"
          description="Track EMIs, insurance, investments, tithe, and children's help."
        />
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex min-h-14 items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{r.title}</p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {RECURRING_KINDS.find((k) => k.value === r.kind)?.label ?? r.kind}
                  {" · "}
                  {r.interval}
                  {r.dayOfMonth ? ` · day ${r.dayOfMonth}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">
                {formatMoney(r.amountMinor, r.currency)}
              </span>
              <button
                type="button"
                aria-label={`Delete ${r.title}`}
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Delete "${r.title}"?`)) remove.mutate(r.id);
                }}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-fg-subtle hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wishlist tab
// ---------------------------------------------------------------------------

function WishlistTab({
  familyId,
  currency,
}: {
  familyId: string;
  currency: string;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [estimate, setEstimate] = useState("");
  const [priority, setPriority] = useState<WishlistPriority>("want");
  const [error, setError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["expenses", "wishlist", familyId],
    queryFn: () =>
      api<{ items: WishlistItem[] }>(`/expenses/wishlist?familyId=${familyId}`),
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Enter a title.");
      let estimatedMinor: number | null = null;
      if (estimate.trim()) {
        estimatedMinor = parseMajorToMinor(estimate, currency);
        if (estimatedMinor === null || estimatedMinor <= 0) {
          throw new Error("Enter a valid estimate.");
        }
      }
      return api<{ item: WishlistItem }>("/expenses/wishlist", {
        method: "POST",
        body: JSON.stringify({
          familyId,
          title: title.trim(),
          estimatedMinor,
          currency,
          priority,
        }),
      });
    },
    onSuccess: async () => {
      setTitle("");
      setEstimate("");
      setPriority("want");
      setError(null);
      await qc.invalidateQueries({ queryKey: ["expenses", "wishlist"] });
    },
    onError: (e: unknown) => {
      setError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : "Could not add item.",
      );
    },
  });

  const patch = useMutation({
    mutationFn: ({ id, status }: { id: string; status: WishlistStatus }) =>
      api<{ item: WishlistItem }>(`/expenses/wishlist/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["expenses", "wishlist"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean }>(`/expenses/wishlist/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["expenses", "wishlist"] });
    },
  });

  const items = useMemo(() => {
    const all = listQ.data?.items ?? [];
    return [...all].sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === "open") return -1;
        if (b.status === "open") return 1;
      }
      return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    });
  }, [listQ.data]);

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold text-fg">Add to wishlist</h2>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What do you want?"
          maxLength={200}
          className={inputClass}
        />
        <div className="flex gap-2">
          <input
            inputMode="decimal"
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            placeholder="Estimate (optional)"
            className={cn(inputClass, "flex-1")}
          />
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as WishlistPriority)}
            className={cn(inputClass, "w-[36%]")}
          >
            <option value="must">Must</option>
            <option value="should">Should</option>
            <option value="want">Want</option>
          </select>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button
          type="button"
          fullWidth
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          Add
        </Button>
      </Card>

      {listQ.isLoading ? (
        <Card className="space-y-2 p-4">
          <Skeleton className="h-10 w-full" />
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Wishlist is empty"
          description="Park must / should / want purchases here until you're ready."
        />
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex min-h-14 items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-sm font-medium",
                    item.status === "bought" || item.status === "dropped"
                      ? "text-fg-subtle line-through"
                      : "text-fg",
                  )}
                >
                  {item.title}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                  <Badge
                    tone={
                      item.priority === "must"
                        ? "danger"
                        : item.priority === "should"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {item.priority}
                  </Badge>
                  {item.status !== "open" && (
                    <span className="capitalize">{item.status}</span>
                  )}
                </p>
              </div>
              {item.estimatedMinor != null && (
                <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">
                  {formatMoney(item.estimatedMinor, item.currency)}
                </span>
              )}
              {item.status === "open" && (
                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-fg-muted hover:bg-white/5"
                  disabled={patch.isPending}
                  onClick={() => patch.mutate({ id: item.id, status: "bought" })}
                >
                  Bought
                </button>
              )}
              <button
                type="button"
                aria-label={`Delete ${item.title}`}
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Delete "${item.title}"?`))
                    remove.mutate(item.id);
                }}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-fg-subtle hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spend tab (ledger + charts)
// ---------------------------------------------------------------------------

function SpendTab({
  familyId,
  monthStart,
  setMonthStart,
  view,
  setView,
}: {
  familyId: string;
  monthStart: string;
  setMonthStart: (v: string | ((m: string) => string)) => void;
  view: View;
  setView: (v: View) => void;
}) {
  const navigate = useNavigate();
  const { from, to } = useMemo(() => monthRange(monthStart), [monthStart]);
  const trendFrom = useMemo(() => shiftMonth(monthStart, -5), [monthStart]);

  const summaryQ = useQuery({
    queryKey: ["expenses", "summary", familyId, from, to, view],
    queryFn: () =>
      api<SummaryResponse>(
        `/expenses/summary?familyId=${familyId}&from=${from}&to=${to}&view=${view}`,
      ),
  });

  const trendQ = useQuery({
    queryKey: ["expenses", "trend", familyId, trendFrom, to, view],
    queryFn: () =>
      api<SummaryResponse>(
        `/expenses/summary?familyId=${familyId}&from=${trendFrom}&to=${to}&view=${view}`,
      ),
  });

  const listQ = useQuery({
    queryKey: ["expenses", "list", familyId, from, to],
    queryFn: () =>
      api<{ expenses: ExpenseListItem[]; totalMinor: number }>(
        `/expenses?familyId=${familyId}&from=${from}&to=${to}`,
      ),
  });

  const currency = summaryQ.data?.currency ?? "USD";

  const byDay = useMemo(() => {
    const groups = new Map<string, ExpenseListItem[]>();
    for (const e of listQ.data?.expenses ?? []) {
      const arr = groups.get(e.expenseDate) ?? [];
      arr.push(e);
      groups.set(e.expenseDate, arr);
    }
    return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [listQ.data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setMonthStart((m) => shiftMonth(m, -1))}
          aria-label="Previous month"
          className="flex size-10 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-white/5 active:scale-95"
        >
          <ChevronLeft className="size-5" />
        </button>
        <span className="text-sm font-semibold text-fg">{monthLabel(monthStart)}</span>
        <button
          type="button"
          onClick={() => setMonthStart((m) => shiftMonth(m, 1))}
          aria-label="Next month"
          className="flex size-10 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-white/5 active:scale-95"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Whose expenses"
        className="flex rounded-xl border border-line bg-surface p-1"
      >
        {(
          [
            { key: "mine" as const, label: "My spending", icon: Lock },
            { key: "family" as const, label: "Shared view", icon: Users },
          ]
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors",
              view === key
                ? "bg-vault-500/15 text-vault-300"
                : "text-fg-subtle hover:text-fg-muted",
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <Card className="p-5">
        {summaryQ.isLoading ? (
          <>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-9 w-40" />
          </>
        ) : (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
              {view === "mine" ? "You spent" : "Family view"}
            </p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-fg">
              {formatMoney(summaryQ.data?.totalMinor ?? 0, currency)}
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              {summaryQ.data?.count ?? 0} expense
              {(summaryQ.data?.count ?? 0) === 1 ? "" : "s"} in {monthLabel(monthStart)}
            </p>
            {view === "family" && (summaryQ.data?.sharedMinor ?? 0) > 0 && (
              <p className="mt-2 text-xs text-fg-subtle">
                {formatMoney(summaryQ.data?.privateMinor ?? 0, currency)} yours ·{" "}
                {formatMoney(summaryQ.data?.sharedMinor ?? 0, currency)} shared
              </p>
            )}
          </>
        )}
      </Card>

      {summaryQ.data && (
        <BudgetCard
          summary={summaryQ.data}
          spentMinor={summaryQ.data.totalMinor}
        />
      )}

      {summaryQ.data && (
        <WeekStrip byWeek={summaryQ.data.byWeek ?? []} currency={currency} />
      )}

      {trendQ.data && (
        <TrendStrip
          byMonth={trendQ.data.byMonth}
          currency={currency}
          selectedMonth={monthStart}
          onSelect={setMonthStart}
        />
      )}

      {summaryQ.data && (
        <CategoryBreakdown
          rows={summaryQ.data.byCategory}
          currency={currency}
          totalMinor={summaryQ.data.totalMinor}
        />
      )}

      {listQ.isLoading ? (
        <Card className="divide-y divide-line overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-9 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </Card>
      ) : byDay.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Nothing recorded yet"
          description={`No expenses in ${monthLabel(monthStart)}. Tap + to add your first one — it stays private to you unless you share it.`}
        />
      ) : (
        <div className="space-y-4">
          {byDay.map(([date, items]) => (
            <div key={date}>
              <p className="px-1 pb-1.5 text-xs font-medium text-fg-subtle">
                {dayLabel(date)}
              </p>
              <Card className="divide-y divide-line overflow-hidden">
                {items.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => navigate(`/expenses/${e.id}`)}
                    className="flex w-full min-h-14 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5 active:bg-white/[0.07]"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-9 shrink-0 items-center justify-center rounded-xl"
                      style={{
                        backgroundColor: `${e.category?.color ?? "#64748b"}26`,
                      }}
                    >
                      <Wallet
                        className="size-4"
                        style={{ color: e.category?.color ?? "var(--color-fg-muted)" }}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {e.merchant || e.description || "Expense"}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-fg-muted">
                        {e.category?.name ?? "Uncategorized"}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {e.visibility === "private" ? (
                        <Lock className="size-3.5 text-fg-subtle" aria-label="Private" />
                      ) : (
                        <Badge tone="vault">Shared</Badge>
                      )}
                      <span className="text-sm font-semibold tabular-nums text-fg">
                        {formatMoney(e.amountMinor, e.currency)}
                      </span>
                    </span>
                  </button>
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Expenses() {
  const { activeFamilyId } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [today] = useState(() => todayIsoDate());
  const [monthStart, setMonthStart] = useState(() => `${today.slice(0, 7)}-01`);
  const [view, setView] = useState<View>("mine");

  const tabParam = searchParams.get("tab");
  const tab: Tab =
    tabParam === "recurring" ||
    tabParam === "wishlist" ||
    tabParam === "plan" ||
    tabParam === "spend"
      ? tabParam
      : "spend";

  function setTab(next: Tab) {
    if (next === "spend") {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: next }, { replace: true });
    }
  }

  // Currency for forms that don't load summary (recurring / wishlist).
  const planCurrencyQ = useQuery({
    queryKey: ["expenses", "plan", activeFamilyId],
    queryFn: () =>
      api<{ plan: MoneyPlan }>(`/expenses/plan?familyId=${activeFamilyId}`),
    enabled:
      Boolean(activeFamilyId) &&
      (tab === "recurring" || tab === "wishlist" || tab === "plan"),
    staleTime: 60_000,
  });
  const currency = planCurrencyQ.data?.plan.currency ?? "USD";

  if (!activeFamilyId) {
    return (
      <>
        <AppBar title="Expenses" />
        <Page width="list">
          <EmptyState
            icon={Wallet}
            title="No family yet"
            description="You need a family before you can track expenses."
          />
        </Page>
      </>
    );
  }

  return (
    <>
      <AppBar title="Expenses" />
      <Page width="list" className="space-y-4 pb-24">
        <div
          role="tablist"
          aria-label="Expenses sections"
          className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1"
        >
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "flex-1 whitespace-nowrap rounded-lg px-2 py-2 text-xs font-medium transition-colors",
                tab === key
                  ? "bg-vault-500/15 text-vault-300"
                  : "text-fg-subtle hover:text-fg-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "spend" && (
          <SpendTab
            familyId={activeFamilyId}
            monthStart={monthStart}
            setMonthStart={setMonthStart}
            view={view}
            setView={setView}
          />
        )}
        {tab === "recurring" && (
          <RecurringTab familyId={activeFamilyId} currency={currency} />
        )}
        {tab === "wishlist" && (
          <WishlistTab familyId={activeFamilyId} currency={currency} />
        )}
        {tab === "plan" && <PlanTab familyId={activeFamilyId} />}
      </Page>

      {tab === "spend" && (
        <Fab icon={Plus} label="Add expense" onClick={() => navigate("/expenses/new")} />
      )}
      <AiAssistant />
    </>
  );
}
