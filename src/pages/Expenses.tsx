import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueries } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Lock,
  Plus,
  Search,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Fab } from "../components/ui/Fab";
import { EmptyState } from "../components/ui/EmptyState";
import { MoneySubNav } from "../components/money/MoneySubNav";
import { LiquidPillTabs } from "../components/ui/LiquidPillTabs";
import { SpendCalendar } from "../components/money/SpendCalendar";
import { CategoryDonut } from "../components/money/CategoryDonut";
import { Skeleton } from "../components/ui/Skeleton";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { formatMoney, monthRange, todayIsoDate } from "../lib/money";
import { categoryQueryValue, type DaySpend } from "../lib/spendClarity";
import type { Overview as OverviewData } from "../lib/finance";
import { cn } from "../lib/cn";
import { haptic } from "../lib/haptics";

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
  byDay: DaySpend[];
}

interface ExpenseListItem {
  id: string;
  amountMinor: number;
  currency: string;
  expenseDate: string;
  merchant: string | null;
  description: string | null;
  visibility: "family" | "private";
  childCount: number;
  childrenTotalMinor: number;
  nestDepth?: number;
  category: { id: string; name: string; color: string | null } | null;
}

type View = "mine" | "family";

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

// ---------------------------------------------------------------------------
// Category breakdown — tappable, so the donut and the ledger stay in sync.
// ---------------------------------------------------------------------------

function CategoryBreakdown({
  rows,
  currency,
  totalMinor,
  selectedKey,
  onSelect,
}: {
  rows: SummaryResponse["byCategory"];
  currency: string;
  totalMinor: number;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.totalMinor), 1);

  return (
    <ul className="mt-3 space-y-2">
      {rows.map((r) => {
        const key = categoryQueryValue(r.categoryId);
        const share = totalMinor > 0 ? (r.totalMinor / totalMinor) * 100 : 0;
        const active = selectedKey === key;
        return (
          <li key={key}>
            <button
              type="button"
              onClick={() => {
                haptic("selection");
                onSelect(active ? null : key);
              }}
              aria-pressed={active}
              className={cn(
                "w-full rounded-xl px-1 py-1.5 text-left transition-colors",
                "hover:bg-white/5 active:scale-[0.99]",
                active && "bg-white/8",
              )}
            >
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
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Six-month trend — change over time, one hue, only the selected bar labelled.
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
    <Card className="rounded-[28px] border-white/15 bg-white/8 p-4 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.45)] backdrop-blur-xl">
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

function FilterChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex min-h-8 items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2.5 text-xs text-fg"
    >
      {label}
      <X className="size-3" aria-hidden="true" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Expenses() {
  const { activeFamilyId } = useAuth();
  const navigate = useNavigate();

  const [today] = useState(() => todayIsoDate());
  const [monthStart, setMonthStart] = useState(() => `${today.slice(0, 7)}-01`);
  const [view, setView] = useState<View>("mine");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [categoryKey, setCategoryKey] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const { from, to } = useMemo(() => monthRange(monthStart), [monthStart]);
  const trendFrom = useMemo(() => shiftMonth(monthStart, -5), [monthStart]);
  const listFrom = dayFilter ?? from;
  const listTo = dayFilter ?? to;

  const summaryQ = useQuery({
    queryKey: ["expenses", "summary", activeFamilyId, from, to, view],
    queryFn: () =>
      api<SummaryResponse>(
        `/expenses/summary?familyId=${activeFamilyId}&from=${from}&to=${to}&view=${view}`,
      ),
    enabled: Boolean(activeFamilyId),
  });

  const trendQ = useQuery({
    queryKey: ["expenses", "trend", activeFamilyId, trendFrom, to, view],
    queryFn: () =>
      api<SummaryResponse>(
        `/expenses/summary?familyId=${activeFamilyId}&from=${trendFrom}&to=${to}&view=${view}`,
      ),
    enabled: Boolean(activeFamilyId),
  });

  const overviewQ = useQuery({
    queryKey: ["finance", "overview", activeFamilyId, from],
    queryFn: () =>
      api<OverviewData>(
        `/finance/overview?familyId=${activeFamilyId}&date=${from}&months=1`,
      ),
    enabled: Boolean(activeFamilyId),
  });

  const listQ = useQuery({
    queryKey: [
      "expenses",
      "list",
      activeFamilyId,
      listFrom,
      listTo,
      view,
      q,
      categoryKey,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        familyId: activeFamilyId!,
        from: listFrom,
        to: listTo,
        view,
      });
      if (q) params.set("q", q);
      if (categoryKey) params.set("categoryId", categoryKey);
      return api<{ expenses: ExpenseListItem[]; totalMinor: number }>(
        `/expenses?${params.toString()}`,
      );
    },
    enabled: Boolean(activeFamilyId),
  });

  const expandedIds = [...expanded];
  const childrenQueries = useQueries({
    queries: expandedIds.map((expenseId) => ({
      queryKey: ["expenses", "detail", expenseId],
      queryFn: () =>
        api<{
          expense: ExpenseListItem;
          children: ExpenseListItem[];
        }>(`/expenses/${expenseId}`),
      enabled: Boolean(activeFamilyId),
    })),
  });

  const childrenMap = useMemo(() => {
    const map = new Map<string, ExpenseListItem[]>();
    expandedIds.forEach((expenseId, i) => {
      const kids = childrenQueries[i]?.data?.children;
      if (kids) map.set(expenseId, kids);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by expanded set + query data
  }, [expanded, childrenQueries]);

  const currency = summaryQ.data?.currency ?? "USD";
  const incomeMinor = overviewQ.data?.plan.incomeMinor ?? 0;
  const spentMinor = summaryQ.data?.totalMinor ?? 0;
  const netMinor = incomeMinor - spentMinor;
  const selectedCategory = summaryQ.data?.byCategory.find(
    (r) => categoryQueryValue(r.categoryId) === categoryKey,
  );

  const byDay = useMemo(() => {
    const groups = new Map<string, ExpenseListItem[]>();
    for (const e of listQ.data?.expenses ?? []) {
      const arr = groups.get(e.expenseDate) ?? [];
      arr.push(e);
      groups.set(e.expenseDate, arr);
    }
    return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [listQ.data]);

  const filtered = Boolean(q || categoryKey || dayFilter);

  function changeMonth(next: string) {
    setMonthStart(next);
    setDayFilter(null);
  }

  function toggleExpand(expenseId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(expenseId)) next.delete(expenseId);
      else next.add(expenseId);
      return next;
    });
  }

  function rowAmount(e: ExpenseListItem): string {
    const minor = e.childCount > 0 ? e.childrenTotalMinor : e.amountMinor;
    return formatMoney(minor, e.currency);
  }

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
      <AppBar title="Spending" />
      <Page width="list" className="space-y-4 pb-24">
        <MoneySubNav />
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => changeMonth(shiftMonth(monthStart, -1))}
            aria-label="Previous month"
            className="flex size-10 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-white/5 active:scale-95"
          >
            <ChevronLeft className="size-5" />
          </button>
          <span className="text-sm font-semibold text-fg">{monthLabel(monthStart)}</span>
          <button
            type="button"
            onClick={() => changeMonth(shiftMonth(monthStart, 1))}
            aria-label="Next month"
            className="flex size-10 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-white/5 active:scale-95"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>

        <LiquidPillTabs
          ariaLabel="Whose expenses"
          value={view}
          onChange={setView}
          items={[
            { id: "mine", label: "Mine", icon: Lock },
            { id: "family", label: "Shared", icon: Users },
          ]}
        />

        <Card className="rounded-[28px] border-white/15 bg-white/8 p-5 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          {summaryQ.isLoading ? (
            <>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-9 w-40" />
            </>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                    Expense
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-fg">
                    {formatMoney(spentMinor, currency)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                    Income
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-success">
                    {formatMoney(incomeMinor, currency)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                    Balance
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-lg font-bold tabular-nums",
                      netMinor < 0 ? "text-danger" : "text-fg",
                    )}
                  >
                    {formatMoney(netMinor, currency)}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-xs text-fg-muted">
                {summaryQ.data?.count ?? 0} expense
                {(summaryQ.data?.count ?? 0) === 1 ? "" : "s"} in {monthLabel(monthStart)}
                {incomeMinor > 0 ? " · income is this payday cycle" : ""}
              </p>
              {view === "family" && (summaryQ.data?.sharedMinor ?? 0) > 0 && (
                <p className="mt-1 text-xs text-fg-subtle">
                  {formatMoney(summaryQ.data?.privateMinor ?? 0, currency)} yours ·{" "}
                  {formatMoney(summaryQ.data?.sharedMinor ?? 0, currency)} shared
                </p>
              )}
            </>
          )}
        </Card>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search merchant or note…"
            className="w-full rounded-2xl border border-line bg-surface-2 py-2.5 pl-10 pr-4 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
            aria-label="Search expenses"
          />
        </div>

        {filtered && (
          <div className="flex flex-wrap gap-2">
            {q ? (
              <FilterChip
                label={`“${q}”`}
                onClear={() => {
                  setSearch("");
                  setQ("");
                }}
              />
            ) : null}
            {selectedCategory ? (
              <FilterChip
                label={selectedCategory.name}
                onClear={() => setCategoryKey(null)}
              />
            ) : null}
            {dayFilter ? (
              <FilterChip label={dayLabel(dayFilter)} onClear={() => setDayFilter(null)} />
            ) : null}
          </div>
        )}

        {trendQ.data && (
          <TrendStrip
            byMonth={trendQ.data.byMonth}
            currency={currency}
            selectedMonth={monthStart}
            onSelect={changeMonth}
          />
        )}

        {summaryQ.data && summaryQ.data.byCategory.length > 0 && (
          <Card className="rounded-[28px] border-white/15 bg-white/8 p-4 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <h2 className="text-sm font-semibold text-fg">Where it went</h2>
            <p className="mt-0.5 text-[11px] text-fg-subtle">Tap a slice or row to filter the list</p>
            <div className="mt-3">
              <CategoryDonut
                rows={summaryQ.data.byCategory}
                totalMinor={summaryQ.data.totalMinor}
                currency={currency}
                selectedKey={categoryKey}
                onSelect={setCategoryKey}
              />
            </div>
            <CategoryBreakdown
              rows={summaryQ.data.byCategory}
              currency={currency}
              totalMinor={summaryQ.data.totalMinor}
              selectedKey={categoryKey}
              onSelect={setCategoryKey}
            />
          </Card>
        )}

        {summaryQ.data && (
          <Card className="rounded-[28px] border-white/15 bg-white/8 p-4 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <h2 className="text-sm font-semibold text-fg">This month</h2>
            <p className="mt-0.5 text-[11px] text-fg-subtle">Darker days spent more. Tap a day to zoom in.</p>
            <div className="mt-3">
              <SpendCalendar
                monthStart={monthStart}
                byDay={summaryQ.data.byDay ?? []}
                selectedDate={dayFilter}
                onSelect={setDayFilter}
              />
            </div>
          </Card>
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
            title={filtered ? "Nothing matches" : "Nothing recorded yet"}
            description={
              filtered
                ? "Clear a filter or search a different merchant."
                : `No expenses in ${monthLabel(monthStart)}. Tap + to add your first one — it stays private to you unless you share it.`
            }
          />
        ) : (
          <div className="space-y-4">
            {byDay.map(([date, items]) => (
              <div key={date}>
                <p className="px-1 pb-1.5 text-xs font-medium text-fg-subtle">
                  {dayLabel(date)}
                </p>
                <Card className="divide-y divide-line overflow-hidden">
                  {items.map((e) => {
                    const isOpen = expanded.has(e.id);
                    const kids = childrenMap.get(e.id) ?? [];
                    return (
                      <div key={e.id}>
                        <div className="flex w-full min-h-14 items-center gap-1 px-2 py-1">
                          {e.childCount > 0 ? (
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              aria-label={isOpen ? "Collapse sub-expenses" : "Expand sub-expenses"}
                              onClick={() => toggleExpand(e.id)}
                              className="flex size-10 shrink-0 items-center justify-center rounded-full text-fg-subtle hover:bg-white/5"
                            >
                              <ChevronDown
                                className={cn(
                                  "size-4 transition-transform",
                                  isOpen ? "rotate-0" : "-rotate-90",
                                )}
                              />
                            </button>
                          ) : (
                            <span className="size-10 shrink-0" aria-hidden="true" />
                          )}
                          <button
                            type="button"
                            onClick={() => navigate(`/money/expenses/${e.id}`)}
                            className="flex min-w-0 flex-1 items-center gap-3 py-2 pr-2 text-left transition-colors hover:bg-white/5 active:bg-white/[0.07]"
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
                                {e.childCount > 0 ? ` · ${e.childCount} sub` : ""}
                              </span>
                            </span>
                            <span className="flex w-24 shrink-0 items-center justify-end gap-2">
                              {e.visibility === "private" ? (
                                <Lock className="size-3.5 text-fg-subtle" aria-label="Private" />
                              ) : (
                                <Users className="size-3.5 text-vault-300" aria-label="Shared" />
                              )}
                              <span className="min-w-[4.5rem] text-right text-sm font-semibold tabular-nums text-fg">
                                {rowAmount(e)}
                              </span>
                            </span>
                          </button>
                        </div>
                        {isOpen && kids.length > 0 && (
                          <ul className="border-t border-line/60 bg-ink-950/40">
                            {kids.map((child) => (
                              <li key={child.id}>
                                <button
                                  type="button"
                                  onClick={() => navigate(`/money/expenses/${child.id}`)}
                                  className="flex w-full min-h-11 items-center gap-3 py-2 pr-4 pl-14 text-left hover:bg-white/5"
                                >
                                  <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
                                    {child.merchant || child.description || "Sub-expense"}
                                  </span>
                                  <span className="text-sm tabular-nums text-fg">
                                    {rowAmount(child)}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </Card>
              </div>
            ))}
          </div>
        )}
      </Page>

      <Fab icon={Plus} label="Add expense" onClick={() => navigate("/money/expenses/new")} />
    </>
  );
}
