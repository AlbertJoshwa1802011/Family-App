import { useEffect, useRef } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "./api";

/** Shapes returned by the expense config endpoints. */

export interface ExpenseCategory {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  emoji: string | null;
  color: string | null;
  sortOrder: number;
  isSystem: boolean;
  status: "active" | "archived";
  children: ExpenseCategory[];
}

export interface PaymentMethod {
  id: string;
  name: string;
  slug: string;
  kind: PaymentKind;
  emoji: string | null;
  sortOrder: number;
  isSystem: boolean;
  status: "active" | "archived";
}

export type PaymentKind = "cash" | "card" | "bank" | "upi" | "wallet" | "other";

export const PAYMENT_KINDS: { value: PaymentKind; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank" },
  { value: "upi", label: "UPI" },
  { value: "wallet", label: "Wallet" },
  { value: "other", label: "Other" },
];

export interface ExpenseSettings {
  familyId: string;
  defaultCurrency: string;
  weekStartsOn: number;
  monthStartDay: number;
}

export interface ExpenseSettingsResponse {
  settings: ExpenseSettings;
  initialized: boolean;
  canEdit: boolean;
}

/**
 * Category colours are stored as palette SLUGS, never raw hex, so a re-theme
 * never needs a data migration. The classes are spelled out in full because
 * Tailwind only generates what it can see literally in the source.
 */
export const CATEGORY_COLOR_CLASSES: Record<string, { bg: string; text: string }> = {
  amber: { bg: "bg-amber-500/15", text: "text-amber-300" },
  orange: { bg: "bg-orange-500/15", text: "text-orange-300" },
  rose: { bg: "bg-rose-500/15", text: "text-rose-300" },
  pink: { bg: "bg-pink-500/15", text: "text-pink-300" },
  violet: { bg: "bg-violet-500/15", text: "text-violet-300" },
  indigo: { bg: "bg-indigo-500/15", text: "text-indigo-300" },
  blue: { bg: "bg-blue-500/15", text: "text-blue-300" },
  sky: { bg: "bg-sky-500/15", text: "text-sky-300" },
  cyan: { bg: "bg-cyan-500/15", text: "text-cyan-300" },
  teal: { bg: "bg-teal-500/15", text: "text-teal-300" },
  emerald: { bg: "bg-emerald-500/15", text: "text-emerald-300" },
  lime: { bg: "bg-lime-500/15", text: "text-lime-300" },
  slate: { bg: "bg-slate-500/15", text: "text-slate-300" },
};

export const CATEGORY_COLORS = Object.keys(CATEGORY_COLOR_CLASSES);

const FALLBACK_COLOR = { bg: "bg-white/5", text: "text-fg-muted" };

export function categoryColorClasses(color: string | null | undefined) {
  if (!color) return FALLBACK_COLOR;
  return CATEGORY_COLOR_CLASSES[color] ?? FALLBACK_COLOR;
}

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** 1 → "1st", 2 → "2nd", 22 → "22nd" */
export function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * Installs the family's default categories, payment methods and settings the
 * first time someone opens the expense module.
 *
 * The endpoint is idempotent, so this is safe to fire on mount; the ref just
 * keeps a re-render from queueing a second identical request. Bootstrapping is
 * a POST — a GET is never allowed to create data — but the user shouldn't have
 * to press a "set up" button to get defaults everyone wants anyway.
 */
export function useEnsureExpenseSetup(
  familyId: string | undefined,
  needsSetup: boolean,
) {
  const qc = useQueryClient();
  const attempted = useRef<string | null>(null);

  const bootstrap = useMutation({
    mutationFn: (id: string) =>
      api<{ setup: unknown }>("/expense-settings/bootstrap", {
        method: "POST",
        body: JSON.stringify({ familyId: id }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["expense-categories"] });
      void qc.invalidateQueries({ queryKey: ["expense-payment-methods"] });
      void qc.invalidateQueries({ queryKey: ["expense-settings"] });
    },
  });

  const run = bootstrap.mutate;

  useEffect(() => {
    if (!familyId || !needsSetup) return;
    if (attempted.current === familyId) return;
    attempted.current = familyId;
    run(familyId);
  }, [familyId, needsSetup, run]);

  return { isSettingUp: bootstrap.isPending };
}

// ── Expenses ─────────────────────────────────────────────────────────────────

/** The enriched row shape GET /expenses and GET /expenses/:id return. */
export interface Expense {
  id: string;
  familyId: string;
  createdByUserId: string;
  payerMemberId: string | null;
  amountMinor: number;
  currency: string;
  spentOn: string; // ISO yyyy-mm-dd
  spentTime: string | null; // "HH:MM"
  merchant: string | null;
  merchantKey: string | null;
  notes: string | null;
  visibility: "family" | "private";
  status: "active" | "trashed";
  source: string;
  createdAt: number;
  updatedAt: number;
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  categoryEmoji: string | null;
  categoryColor: string | null;
  subcategoryId: string | null;
  subcategoryName: string | null;
  subcategorySlug: string | null;
  subcategoryEmoji: string | null;
  paymentMethodId: string | null;
  paymentMethodName: string | null;
  paymentMethodEmoji: string | null;
  paymentMethodKind: PaymentKind | null;
}

/** Extra fields only GET /expenses/:id includes (payer + creator display info). */
export interface ExpenseDetail extends Expense {
  payerDisplayName: string | null;
  payerMemberType: "user" | "dependent" | null;
  payerName: string | null;
  creatorName: string | null;
  creatorEmail: string | null;
}

export interface ExpenseListFilters {
  from?: string;
  to?: string;
  categoryId?: string;
  subcategoryId?: string;
  merchant?: string;
  paymentMethodId?: string;
  memberId?: string;
  minAmount?: string;
  maxAmount?: string;
  q?: string;
}

function filtersToQuery(filters: ExpenseListFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `&${qs}` : "";
}

/** Keyset-paginated expense history. `fetchNextPage()` follows the server's
 * opaque cursor — never offset-based, so it stays correct/fast at any scale. */
export function useExpenseList(familyId: string | undefined, filters: ExpenseListFilters) {
  return useInfiniteQuery({
    queryKey: ["expenses", familyId, filters],
    queryFn: ({ pageParam }) =>
      api<{ expenses: Expense[]; hasMore: boolean; nextCursor: string | null }>(
        `/expenses?familyId=${familyId}${filtersToQuery(filters)}${
          pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""
        }`,
      ),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(familyId),
  });
}

export function useExpense(id: string | undefined) {
  return useQuery({
    queryKey: ["expense", id],
    queryFn: () => api<{ expense: ExpenseDetail }>(`/expenses/${id}`),
    enabled: Boolean(id),
  });
}

export interface RecentCategorySuggestion {
  categoryId: string;
  categoryName: string;
  categoryEmoji: string | null;
  categoryColor: string | null;
  subcategoryId: string | null;
  subcategoryName: string | null;
  subcategoryEmoji: string | null;
  lastUsedAt: number;
}

export interface FrequentMerchantSuggestion {
  merchant: string;
  merchantKey: string;
  uses: number;
  lastUsedAt: number;
}

export function useExpenseSuggestions(familyId: string | undefined) {
  return useQuery({
    queryKey: ["expense-suggestions", familyId],
    queryFn: () =>
      api<{
        recentCategories: RecentCategorySuggestion[];
        frequentMerchants: FrequentMerchantSuggestion[];
      }>(`/expenses/suggestions?familyId=${familyId}`),
    enabled: Boolean(familyId),
  });
}

export interface ExpenseSummary {
  byCurrency: { currency: string; totalMinor: number; count: number }[];
  mixed: boolean;
  singleCurrency: { currency: string; totalMinor: number; count: number } | null;
}

export function useExpenseSummary(
  familyId: string | undefined,
  range: { from: string; to: string },
) {
  return useQuery({
    queryKey: ["expense-summary", familyId, range.from, range.to],
    queryFn: () =>
      api<ExpenseSummary>(`/expenses/summary?familyId=${familyId}&from=${range.from}&to=${range.to}`),
    enabled: Boolean(familyId),
  });
}

/** Everything the Add-Expense sheet can submit. Only amount/categoryId/spentOn
 * are actually required server-side; the rest may be omitted entirely. */
export interface ExpenseDraft {
  familyId: string;
  amount: string;
  categoryId: string;
  subcategoryId?: string;
  merchant?: string;
  paymentMethodId?: string;
  spentOn?: string;
  spentTime?: string;
  notes?: string;
  visibility?: "family" | "private";
}

function invalidateExpenseQueries(qc: ReturnType<typeof useQueryClient>, familyId?: string) {
  void qc.invalidateQueries({ queryKey: ["expenses", familyId] });
  void qc.invalidateQueries({ queryKey: ["expense-suggestions", familyId] });
  void qc.invalidateQueries({ queryKey: ["expense-summary", familyId] });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: ExpenseDraft) =>
      api<{ expense: ExpenseDetail }>("/expenses", {
        method: "POST",
        body: JSON.stringify(draft),
      }),
    onSuccess: (_res, draft) => invalidateExpenseQueries(qc, draft.familyId),
  });
}

export function useUpdateExpense(familyId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api<{ expense: ExpenseDetail }>(`/expenses/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: (res) => {
      qc.setQueryData(["expense", res.expense.id], res);
      invalidateExpenseQueries(qc, familyId);
    },
  });
}

export function useDeleteExpense(familyId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/expenses/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateExpenseQueries(qc, familyId),
  });
}

export function useRestoreExpense(familyId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ expense: ExpenseDetail }>(`/expenses/${id}/restore`, { method: "POST" }),
    onSuccess: (res) => {
      qc.setQueryData(["expense", res.expense.id], res);
      invalidateExpenseQueries(qc, familyId);
    },
  });
}

// ── Date helpers (local calendar day — what the user means by "today") ──────

/** The user's LOCAL calendar date, not UTC — this is what "Today" means when
 * picking a date for something that already happened. The server's own
 * fallback (todayIsoUtc) only matters if a client omits spentOn entirely. */
export function todayIsoLocal(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function yesterdayIsoLocal(date = new Date()): string {
  const d = new Date(date);
  d.setDate(d.getDate() - 1);
  return todayIsoLocal(d);
}

/** "Today" / "Yesterday" / a short localized date — for list-day headers and
 * the date chip's label. Compares calendar days, not 24h windows. */
export function relativeDayLabel(isoDate: string, now = new Date()): string {
  const today = todayIsoLocal(now);
  const yesterday = yesterdayIsoLocal(now);
  if (isoDate === today) return "Today";
  if (isoDate === yesterday) return "Yesterday";

  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: sameYear ? undefined : "numeric",
  }).format(date);
}
