/**
 * Expense visibility.
 *
 * Expenses are PRIVATE BY DEFAULT and, unlike documents, private expenses are
 * visible only to the member who recorded them — owners and admins get no
 * bypass. Personal spending is the one thing in this app a family role should
 * not unlock; "each user has their own books" is the product guarantee, and a
 * role-based backdoor would quietly break it.
 *
 * Marking an expense `family` is the explicit opt-in that shares it with the
 * household.
 *
 * Hidden rows must always 404, never 403, so their existence isn't leaked.
 */

import { and, eq, like, ne, or, type SQL } from "drizzle-orm";
import { schema } from "../../db/client";

export type ExpenseVisibilityRow = {
  visibility: string;
  createdByUserId: string;
};

/**
 * True when this expense must be hidden from the caller.
 * Pair a true result with HTTP 404.
 */
export function isExpenseHiddenFrom(
  expense: ExpenseVisibilityRow,
  userId: string,
): boolean {
  return expense.visibility === "private" && expense.createdByUserId !== userId;
}

/** Drizzle WHERE fragment for list queries. Applies the same rule as above. */
export function expenseVisibilityWhere(
  familyId: string,
  userId: string,
): SQL | undefined {
  return and(
    eq(schema.expenses.familyId, familyId),
    ne(schema.expenses.status, "trashed"),
    or(
      eq(schema.expenses.visibility, "family"),
      eq(schema.expenses.createdByUserId, userId),
    ),
  );
}

/**
 * Neutralize LIKE wildcards so a query of "%" can't match everything.
 * Returns null when the query collapses to empty (match nothing).
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

/** Same privacy rule for recurring expenses (no owner/admin bypass). */
export function isRecurringHiddenFrom(
  row: ExpenseVisibilityRow,
  userId: string,
): boolean {
  return row.visibility === "private" && row.createdByUserId !== userId;
}

export function recurringVisibilityWhere(
  familyId: string,
  userId: string,
): SQL | undefined {
  return and(
    eq(schema.recurringExpenses.familyId, familyId),
    or(
      eq(schema.recurringExpenses.visibility, "family"),
      eq(schema.recurringExpenses.createdByUserId, userId),
    ),
  );
}
