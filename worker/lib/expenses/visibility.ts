/**
 * Expense visibility (docs/EXPENSE_TRACKER_SPEC.md §9).
 *
 * Reuses the document privacy model deliberately:
 *   - visibility='family' → every active family member
 *   - visibility='private' → creator + owner/admin (404-not-403 for others)
 *
 * Shared expenses (E2+) force visibility='family' at write time; personal
 * expenses (splitType='none') may be private or family.
 */

import { and, eq, like, ne, or, type SQL } from "drizzle-orm";
import { schema } from "../../db/client";

export type ExpenseVisibilityRow = {
  visibility: string;
  createdByUserId: string;
};

/**
 * True when this expense must be hidden from the caller.
 * Always pair a true result with HTTP 404 (never 403) so existence is not leaked.
 */
export function isExpenseHiddenFrom(
  expense: ExpenseVisibilityRow,
  userId: string,
  role: string,
): boolean {
  return (
    expense.visibility === "private" &&
    expense.createdByUserId !== userId &&
    role !== "owner" &&
    role !== "admin"
  );
}

/**
 * Drizzle WHERE fragment for list queries — mirrors documents' visibilityWhere.
 */
export function expenseVisibilityWhere(
  familyId: string,
  userId: string,
  role: string,
): SQL | undefined {
  const base = and(
    eq(schema.expenses.familyId, familyId),
    ne(schema.expenses.status, "trashed"),
  );

  if (role === "owner" || role === "admin") {
    return base;
  }

  return and(
    base,
    or(
      eq(schema.expenses.visibility, "family"),
      eq(schema.expenses.createdByUserId, userId),
    ),
  );
}

/**
 * Neutralize LIKE wildcards the same way documents search does.
 * Returns null when the query collapses to empty (match nothing, not everything).
 */
export function expenseSearchWhere(q: string): SQL | null {
  const sanitized = q.replace(/[%_]/g, " ").trim();
  if (!sanitized) return null;
  const pattern = `%${sanitized}%`;
  return or(
    like(schema.expenses.merchant, pattern),
    like(schema.expenses.description, pattern),
  )!;
}
