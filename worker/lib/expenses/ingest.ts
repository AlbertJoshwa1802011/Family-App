/**
 * Transaction ingestion CONTRACT — types and pure helpers only.
 *
 * Nothing in V1 calls this. It exists so the shape of a future bank/card/CSV
 * importer is fixed now, while the expense schema is still cheap to change, and
 * so that a later phase is additive (a `raw_transactions` table + a route) and
 * never a rewrite of the expense model.
 *
 * An empty staging table shipped months before its importer would be dead
 * weight; the columns that make the join possible (`source`, `external_id`,
 * `external_account`, `import_batch_id`, `merchant_key` on `expenses`) plus the
 * dedupe index `uq_exp_external` ARE in V1. That is the boundary that matters.
 *
 * Pipeline the contract describes:
 *
 *   provider → RawTransaction (stored verbatim, immutable)
 *            → NormalizedTransaction (kind, signed amount in minor units, merchant key)
 *            → dedupe (exact external id, then a fuzzy fallback)
 *            → ClassificationSuggestion (category/subcategory + confidence + why)
 *            → human confirmation/correction (which is remembered as a rule)
 *            → expenses row, but ONLY for kinds that represent spending
 *            → analytics, unchanged
 */
import type { ExpenseSource, TransactionKind } from "./types";
import { merchantKey } from "./merchant";

/** Exactly what the provider sent, before any interpretation. */
export interface RawTransaction {
  /** Provider's own transaction identifier, when it gives one. */
  externalId: string | null;
  /** Provider's account handle ("HDFC ••4321"). */
  externalAccount: string | null;
  /** Positive = money out, negative = money in. Minor units, provider currency. */
  amountMinor: number;
  currency: string;
  /** ISO yyyy-mm-dd, as the provider dated it. */
  postedOn: string;
  /** Unparsed merchant/narration text ("UPI/AMZN Mktp*IN/…"). */
  description: string;
  /** Untouched provider payload, kept for debugging and re-processing. */
  rawPayload?: unknown;
}

/** A raw transaction after interpretation, ready for dedupe + classification. */
export interface NormalizedTransaction {
  kind: TransactionKind;
  externalId: string | null;
  externalAccount: string | null;
  /** Always POSITIVE. Direction lives in `kind`, never in the sign. */
  amountMinor: number;
  currency: string;
  spentOn: string;
  merchant: string | null;
  merchantKey: string | null;
  source: ExpenseSource;
}

/**
 * Why a classification was chosen. Surfacing this is what makes corrections
 * teachable rather than magic — and it keeps honest signals separate from
 * guesses.
 */
export type ClassificationSource =
  | "user" // the human said so; outranks everything
  | "merchant_rule" // a remembered mapping for this merchant key
  | "family_history" // this family's own past choices for this merchant
  | "heuristic" // deterministic keyword matching
  | "model"; // an LLM suggestion (optional, always correctable)

export interface ClassificationSuggestion {
  categoryId: string;
  subcategoryId: string | null;
  /** 0–1. The UI must show low-confidence suggestions as suggestions. */
  confidence: number;
  reason: ClassificationSource;
}

/** How a candidate transaction relates to what is already stored. */
export type DedupeVerdict =
  | { status: "new" }
  | { status: "duplicate"; expenseId: string; matchedBy: "external_id" }
  | { status: "possible_duplicate"; expenseId: string; matchedBy: "fuzzy" };

/**
 * Primary dedupe key. Scoped by family AND source: two providers may hand out
 * the same opaque id, and the same provider re-sending an id must collapse.
 * Mirrors the `uq_exp_external` index exactly — keep them in step.
 */
export function dedupeKey(
  familyId: string,
  source: ExpenseSource,
  externalId: string,
): string {
  return `${familyId}:${source}:${externalId}`;
}

/**
 * Fallback key for providers that supply no stable id: same account, same day,
 * same amount, same merchant.
 *
 * This is a SUGGESTION, never an automatic drop. Two genuine ₹120 coffees at
 * the same shop on the same day are perfectly normal, and silently discarding
 * the second is a worse failure than showing the user a "possible duplicate"
 * to confirm. Callers must treat a fuzzy hit as `possible_duplicate`.
 */
export function fuzzyDedupeKey(tx: NormalizedTransaction): string {
  return [
    tx.externalAccount ?? "",
    tx.spentOn,
    tx.amountMinor,
    tx.currency,
    tx.merchantKey ?? "",
  ].join("|");
}

/** Derive the merchant key for a raw transaction description. */
export function normalizeMerchantFromDescription(
  description: string,
): string | null {
  return merchantKey(description);
}

/**
 * The interface an importer implements. Deliberately narrow: a provider adapter
 * only has to fetch and normalize; dedupe, classification, review and the write
 * to `expenses` stay in shared code so every source behaves identically.
 */
export interface TransactionProvider {
  readonly id: string;
  readonly source: ExpenseSource;
  fetchTransactions(opts: {
    familyId: string;
    since: string; // ISO yyyy-mm-dd
  }): Promise<RawTransaction[]>;
  normalize(raw: RawTransaction): NormalizedTransaction;
}
