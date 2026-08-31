/**
 * Pure money / split arithmetic for Family Vault expenses.
 *
 * All amounts are integer minor units (paise, cents, …). Never floats.
 * This module is the only place split math is allowed to happen — routes
 * must call these functions rather than trusting client-computed shares
 * for `equal` / `percentage` (exact shares are validated, never “fixed”).
 *
 * See docs/EXPENSE_TRACKER_SPEC.md §5.
 */

/** Soft upper bound to catch fat-finger / overflow-adjacent input (~$100B). */
export const MAX_AMOUNT_MINOR = 10_000_000_000_000; // 10^13

export type SplitShare = {
  memberId: string;
  shareMinor: number;
  /** Present for percentage splits — display fidelity only; never authoritative. */
  sharePercentBp?: number;
};

export class MoneyValidationError extends Error {
  readonly code = "validation_error" as const;
  constructor(message: string) {
    super(message);
    this.name = "MoneyValidationError";
  }
}

function assertPositiveTotal(totalMinor: number): void {
  if (!Number.isInteger(totalMinor) || totalMinor <= 0) {
    throw new MoneyValidationError("amountMinor must be a positive integer");
  }
  if (totalMinor >= MAX_AMOUNT_MINOR) {
    throw new MoneyValidationError("amountMinor exceeds the allowed maximum");
  }
}

function assertDistinctMemberIds(memberIds: string[]): void {
  const seen = new Set<string>();
  for (const id of memberIds) {
    if (!id) throw new MoneyValidationError("memberId is required");
    if (seen.has(id)) {
      throw new MoneyValidationError("duplicate participant memberId");
    }
    seen.add(id);
  }
}

/**
 * Distribute `remainder` (+1 each) across `floors`, visiting participants in
 * `order` (already sorted by memberId ascending). Mutates a copy of `floors`.
 *
 * Invariant: `Σ(result) === Σ(floors) + remainder === total`.
 */
export function distributeRemainder(
  floors: readonly number[],
  remainder: number,
  order: readonly number[],
): number[] {
  if (remainder < 0 || remainder > order.length) {
    throw new MoneyValidationError("invalid remainder for participant count");
  }
  const out = floors.slice();
  for (let i = 0; i < remainder; i++) {
    out[order[i]] += 1;
  }
  return out;
}

/**
 * Shared remainder-distribution primitive used by equal and percentage splits.
 * `floors[i]` is the pre-remainder share for `memberIds[i]` (same index order).
 * Remainder units go to participants sorted by memberId ascending.
 */
export function applyDeterministicRemainder(
  totalMinor: number,
  memberIds: readonly string[],
  floors: readonly number[],
): number[] {
  if (memberIds.length !== floors.length) {
    throw new MoneyValidationError("floors length must match participant count");
  }
  const sumFloors = floors.reduce((a, b) => a + b, 0);
  const remainder = totalMinor - sumFloors;
  const order = memberIds
    .map((id, index) => ({ id, index }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((x) => x.index);
  return distributeRemainder(floors, remainder, order);
}

function assertAllSharesPositive(shares: number[], totalMinor: number): void {
  if (shares.some((s) => s <= 0)) {
    throw new MoneyValidationError(
      "too many participants for this amount",
    );
  }
  const sum = shares.reduce((a, b) => a + b, 0);
  if (sum !== totalMinor) {
    throw new MoneyValidationError(
      `Shares sum to ${sum}, expected ${totalMinor}`,
    );
  }
}

/**
 * Equal split: floor(total/n) each, then +1 remainder to memberIds sorted ASC.
 * Upstream shared-expense validation requires ≥2 participants; this function
 * still accepts n≥1 so unit tests can pin the primitive, and rejects n===0.
 */
export function splitEqual(
  totalMinor: number,
  memberIds: readonly string[],
): SplitShare[] {
  assertPositiveTotal(totalMinor);
  if (memberIds.length === 0) {
    throw new MoneyValidationError("at least one participant is required");
  }
  assertDistinctMemberIds([...memberIds]);

  const n = memberIds.length;
  const base = Math.floor(totalMinor / n);
  const floors = Array.from({ length: n }, () => base);
  const shares = applyDeterministicRemainder(totalMinor, memberIds, floors);
  assertAllSharesPositive(shares, totalMinor);

  return memberIds.map((memberId, i) => ({
    memberId,
    shareMinor: shares[i],
  }));
}

/**
 * Percentage split in basis points (0–10000). Percents must sum to exactly
 * 10000bp; then floors = floor(total × bp / 10000) and remainder is applied
 * with the same ASC memberId rule as equal.
 */
export function splitPercentage(
  totalMinor: number,
  parts: readonly { memberId: string; sharePercentBp: number }[],
): SplitShare[] {
  assertPositiveTotal(totalMinor);
  if (parts.length === 0) {
    throw new MoneyValidationError("at least one participant is required");
  }
  assertDistinctMemberIds(parts.map((p) => p.memberId));

  for (const p of parts) {
    if (
      !Number.isInteger(p.sharePercentBp) ||
      p.sharePercentBp < 0 ||
      p.sharePercentBp > 10000
    ) {
      throw new MoneyValidationError(
        "sharePercentBp must be an integer between 0 and 10000",
      );
    }
  }

  const bpSum = parts.reduce((a, p) => a + p.sharePercentBp, 0);
  if (bpSum !== 10000) {
    throw new MoneyValidationError(
      `Percentages sum to ${bpSum}bp, expected 10000`,
    );
  }

  const memberIds = parts.map((p) => p.memberId);
  const floors = parts.map((p) =>
    Math.floor((totalMinor * p.sharePercentBp) / 10000),
  );
  const shares = applyDeterministicRemainder(totalMinor, memberIds, floors);
  assertAllSharesPositive(shares, totalMinor);

  return parts.map((p, i) => ({
    memberId: p.memberId,
    shareMinor: shares[i],
    sharePercentBp: p.sharePercentBp,
  }));
}

/**
 * Exact split: client-provided shareMinor values are authoritative.
 * Validates Σ === total and every share > 0; never auto-corrects.
 */
export function validateExact(
  totalMinor: number,
  parts: readonly { memberId: string; shareMinor: number }[],
): SplitShare[] {
  assertPositiveTotal(totalMinor);
  if (parts.length === 0) {
    throw new MoneyValidationError("at least one participant is required");
  }
  assertDistinctMemberIds(parts.map((p) => p.memberId));

  for (const p of parts) {
    if (!Number.isInteger(p.shareMinor) || p.shareMinor <= 0) {
      throw new MoneyValidationError(
        "each exact shareMinor must be a positive integer",
      );
    }
  }

  const sum = parts.reduce((a, p) => a + p.shareMinor, 0);
  if (sum !== totalMinor) {
    throw new MoneyValidationError(
      `Shares sum to ${sum}, expected ${totalMinor}`,
    );
  }

  return parts.map((p) => ({
    memberId: p.memberId,
    shareMinor: p.shareMinor,
  }));
}
