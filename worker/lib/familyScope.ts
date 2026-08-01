import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { schema } from "../db/client";

/**
 * Cross-family reference guards. Any client-supplied ID that gets written into
 * a join/FK column (event attendees, linked documents, task assignee, related
 * doc/event) must be proven to belong to the same family first — otherwise a
 * member of family A can attach rows that reference family B's data.
 */

export async function allMembersInFamily(
  db: Db,
  familyId: string,
  memberIds: string[],
): Promise<boolean> {
  if (memberIds.length === 0) return true;
  const unique = [...new Set(memberIds)];
  const rows = await db
    .select({ id: schema.familyMembers.id })
    .from(schema.familyMembers)
    .where(
      and(
        eq(schema.familyMembers.familyId, familyId),
        inArray(schema.familyMembers.id, unique),
      ),
    );
  return rows.length === unique.length;
}

export async function allDocumentsInFamily(
  db: Db,
  familyId: string,
  documentIds: string[],
): Promise<boolean> {
  if (documentIds.length === 0) return true;
  const unique = [...new Set(documentIds)];
  const rows = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.familyId, familyId),
        inArray(schema.documents.id, unique),
      ),
    );
  return rows.length === unique.length;
}

export async function eventInFamily(
  db: Db,
  familyId: string,
  eventId: string,
): Promise<boolean> {
  const row = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(and(eq(schema.events.id, eventId), eq(schema.events.familyId, familyId)))
    .get();
  return Boolean(row);
}

/**
 * Looks up an expense category, scoped to the family, and returns just enough
 * to validate it: whether it's a top-level category or a subcategory
 * (`parentId`), and whether it's still selectable (`status`). Returns the row
 * (not a boolean) because callers need `parentId`/`status`, not just existence
 * — see worker/lib/expenses/queries.ts for how the category/subcategory/depth
 * invariants are built on top of this.
 */
export async function expenseCategoryInFamily(
  db: Db,
  familyId: string,
  categoryId: string,
): Promise<{ id: string; parentId: string | null; status: string } | null> {
  const row = await db
    .select({
      id: schema.expenseCategories.id,
      parentId: schema.expenseCategories.parentId,
      status: schema.expenseCategories.status,
    })
    .from(schema.expenseCategories)
    .where(
      and(
        eq(schema.expenseCategories.id, categoryId),
        eq(schema.expenseCategories.familyId, familyId),
      ),
    )
    .get();
  return row ?? null;
}

/** Same idea for payment methods — family-scoped lookup with its archive status. */
export async function paymentMethodInFamily(
  db: Db,
  familyId: string,
  paymentMethodId: string,
): Promise<{ id: string; status: string } | null> {
  const row = await db
    .select({
      id: schema.expensePaymentMethods.id,
      status: schema.expensePaymentMethods.status,
    })
    .from(schema.expensePaymentMethods)
    .where(
      and(
        eq(schema.expensePaymentMethods.id, paymentMethodId),
        eq(schema.expensePaymentMethods.familyId, familyId),
      ),
    )
    .get();
  return row ?? null;
}
