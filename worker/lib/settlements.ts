/** Hand-settlement helpers — destinations, ledger math. */

import {
  MONEY_MOVEMENT_TYPES,
  SETTLEMENT_DESTINATION_KINDS,
} from "../db/schema";

export { MONEY_MOVEMENT_TYPES, SETTLEMENT_DESTINATION_KINDS };

export type MoneyMovementType = (typeof MONEY_MOVEMENT_TYPES)[number];
export type SettlementDestinationKind =
  (typeof SETTLEMENT_DESTINATION_KINDS)[number];

/** Convert a major-unit amount (100, 99.5) to integer cents. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Convert integer cents to a major-unit number (10000 → 100). */
export function fromCents(cents: number): number {
  return cents / 100;
}

export interface MoneyBalance {
  availableCents: number;
  settledCents: number;
  inHandCents: number;
  available: number;
  settled: number;
  inHand: number;
}

/** Compute pot balances from movement rows (same currency assumed). */
export function computeBalances(
  movements: { type: string; amountCents: number }[],
): MoneyBalance {
  let availableCents = 0;
  let settledCents = 0;
  for (const m of movements) {
    if (m.type === "received") availableCents += m.amountCents;
    else if (m.type === "settled") settledCents += m.amountCents;
  }
  const inHandCents = availableCents - settledCents;
  return {
    availableCents,
    settledCents,
    inHandCents,
    available: fromCents(availableCents),
    settled: fromCents(settledCents),
    inHand: fromCents(inHandCents),
  };
}

/** Per-destination settled totals (settled movements only). */
export function settledByDestination(
  movements: {
    type: string;
    amountCents: number;
    destinationId: string | null;
  }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of movements) {
    if (m.type !== "settled" || !m.destinationId) continue;
    map.set(m.destinationId, (map.get(m.destinationId) ?? 0) + m.amountCents);
  }
  return map;
}
