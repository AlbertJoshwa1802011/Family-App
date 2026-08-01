import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Lock } from "lucide-react";
import { Sheet } from "../ui/Sheet";
import { Button } from "../ui/Button";
import { Chip, ChipGroup, inputClass } from "../ui/Field";
import { Skeleton } from "../ui/Skeleton";
import { api, ApiError } from "../../lib/api";
import { cn } from "../../lib/cn";
import { categoryColorClasses } from "../../lib/expenses";
import type {
  ExpenseCategory,
  ExpenseDetail,
  ExpenseDraft,
  ExpenseSettingsResponse,
  PaymentMethod,
} from "../../lib/expenses";
import {
  relativeDayLabel,
  todayIsoLocal,
  useCreateExpense,
  useExpenseSuggestions,
  useUpdateExpense,
  yesterdayIsoLocal,
} from "../../lib/expenses";
import { AmountInput } from "./AmountInput";
import { currencyExponent, formatMoney, fromMinorUnits } from "../../../shared/money";

function initialAmountText(expense: ExpenseDetail): string {
  const value = fromMinorUnits(expense.amountMinor, expense.currency);
  return value.toFixed(currencyExponent(expense.currency));
}

const lastPaymentMethodKey = (familyId: string) => `fv.expenses.lastPaymentMethod.${familyId}`;

function CategoryChip({
  emoji,
  name,
  color,
  selected,
  onClick,
}: {
  emoji: string | null;
  name: string;
  color: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  const colors = categoryColorClasses(color);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vault-400",
        selected
          ? cn("border-transparent", colors.bg, colors.text, "ring-1 ring-inset ring-current/20")
          : "border-line text-fg-muted hover:bg-white/5",
      )}
    >
      <span aria-hidden="true">{emoji ?? "📌"}</span>
      {name}
    </button>
  );
}

/**
 * Add AND edit — one component, two modes, following the same precedent as
 * DocumentForm.tsx. Passing `expense` switches to edit mode: fields pre-fill
 * from it, Save calls PATCH with only the fields that actually changed (so
 * leaving category/payment-method untouched never re-triggers their archived-
 * reference check — see worker/lib/expenses/queries.ts), currency is not
 * editable, and there's no "Add another" flow.
 */
export function AddExpenseSheet({
  familyId,
  expense,
  onClose,
}: {
  familyId: string;
  expense?: ExpenseDetail | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = Boolean(expense);

  const { data: settingsData, isLoading: settingsLoading } = useQuery({
    queryKey: ["expense-settings", familyId],
    queryFn: () => api<ExpenseSettingsResponse>(`/expense-settings?familyId=${familyId}`),
    enabled: !isEdit, // edit mode uses the expense's own (immutable) currency
  });
  const { data: categoriesData, isLoading: categoriesLoading } = useQuery({
    queryKey: ["expense-categories", familyId],
    queryFn: () => api<{ categories: ExpenseCategory[] }>(`/expense-categories?familyId=${familyId}`),
  });
  const { data: methodsData, isLoading: methodsLoading } = useQuery({
    queryKey: ["expense-payment-methods", familyId],
    queryFn: () =>
      api<{ paymentMethods: PaymentMethod[] }>(`/expense-payment-methods?familyId=${familyId}`),
  });
  const { data: suggestions } = useExpenseSuggestions(familyId);

  const currency = expense ? expense.currency : (settingsData?.settings.defaultCurrency ?? "INR");
  const categories = categoriesData?.categories ?? [];
  const paymentMethods = methodsData?.paymentMethods ?? [];

  const [amount, setAmount] = useState(() => (expense ? initialAmountText(expense) : ""));
  const [categoryId, setCategoryId] = useState<string | null>(expense?.categoryId ?? null);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(expense?.subcategoryId ?? null);
  const [merchant, setMerchant] = useState(expense?.merchant ?? "");
  // Defaults to whichever payment method was used last for this family — a
  // synchronous localStorage read in the initializer, not an effect (setState
  // inside an effect just to seed initial state causes an extra render for no
  // benefit). If that remembered id has since been archived, the chip row
  // below simply won't show anything selected; submitting without touching it
  // surfaces the ordinary "no longer available" error, which is fine — a
  // remembered method going stale between visits is a rare edge case.
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(() => {
    if (expense) return expense.paymentMethodId;
    try {
      return localStorage.getItem(lastPaymentMethodKey(familyId));
    } catch {
      return null;
    }
  });
  const [spentOn, setSpentOn] = useState(() => expense?.spentOn ?? todayIsoLocal());
  const [customDateOpen, setCustomDateOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(Boolean(expense?.spentTime || expense?.notes || expense?.visibility === "private"));
  const [spentTime, setSpentTime] = useState(expense?.spentTime ?? "");
  const [notes, setNotes] = useState(expense?.notes ?? "");
  const [visibility, setVisibility] = useState<"family" | "private">(expense?.visibility ?? "family");
  const [error, setError] = useState<string | null>(null);
  const [entryKey, setEntryKey] = useState(0);
  const [justSaved, setJustSaved] = useState<{
    amountMinor: number;
    currency: string;
    categoryLabel: string;
  } | null>(null);

  const create = useCreateExpense();
  const update = useUpdateExpense(familyId);

  const selectedCategory = categories.find((c) => c.id === categoryId) ?? null;

  const recentChips = useMemo(() => {
    const seen = new Set<string>();
    const chips: { categoryId: string; name: string; emoji: string | null; color: string | null; subcategoryId: string | null }[] = [];
    for (const r of suggestions?.recentCategories ?? []) {
      if (seen.has(r.categoryId)) continue;
      seen.add(r.categoryId);
      chips.push({
        categoryId: r.categoryId,
        // Show the subcategory's own name/emoji when the recent pick included
        // one — tapping it selects both in one go.
        name: r.subcategoryName ?? r.categoryName,
        emoji: r.subcategoryEmoji ?? r.categoryEmoji,
        color: r.categoryColor,
        subcategoryId: r.subcategoryId,
      });
    }
    return chips.slice(0, 6);
  }, [suggestions]);

  function pickCategory(catId: string, subId: string | null) {
    setCategoryId(catId);
    setSubcategoryId(subId);
  }

  function pickDateChip(day: "today" | "yesterday") {
    setSpentOn(day === "today" ? todayIsoLocal() : yesterdayIsoLocal());
    setCustomDateOpen(false);
  }

  function resetForNextEntry() {
    setAmount("");
    setMerchant("");
    setNotes("");
    setSpentTime("");
    // Privacy resets to the safe default rather than silently carrying over —
    // an accidental "private" carryover would hide real spending from the
    // family, which is exactly the kind of mistake fast re-entry shouldn't risk.
    setVisibility("family");
    setJustSaved(null);
    setEntryKey((k) => k + 1);
  }

  async function handleSave() {
    setError(null);
    const trimmedAmount = amount.trim();
    if (!trimmedAmount || Number.isNaN(Number(trimmedAmount)) || Number(trimmedAmount) <= 0) {
      setError("Enter an amount.");
      return;
    }
    if (!categoryId) {
      setError("Choose a category.");
      return;
    }

    if (isEdit && expense) {
      // Only send fields that actually changed — an untouched category/
      // subcategory/payment-method must never re-trigger its archived-
      // reference check (see queries.ts's "check only what's changing" rule).
      const patch: Record<string, unknown> = {};
      if (trimmedAmount !== initialAmountText(expense)) patch.amount = trimmedAmount;
      if (categoryId !== expense.categoryId) patch.categoryId = categoryId;
      if (subcategoryId !== (expense.subcategoryId ?? null)) patch.subcategoryId = subcategoryId;
      if (merchant.trim() !== (expense.merchant ?? "")) patch.merchant = merchant.trim() || null;
      if (paymentMethodId !== (expense.paymentMethodId ?? null)) patch.paymentMethodId = paymentMethodId;
      if (spentOn !== expense.spentOn) patch.spentOn = spentOn;
      if (spentTime !== (expense.spentTime ?? "")) patch.spentTime = spentTime || null;
      if (notes.trim() !== (expense.notes ?? "")) patch.notes = notes.trim() || null;
      if (visibility !== expense.visibility) patch.visibility = visibility;

      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }

      try {
        await update.mutateAsync({ id: expense.id, patch });
        onClose();
      } catch (e) {
        setError((e as ApiError).message);
      }
      return;
    }

    const draft: ExpenseDraft = {
      familyId,
      amount: trimmedAmount,
      categoryId,
      subcategoryId: subcategoryId ?? undefined,
      merchant: merchant.trim() || undefined,
      paymentMethodId: paymentMethodId ?? undefined,
      spentOn,
      spentTime: spentTime || undefined,
      notes: notes.trim() || undefined,
      visibility,
    };

    try {
      const res = await create.mutateAsync(draft);
      if (paymentMethodId) {
        localStorage.setItem(lastPaymentMethodKey(familyId), paymentMethodId);
      }
      const categoryLabel = selectedCategory
        ? subcategoryId
          ? (selectedCategory.children.find((c) => c.id === subcategoryId)?.name ?? selectedCategory.name)
          : selectedCategory.name
        : "";
      setJustSaved({
        amountMinor: res.expense.amountMinor,
        currency: res.expense.currency,
        categoryLabel,
      });
      // Recent-category/merchant suggestions should reflect this entry
      // immediately if the user keeps going.
      void qc.invalidateQueries({ queryKey: ["expense-suggestions", familyId] });
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  const isLoadingConfig = settingsLoading || categoriesLoading || methodsLoading;
  const dateLabel = relativeDayLabel(spentOn);
  const isToday = spentOn === todayIsoLocal();
  const isYesterday = spentOn === yesterdayIsoLocal();

  // Editing an expense whose category/subcategory/payment method has since
  // been archived: it's still the CURRENT value (nothing archives away a
  // historical reference), just no longer offered in the active picker below.
  const categoryArchived = isEdit && categoryId !== null && !categories.some((c) => c.id === categoryId);
  const paymentMethodArchived =
    isEdit && paymentMethodId !== null && !paymentMethods.some((m) => m.id === paymentMethodId);

  return (
    <Sheet
      open
      onClose={onClose}
      title={isEdit ? "Edit expense" : "Add expense"}
      footer={
        justSaved ? null : (
          <Button
            fullWidth
            size="lg"
            loading={isEdit ? update.isPending : create.isPending}
            onClick={handleSave}
          >
            {isEdit ? "Save changes" : "Save"}
          </Button>
        )
      }
    >
      {justSaved ? (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
            <Check className="size-7" aria-hidden="true" />
          </span>
          <div>
            <p className="text-base font-semibold text-fg">Expense added</p>
            <p className="mt-0.5 text-sm text-fg-muted">
              {formatMoney(justSaved.amountMinor, justSaved.currency)}
              {justSaved.categoryLabel ? ` · ${justSaved.categoryLabel}` : ""}
            </p>
          </div>
          <div className="flex w-full gap-2">
            <Button variant="secondary" fullWidth onClick={onClose}>
              Done
            </Button>
            <Button fullWidth autoFocus onClick={resetForNextEntry}>
              Add another
            </Button>
          </div>
        </div>
      ) : isLoadingConfig ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="mx-auto h-14 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : categories.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-muted">
          No categories yet. Visit Expense settings to set them up.
        </p>
      ) : (
        <>
          {error && (
            <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}

          <AmountInput key={entryKey} value={amount} onChange={setAmount} currency={currency} autoFocus />

          <div className="space-y-2">
            <p className="text-xs font-semibold text-fg-muted">Category</p>
            {categoryArchived && (
              <p className="text-xs text-warning">
                Currently: {expense?.categoryName}
                {expense?.subcategoryName ? ` · ${expense.subcategoryName}` : ""} (archived) — pick
                a category below to change it.
              </p>
            )}
            {recentChips.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium tracking-wide text-fg-subtle uppercase">Recent</p>
                <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Recent categories">
                  {recentChips.map((r) => (
                    <CategoryChip
                      key={`${r.categoryId}-${r.subcategoryId ?? ""}`}
                      emoji={r.emoji}
                      name={r.name}
                      color={r.color}
                      selected={categoryId === r.categoryId && subcategoryId === r.subcategoryId}
                      onClick={() => pickCategory(r.categoryId, r.subcategoryId)}
                    />
                  ))}
                </div>
              </div>
            )}
            <ChipGroup label="All categories" className="pt-0.5">
              {categories.map((cat) => (
                <CategoryChip
                  key={cat.id}
                  emoji={cat.emoji}
                  name={cat.name}
                  color={cat.color}
                  selected={categoryId === cat.id}
                  onClick={() => pickCategory(cat.id, null)}
                />
              ))}
            </ChipGroup>

            {selectedCategory && selectedCategory.children.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
                  {selectedCategory.name} · optional
                </p>
                <ChipGroup label="Subcategory">
                  {selectedCategory.children.map((child) => (
                    <Chip
                      key={child.id}
                      selected={subcategoryId === child.id}
                      onClick={() =>
                        setSubcategoryId((cur) => (cur === child.id ? null : child.id))
                      }
                    >
                      <span aria-hidden="true" className="mr-1">
                        {child.emoji}
                      </span>
                      {child.name}
                    </Chip>
                  ))}
                </ChipGroup>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-fg-muted">Merchant</p>
            <input
              type="text"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="e.g. KFC"
              maxLength={200}
              className={inputClass}
            />
            {(suggestions?.frequentMerchants.length ?? 0) > 0 && (
              <div className="flex gap-2 overflow-x-auto pt-1 pb-1">
                {suggestions!.frequentMerchants.map((m) => (
                  <Chip key={m.merchantKey} selected={merchant === m.merchant} onClick={() => setMerchant(m.merchant)}>
                    {m.merchant}
                  </Chip>
                ))}
              </div>
            )}
          </div>

          {(paymentMethods.length > 0 || paymentMethodArchived) && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-fg-muted">Payment method</p>
              {paymentMethodArchived && (
                <p className="text-xs text-warning">
                  Currently: {expense?.paymentMethodName} (archived) — pick one below to change it.
                </p>
              )}
              <ChipGroup label="Payment method">
                {paymentMethods.map((m) => (
                  <Chip
                    key={m.id}
                    selected={paymentMethodId === m.id}
                    onClick={() => setPaymentMethodId((cur) => (cur === m.id ? null : m.id))}
                  >
                    <span aria-hidden="true" className="mr-1">
                      {m.emoji}
                    </span>
                    {m.name}
                  </Chip>
                ))}
              </ChipGroup>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-fg-muted">Date</p>
            <div className="flex flex-wrap items-center gap-2">
              <Chip selected={isToday} onClick={() => pickDateChip("today")}>
                Today
              </Chip>
              <Chip selected={isYesterday} onClick={() => pickDateChip("yesterday")}>
                Yesterday
              </Chip>
              <Chip
                selected={!isToday && !isYesterday}
                onClick={() => setCustomDateOpen((v) => !v)}
              >
                {!isToday && !isYesterday ? dateLabel : "Pick date"}
              </Chip>
            </div>
            {customDateOpen || (!isToday && !isYesterday) ? (
              <input
                type="date"
                value={spentOn}
                max={todayIsoLocal()}
                onChange={(e) => e.target.value && setSpentOn(e.target.value)}
                className={cn(inputClass, "mt-1")}
              />
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-vault-300"
          >
            {moreOpen ? "Hide" : "More options"}
            <ChevronDown className={cn("size-4 transition-transform", moreOpen && "rotate-180")} aria-hidden="true" />
          </button>

          {moreOpen && (
            <div className="space-y-4 rounded-xl border border-line bg-ink-950/40 p-3">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-fg-muted">Time</p>
                <input
                  type="time"
                  value={spentTime}
                  onChange={(e) => setSpentTime(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-fg-muted">Notes</p>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything worth remembering"
                  rows={2}
                  maxLength={2000}
                  className={cn(inputClass, "resize-none")}
                />
              </div>
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm text-fg">
                  <Lock className="size-4 text-fg-muted" aria-hidden="true" />
                  Keep this private
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={visibility === "private"}
                  onClick={() => setVisibility((v) => (v === "private" ? "family" : "private"))}
                  className={cn(
                    "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                    visibility === "private" ? "bg-vault-600" : "bg-white/10",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 size-5 rounded-full bg-white transition-transform",
                      visibility === "private" ? "translate-x-5" : "translate-x-0.5",
                    )}
                  />
                </button>
              </label>
              <p className="text-xs text-fg-subtle">
                Private expenses are visible only to you — not even the family owner or admins can see them.
              </p>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
