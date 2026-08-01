import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Filter, Lock, Plus, Receipt, Search, X } from "lucide-react";
import { AppBar } from "../../components/ui/AppBar";
import { Page } from "../../components/ui/Page";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Fab } from "../../components/ui/Fab";
import { EmptyState } from "../../components/ui/EmptyState";
import { ListItem } from "../../components/ui/ListItem";
import { Skeleton } from "../../components/ui/Skeleton";
import { Sheet } from "../../components/ui/Sheet";
import { Chip, ChipGroup } from "../../components/ui/Field";
import { AddExpenseSheet } from "../../components/expenses/AddExpenseSheet";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import {
  categoryColorClasses,
  relativeDayLabel,
  todayIsoLocal,
  useEnsureExpenseSetup,
  useExpenseList,
  type Expense,
  type ExpenseCategory,
  type ExpenseListFilters,
} from "../../lib/expenses";
import { formatMoney } from "../../../shared/money";

function monthStartIso(offset = 0): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return todayIsoLocal(d);
}

function monthEndIso(offset = 0): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offset + 1, 0);
  return todayIsoLocal(d);
}

function yearStartIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
}

type RangePreset = "this-month" | "last-month" | "this-year" | "all" | "custom";

function ExpenseRowSkeleton() {
  return (
    <div className="flex min-h-16 items-center gap-3 px-4 py-3">
      <Skeleton className="size-10 rounded-xl" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <Skeleton className="h-4 w-14" />
    </div>
  );
}

function ExpenseRow({ expense }: { expense: Expense }) {
  const colors = categoryColorClasses(expense.categoryColor);
  const title = expense.merchant ?? expense.categoryName ?? "Expense";
  const subtitle = [expense.categoryName, expense.subcategoryName].filter(Boolean).join(" · ");
  // Without a merchant, the title already IS the category name — showing it
  // again as the subtitle is the "Cash / Cash" redundancy from Phase B.
  const showSubtitle = subtitle && subtitle !== title;

  return (
    <ListItem
      to={`/expenses/${expense.id}`}
      showChevron={false}
      leading={
        <span
          aria-hidden="true"
          className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl text-lg", colors.bg)}
        >
          {expense.subcategoryEmoji ?? expense.categoryEmoji ?? "📌"}
        </span>
      }
      title={title}
      subtitle={showSubtitle ? subtitle : undefined}
      trailing={
        <div className="flex shrink-0 items-center gap-1.5 text-right">
          {expense.visibility === "private" && (
            <Lock className="size-3.5 text-fg-subtle" aria-label="Private expense" />
          )}
          <span className="text-sm font-semibold tabular-nums text-fg">
            {formatMoney(expense.amountMinor, expense.currency)}
          </span>
        </div>
      }
    />
  );
}

interface FilterState {
  preset: RangePreset;
  from?: string;
  to?: string;
  categoryId?: string;
  paymentMethodId?: string;
}

const DEFAULT_FILTERS: FilterState = { preset: "this-month", from: monthStartIso(), to: monthEndIso() };

function toApiFilters(filters: FilterState, q: string): ExpenseListFilters {
  return {
    from: filters.from,
    to: filters.to,
    categoryId: filters.categoryId,
    paymentMethodId: filters.paymentMethodId,
    q: q || undefined,
  };
}

export function ExpenseList() {
  const { activeFamily } = useAuth();
  const familyId = activeFamily?.id;

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const apiFilters = useMemo(() => toApiFilters(filters, debouncedSearch), [filters, debouncedSearch]);
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useExpenseList(
    familyId,
    apiFilters,
  );

  const { data: categoriesData } = useQuery({
    queryKey: ["expense-categories", familyId],
    queryFn: () => api<{ categories: ExpenseCategory[] }>(`/expense-categories?familyId=${familyId}`),
    enabled: Boolean(familyId),
  });

  const expenses = data?.pages.flatMap((p) => p.expenses) ?? [];
  const hasAnyData = (data?.pages[0]?.expenses.length ?? 0) > 0 || expenses.length > 0;

  // First visit to the module installs the family's default categories,
  // payment methods and settings (idempotent server-side).
  const { isSettingUp } = useEnsureExpenseSetup(
    familyId,
    !isLoading && !hasAnyData && filters.preset === "this-month" && !debouncedSearch,
  );

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const isFiltered =
    filters.preset !== "this-month" || filters.categoryId || filters.paymentMethodId || debouncedSearch;

  // Group the flattened, already-sorted (newest first) list into day sections.
  const grouped: { label: string; items: Expense[] }[] = [];
  for (const expense of expenses) {
    const label = relativeDayLabel(expense.spentOn);
    const last = grouped[grouped.length - 1];
    if (last && last.label === label) last.items.push(expense);
    else grouped.push({ label, items: [expense] });
  }

  return (
    <>
      <AppBar title="Expenses" back />
      <Page className="space-y-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
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
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute top-1/2 right-3 -translate-y-1/2 text-fg-subtle hover:text-fg"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => setFilterSheetOpen(true)}
            aria-label="Filter expenses"
            className={cn(
              "relative flex size-11 shrink-0 items-center justify-center rounded-xl border transition-colors",
              isFiltered
                ? "border-vault-500/40 bg-vault-500/15 text-vault-300"
                : "border-line text-fg-muted hover:bg-white/5",
            )}
          >
            <Filter className="size-4" aria-hidden="true" />
            {isFiltered && (
              <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-vault-400" aria-hidden="true" />
            )}
          </button>
        </div>

        {isLoading || isSettingUp ? (
          <Card className="divide-y divide-line" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <ExpenseRowSkeleton key={i} />
            ))}
          </Card>
        ) : expenses.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={isFiltered ? "No expenses match" : "No expenses yet"}
            description={
              isFiltered
                ? "Try a different search or clear your filters."
                : "Add your first expense to start seeing where your money goes."
            }
            action={
              isFiltered ? (
                <Button variant="secondary" onClick={() => setFilters(DEFAULT_FILTERS)}>
                  Clear filters
                </Button>
              ) : (
                <Button leadingIcon={<Plus className="size-4" />} onClick={() => setAddOpen(true)}>
                  Add expense
                </Button>
              )
            }
          />
        ) : (
          <div className="space-y-5">
            {grouped.map((group) => (
              <section key={group.label} className="space-y-2">
                <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
                  {group.label}
                </h3>
                <Card className="divide-y divide-line overflow-hidden">
                  {group.items.map((expense) => (
                    <ExpenseRow key={expense.id} expense={expense} />
                  ))}
                </Card>
              </section>
            ))}
            <div ref={sentinelRef} className="h-1" />
            {isFetchingNextPage && (
              <div className="flex justify-center py-2">
                <Skeleton className="h-4 w-24" />
              </div>
            )}
          </div>
        )}
      </Page>

      <Fab icon={Plus} label="Add expense" onClick={() => setAddOpen(true)} />

      {addOpen && familyId && (
        <AddExpenseSheet familyId={familyId} onClose={() => setAddOpen(false)} />
      )}

      <Sheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="Filter expenses"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              fullWidth
              onClick={() => {
                setFilters(DEFAULT_FILTERS);
                setFilterSheetOpen(false);
              }}
            >
              Clear
            </Button>
            <Button fullWidth onClick={() => setFilterSheetOpen(false)}>
              Apply
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <p className="text-xs font-semibold text-fg-muted">Date range</p>
          <ChipGroup label="Date range">
            {(
              [
                ["this-month", "This month"],
                ["last-month", "Last month"],
                ["this-year", "This year"],
                ["all", "All time"],
              ] as [RangePreset, string][]
            ).map(([preset, label]) => (
              <Chip
                key={preset}
                selected={filters.preset === preset}
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    preset,
                    from:
                      preset === "this-month"
                        ? monthStartIso()
                        : preset === "last-month"
                          ? monthStartIso(-1)
                          : preset === "this-year"
                            ? yearStartIso()
                            : undefined,
                    to:
                      preset === "this-month"
                        ? monthEndIso()
                        : preset === "last-month"
                          ? monthEndIso(-1)
                          : preset === "this-year"
                            ? todayIsoLocal()
                            : undefined,
                  }))
                }
              >
                {label}
              </Chip>
            ))}
            <Chip
              selected={filters.preset === "custom"}
              onClick={() => setFilters((f) => ({ ...f, preset: "custom" }))}
            >
              Custom
            </Chip>
          </ChipGroup>
          {filters.preset === "custom" && (
            <div className="flex items-center gap-2 pt-1">
              <input
                type="date"
                value={filters.from ?? ""}
                max={filters.to}
                onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || undefined }))}
                className="w-full rounded-xl border border-line bg-ink-950 px-3 py-2.5 text-sm text-fg focus:border-vault-500 focus:outline-none"
              />
              <span className="text-fg-subtle">–</span>
              <input
                type="date"
                value={filters.to ?? ""}
                min={filters.from}
                max={todayIsoLocal()}
                onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || undefined }))}
                className="w-full rounded-xl border border-line bg-ink-950 px-3 py-2.5 text-sm text-fg focus:border-vault-500 focus:outline-none"
              />
            </div>
          )}
        </div>

        {categoriesData && categoriesData.categories.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-fg-muted">Category</p>
            <ChipGroup label="Category">
              {categoriesData.categories.map((cat) => (
                <Chip
                  key={cat.id}
                  selected={filters.categoryId === cat.id}
                  onClick={() =>
                    setFilters((f) => ({
                      ...f,
                      categoryId: f.categoryId === cat.id ? undefined : cat.id,
                    }))
                  }
                >
                  <span aria-hidden="true" className="mr-1">
                    {cat.emoji}
                  </span>
                  {cat.name}
                </Chip>
              ))}
            </ChipGroup>
          </div>
        )}
      </Sheet>
    </>
  );
}
