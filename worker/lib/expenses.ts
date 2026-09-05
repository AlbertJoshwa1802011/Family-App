/** Shared expense helpers — used by the expenses API and the assistant tools. */

export const EXPENSE_CATEGORIES = [
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

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const CATEGORY_SET = new Set<string>(EXPENSE_CATEGORIES);

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return CATEGORY_SET.has(value);
}

/** Convert a major-unit amount (100, 99.5) to integer cents. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Convert integer cents to a major-unit number (10000 → 100). */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** Display helper: 10000 + INR → "₹100"; 1050 + USD → "$10.50". */
export function formatMoney(cents: number, currency: string): string {
  const major = fromCents(cents);
  const formatted =
    cents % 100 === 0 ? String(major) : major.toFixed(2);
  if (currency === "INR") return `₹${formatted}`;
  if (currency === "USD") return `$${formatted}`;
  if (currency === "EUR") return `€${formatted}`;
  if (currency === "GBP") return `£${formatted}`;
  return `${formatted} ${currency}`;
}
