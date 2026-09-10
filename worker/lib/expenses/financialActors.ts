/**
 * Centralized financial-actor eligibility (Expense Tracker §4.2 / §4.4).
 *
 * V1 model:
 *   - active `family_members` with `memberType='user'` → financial actors
 *     (may appear as paidBy / participant / settlement counterparty)
 *   - dependents (and any non-user member) → non-financial subjects only
 *     (`subjectMemberId` attribution; never balances)
 *
 * Architectural seam for a future family/common-pool actor:
 *   extend `FinancialActorKind` / `FinancialActorRef` here and admit the new
 *   kind in `isEligibleFinancialActorRow`. Do NOT add a pool `memberType`,
 *   sentinel payer IDs, or pool tables in E0–E6. Split/balance math stays
 *   keyed by opaque actor ids resolved through this module.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { schema } from "../../db/client";

/** V1 kinds. Future pool/common-fund actors would add a distinct kind here. */
export type FinancialActorKind = "member";
// Future (not implemented): | "pool"

export type MemberFinancialActor = {
  kind: "member";
  memberId: string;
};

/**
 * Opaque financial-actor reference used by future expense/settlement writes.
 * Extending this union is the reserved seam for non-member actors (e.g. pool).
 */
export type FinancialActorRef = MemberFinancialActor;

export type FamilyMemberActorRow = {
  id: string;
  familyId: string;
  memberType: string;
  status: string;
};

/**
 * Pure predicate: can this membership row act as a payer/participant/settler
 * for `familyId` under the V1 member-only rules?
 *
 * Future pool rows would be handled in a separate branch (by kind), not by
 * overloading `memberType`.
 */
export function isEligibleFinancialMember(
  row: FamilyMemberActorRow,
  familyId: string,
): boolean {
  return (
    row.familyId === familyId &&
    row.memberType === "user" &&
    row.status === "active"
  );
}

/**
 * Map an eligible membership row to a FinancialActorRef.
 * Returns null when the row is not a V1 financial actor (wrong family,
 * dependent, removed, etc.).
 */
export function toFinancialActorRef(
  row: FamilyMemberActorRow,
  familyId: string,
): FinancialActorRef | null {
  if (!isEligibleFinancialMember(row, familyId)) return null;
  return { kind: "member", memberId: row.id };
}

export type FinancialActorLookupResult =
  | { ok: true; actors: FinancialActorRef[] }
  | {
      ok: false;
      error:
        | "invalid_member_ids"
        | "not_financial_actor"
        | "duplicate_member_ids";
      memberId?: string;
    };

/**
 * Load and validate that every `memberId` is an eligible financial actor in
 * `familyId`. Order of returned actors matches the input order (after
 * de-duplication check — duplicates are rejected).
 *
 * Used by future expense/settlement write paths; E0 ships the helper only.
 */
export async function resolveFinancialActors(
  db: Db,
  familyId: string,
  memberIds: readonly string[],
): Promise<FinancialActorLookupResult> {
  if (memberIds.length === 0) return { ok: true, actors: [] };

  const unique = [...new Set(memberIds)];
  if (unique.length !== memberIds.length) {
    return { ok: false, error: "duplicate_member_ids" };
  }

  const rows = await db
    .select({
      id: schema.familyMembers.id,
      familyId: schema.familyMembers.familyId,
      memberType: schema.familyMembers.memberType,
      status: schema.familyMembers.status,
    })
    .from(schema.familyMembers)
    .where(inArray(schema.familyMembers.id, unique));

  if (rows.length !== unique.length) {
    return { ok: false, error: "invalid_member_ids" };
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  const actors: FinancialActorRef[] = [];

  for (const id of memberIds) {
    const row = byId.get(id)!;
    const ref = toFinancialActorRef(row, familyId);
    if (!ref) {
      return { ok: false, error: "not_financial_actor", memberId: id };
    }
    actors.push(ref);
  }

  return { ok: true, actors };
}

/**
 * Subject attribution (§4.3): any member row in the family (user or dependent),
 * regardless of financial eligibility. Status is not required to be active so
 * historical subjects remain addressable; callers that restrict to active
 * pickers should filter upstream.
 */
export async function memberInFamily(
  db: Db,
  familyId: string,
  memberId: string,
): Promise<boolean> {
  const row = await db
    .select({ id: schema.familyMembers.id })
    .from(schema.familyMembers)
    .where(
      and(
        eq(schema.familyMembers.id, memberId),
        eq(schema.familyMembers.familyId, familyId),
      ),
    )
    .get();
  return Boolean(row);
}
