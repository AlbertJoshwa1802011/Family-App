import { useQuery } from "@tanstack/react-query";
import { Lock, Plus, Receipt, Search, Users, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Fab } from "../components/ui/Fab";
import { ListItem } from "../components/ui/ListItem";
import { Page } from "../components/ui/Page";
import { Skeleton } from "../components/ui/Skeleton";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { formatMoney, monthRange, todayIsoDate } from "../lib/money";

interface ExpenseCategory {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  builtin: boolean;
}

export interface ExpenseSummary {
  id: string;
  amountMinor: number;
  currency: string;
  expenseDate: string;
  merchant: string | null;
  description: string | null;
  visibility: "family" | "private";
  splitType: "none" | "equal" | "exact" | "percentage";
  scope: "personal" | "shared";
  category: {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
  } | null;
  paidByMemberId: string;
}

function RowSkeleton() {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <Skeleton className="size-10 rounded-xl" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <Skeleton className="h-3.5 w-14" />
    </div>
  );
}

function groupByDate(expenses: ExpenseSummary[]) {
  const groups = new Map<string, ExpenseSummary[]>();
  for (const e of expenses) {
    const list = groups.get(e.expenseDate) ?? [];
    list.push(e);
    groups.set(e.expenseDate, list);
  }
  return [...groups.entries()];
}

function formatDayLabel(iso: string, today: string) {
  if (iso === today) return "Today";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

export function Expenses() {
  const navigate = useNavigate();
  const { activeFamily } = useAuth();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [today] = useState(() => todayIsoDate());
  const { from, to } = useMemo(() => monthRange(today), [today]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data: catData } = useQuery({
    queryKey: ["expense-categories", activeFamily?.id],
    queryFn: () =>
      api<{ categories: ExpenseCategory[] }>(
        `/expenses/categories?familyId=${activeFamily!.id}`,
      ),
    enabled: Boolean(activeFamily),
  });

  const params = new URLSearchParams({
    familyId: activeFamily?.id ?? "",
    from,
    to,
    scope: "personal",
  });
  if (debounced) params.set("q", debounced);
  if (categoryId) params.set("categoryId", categoryId);

  const { data, isLoading } = useQuery({
    queryKey: ["expenses", activeFamily?.id, from, to, debounced, categoryId],
    queryFn: () =>
      api<{ expenses: ExpenseSummary[]; totalMinor: number }>(
        `/expenses?${params.toString()}`,
      ),
    enabled: Boolean(activeFamily),
  });

  const expenses = data?.expenses ?? [];
  const totalMinor = data?.totalMinor ?? 0;
  const currency = activeFamily?.defaultCurrency ?? "USD";
  const groups = groupByDate(expenses);
  const categories = catData?.categories ?? [];

  return (
    <>
      <AppBar title="Expenses" />
      <Page className="space-y-4">
        <Card className="flex items-center justify-between gap-3 p-4">
          <div>
            <div className="text-xs font-medium text-fg-muted">This month</div>
            <div className="mt-0.5 text-2xl font-bold tabular-nums text-fg">
              {formatMoney(totalMinor, currency)}
            </div>
            <div className="mt-0.5 text-xs text-fg-subtle">
              {expenses.length} personal expense
              {expenses.length === 1 ? "" : "s"}
            </div>
          </div>
          <span className="flex size-11 items-center justify-center rounded-2xl bg-vault-500/15 text-vault-300">
            <Wallet className="size-5" aria-hidden="true" />
          </span>
        </Card>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search merchant or notes…"
            aria-label="Search expenses"
            className="w-full rounded-xl border border-line bg-surface py-3 pr-10 pl-10 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-3 -translate-y-1/2 text-fg-subtle hover:text-fg"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setCategoryId("")}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              !categoryId
                ? "border-vault-500 bg-vault-500/15 text-vault-200"
                : "border-line text-fg-muted"
            }`}
          >
            All
          </button>
          {categories.slice(0, 12).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryId(c.id === categoryId ? "" : c.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                categoryId === c.id
                  ? "border-vault-500 bg-vault-500/15 text-vault-200"
                  : "border-line text-fg-muted"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        {isLoading ? (
          <Card className="divide-y divide-line" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <RowSkeleton key={i} />
            ))}
          </Card>
        ) : expenses.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={debounced || categoryId ? "No matches" : "No expenses this month"}
            description={
              debounced || categoryId
                ? "Try a different search or category."
                : "Log a purchase in seconds — amount, category, done."
            }
            action={
              !debounced && !categoryId ? (
                <Button
                  leadingIcon={<Plus className="size-4" />}
                  onClick={() => navigate("/expenses/new")}
                >
                  Add expense
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-4">
            {groups.map(([date, rows]) => (
              <section key={date} className="space-y-2">
                <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
                  {formatDayLabel(date, today)}
                </h3>
                <Card className="divide-y divide-line overflow-hidden">
                  {rows.map((e) => (
                    <ListItem
                      key={e.id}
                      to={`/expenses/${e.id}`}
                      leading={
                        <span className="flex size-10 items-center justify-center rounded-xl bg-vault-500/10 text-vault-300">
                          <Receipt className="size-5" aria-hidden="true" />
                        </span>
                      }
                      title={
                        <span className="inline-flex items-center gap-1.5">
                          {e.merchant || e.category?.name || "Expense"}
                          {e.visibility === "private" ? (
                            <Lock
                              className="size-3.5 text-fg-subtle"
                              aria-label="Private"
                            />
                          ) : (
                            <Users
                              className="size-3.5 text-fg-subtle"
                              aria-label="Visible to family"
                            />
                          )}
                        </span>
                      }
                      subtitle={
                        e.scope === "personal"
                          ? (e.category?.name ?? "Personal")
                          : `Shared · ${e.category?.name ?? "Expense"}`
                      }
                      trailing={
                        <span className="text-sm font-semibold tabular-nums text-fg">
                          {formatMoney(e.amountMinor, e.currency)}
                        </span>
                      }
                    />
                  ))}
                </Card>
              </section>
            ))}
          </div>
        )}
      </Page>
      <Fab
        icon={Plus}
        label="Add expense"
        onClick={() => navigate("/expenses/new")}
      />
    </>
  );
}
