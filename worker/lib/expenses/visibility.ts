/**
 * Expense visibility — SECURITY-CRITICAL.
 *
 * `visibility: 'private'` means CREATOR-ONLY. The family owner and admins do
 * NOT get to see another member's private expenses.
 *
 * This DIVERGES on purpose from documents (`worker/routes/documents.ts`), where
 * owners and admins can see every document including other members' private
 * ones. Document custodianship and financial privacy are different promises:
 * a "private" expense that an admin can read is not private, and discovering
 * that after the fact destroys trust in the whole module.
 *
 * The API of this file encodes the rule: NOTHING here takes a `role`. There is
 * deliberately no parameter through which a privileged role could widen
 * visibility, so no future caller can accidentally grant it. If you are here to
 * "make expenses consistent with documents", read
 * tests/expenses-visibility.test.ts first — this behaviour is pinned by tests
 * and by an explicit product decision.
 *
 * Family-visible expenses (the default) follow normal membership rules: every
 * active member of the family sees them.
 */
import { and, eq, or } from "drizzle-orm";
import { schema } from "../../db/client";

/**
 * WHERE condition scoping a query to the expenses this user may see in this
 * family. Callers MUST have already proven family membership with
 * `requireFamilyMember` — this only handles the private/family split.
 *
 * Trashed (soft-deleted) rows are excluded unless `includeTrashed` is set, so a
 * caller can't leak them by forgetting a second condition.
 */
export function expenseScopeWhere(
  familyId: string,
  userId: string,
  opts: { includeTrashed?: boolean } = {},
) {
  const visible = or(
    eq(schema.expenses.visibility, "family"),
    eq(schema.expenses.createdByUserId, userId),
  );

  if (opts.includeTrashed) {
    return and(eq(schema.expenses.familyId, familyId), visible);
  }

  return and(
    eq(schema.expenses.familyId, familyId),
    eq(schema.expenses.status, "active"),
    visible,
  );
}

/**
 * True when this expense must be hidden from this user. Applied to every
 * single-row read AND every write (edit, delete, restore) — a member must not
 * be able to read, modify or delete another member's private expense.
 */
export function isExpenseHiddenFrom(
  expense: { visibility: string; createdByUserId: string },
  userId: string,
): boolean {
  return expense.visibility === "private" && expense.createdByUserId !== userId;
}
