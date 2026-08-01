/**
 * Domain vocabulary for the expense module.
 *
 * ── The transaction/expense boundary ─────────────────────────────────────────
 * An EXPENSE is a classified unit of spending. A TRANSACTION is an external
 * financial event. They are NOT the same thing, and the difference is why the
 * kinds below exist before the importer that produces them does.
 *
 * A future bank/card sync stores raw transactions in their own table and only
 * materializes an `expenses` row for the kinds that actually represent
 * spending. Two concrete cases this protects against:
 *
 *   • "HDFC → SBI ₹20,000" is a TRANSFER between the family's own accounts.
 *     It moves money without spending it, and must never appear as ₹20,000 of
 *     spending in any total.
 *   • A credit-card BILL PAYMENT is also a transfer. If the card's individual
 *     purchases were already imported, counting the bill payment too would
 *     double-count every one of them.
 *
 * Nothing in V1 assumes an incoming financial event is an expense; the only
 * writer today is manual entry (`source: "manual"`).
 */

/** Where an expense row came from. Analytics must never assume manual entry. */
export const EXPENSE_SOURCES = [
  "manual",
  "csv_import",
  "bank_sync",
  "api",
  "system",
] as const;
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number];

/** Kinds of external financial event a future sync must be able to distinguish. */
export const TRANSACTION_KINDS = [
  "expense", // money spent on goods/services
  "income", // salary, interest, inbound payment
  "transfer", // between the family's own accounts (incl. credit-card bill payment)
  "refund", // merchant returns money for an earlier purchase
  "reversal", // the bank/provider cancels an earlier transaction outright
  "fee", // bank charge, interest, late fee — real spending, but not a purchase
  "unknown", // could not be classified; needs human review
] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/**
 * How each kind is allowed to affect the expense ledger.
 *
 *  creates_expense  → materializes exactly one `expenses` row
 *  never_expense    → recorded as a transaction only; invisible to spending analytics
 *  adjusts_expense  → nets against an EXISTING expense (see the refund model below)
 *  needs_review     → parked in a review queue until a human decides
 */
export type LedgerTreatment =
  | "creates_expense"
  | "never_expense"
  | "adjusts_expense"
  | "needs_review";

export const TRANSACTION_KIND_TREATMENT: Record<TransactionKind, LedgerTreatment> = {
  expense: "creates_expense",
  fee: "creates_expense",
  income: "never_expense",
  transfer: "never_expense",
  refund: "adjusts_expense",
  reversal: "adjusts_expense",
  unknown: "needs_review",
};

/** True when a transaction kind contributes to "how much did I spend?". */
export function countsAsSpending(kind: TransactionKind): boolean {
  const treatment = TRANSACTION_KIND_TREATMENT[kind];
  return treatment === "creates_expense" || treatment === "adjusts_expense";
}

/** True when a transaction kind should produce a brand-new expense row. */
export function createsExpenseRow(kind: TransactionKind): boolean {
  return TRANSACTION_KIND_TREATMENT[kind] === "creates_expense";
}

/**
 * ── Refund / reversal model (deliberately NOT implemented in V1) ─────────────
 *
 * V1 keeps every expense strictly positive (DB CHECK `amount_minor > 0`).
 * Allowing arbitrary negative expenses to represent refunds would corrupt
 * category analytics: a -₹500 row would distort averages, "biggest expense"
 * rankings, and per-category counts, and a refund arriving in a later month
 * would retroactively dent that month's totals in a way no user expects.
 *
 * The eventual model is an ADJUSTMENT that points at the expense it modifies:
 *
 *     Purchase  ₹2,000  → expenses row (gross_minor = 200000)
 *     Refund      ₹500  → expense_adjustments row (kind='refund', 50000,
 *                          refers to the purchase, carries its own date)
 *     Analytics          → net = gross − Σ adjustments = ₹1,500
 *
 * That keeps the purchase's category, merchant and date intact (so "what did I
 * buy?" stays truthful) while "what did it cost me?" nets out correctly. When
 * the refund can't be matched to an original purchase, it becomes an
 * unattached credit reported separately rather than a negative expense.
 *
 * Nothing in the V1 schema blocks this: `expense_adjustments` is a new table
 * with an `expense_id` FK, and `amount_minor` on `expenses` keeps meaning the
 * gross amount it means today.
 */
export type AdjustmentKind = "refund" | "reversal";

/** Core expense shape shared by routes, analytics and (later) the importer. */
export interface ExpenseCore {
  id: string;
  familyId: string;
  createdByUserId: string;
  payerMemberId: string | null;
  amountMinor: number;
  currency: string;
  spentOn: string; // ISO yyyy-mm-dd
  categoryId: string;
  subcategoryId: string | null;
  merchant: string | null;
  merchantKey: string | null;
  paymentMethodId: string | null;
  visibility: "family" | "private";
  status: "active" | "trashed";
  source: ExpenseSource;
}
