/**
 * Safe currency *relabel* for a family — changes the ISO code on existing money
 * rows without converting amounts.
 *
 * Use when entries were saved under the wrong family default (e.g. USD baked in
 * at create time) and the amounts already mean the intended currency.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { schema } from "../../db/client";

export type RelabelCounts = {
  expenses: number;
  incomes: number;
  commitments: number;
  commitmentPayments: number;
  categoryBudgets: number;
  wishlistItems: number;
  fundAccounts: number;
  fundContributions: number;
  fundSpends: number;
};

function changes(result: { meta?: { changes?: number } } | undefined): number {
  return result?.meta?.changes ?? 0;
}

const emptyCounts = (): RelabelCounts => ({
  expenses: 0,
  incomes: 0,
  commitments: 0,
  commitmentPayments: 0,
  categoryBudgets: 0,
  wishlistItems: 0,
  fundAccounts: 0,
  fundContributions: 0,
  fundSpends: 0,
});

/** Distinct non-default currencies still present on this family's money rows. */
export async function listMismatchedCurrencies(
  db: Db,
  familyId: string,
  defaultCurrency: string,
): Promise<string[]> {
  const found = new Set<string>();

  const collect = (rows: { currency: string }[]) => {
    for (const r of rows) {
      if (r.currency && r.currency !== defaultCurrency) found.add(r.currency);
    }
  };

  collect(
    await db
      .selectDistinct({ currency: schema.expenses.currency })
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.familyId, familyId),
          ne(schema.expenses.currency, defaultCurrency),
        ),
      ),
  );
  collect(
    await db
      .selectDistinct({ currency: schema.incomes.currency })
      .from(schema.incomes)
      .where(
        and(
          eq(schema.incomes.familyId, familyId),
          ne(schema.incomes.currency, defaultCurrency),
        ),
      ),
  );
  collect(
    await db
      .selectDistinct({ currency: schema.commitments.currency })
      .from(schema.commitments)
      .where(
        and(
          eq(schema.commitments.familyId, familyId),
          ne(schema.commitments.currency, defaultCurrency),
        ),
      ),
  );
  collect(
    await db
      .selectDistinct({ currency: schema.categoryBudgets.currency })
      .from(schema.categoryBudgets)
      .where(
        and(
          eq(schema.categoryBudgets.familyId, familyId),
          ne(schema.categoryBudgets.currency, defaultCurrency),
        ),
      ),
  );
  collect(
    await db
      .selectDistinct({ currency: schema.wishlistItems.currency })
      .from(schema.wishlistItems)
      .where(
        and(
          eq(schema.wishlistItems.familyId, familyId),
          ne(schema.wishlistItems.currency, defaultCurrency),
        ),
      ),
  );
  collect(
    await db
      .selectDistinct({ currency: schema.fundAccounts.currency })
      .from(schema.fundAccounts)
      .where(
        and(
          eq(schema.fundAccounts.familyId, familyId),
          ne(schema.fundAccounts.currency, defaultCurrency),
        ),
      ),
  );
  collect(
    await db
      .selectDistinct({ currency: schema.fundContributions.currency })
      .from(schema.fundContributions)
      .where(
        and(
          eq(schema.fundContributions.familyId, familyId),
          ne(schema.fundContributions.currency, defaultCurrency),
        ),
      ),
  );
  collect(
    await db
      .selectDistinct({ currency: schema.fundSpends.currency })
      .from(schema.fundSpends)
      .where(
        and(
          eq(schema.fundSpends.familyId, familyId),
          ne(schema.fundSpends.currency, defaultCurrency),
        ),
      ),
  );

  const commitmentIds = (
    await db
      .select({ id: schema.commitments.id })
      .from(schema.commitments)
      .where(eq(schema.commitments.familyId, familyId))
  ).map((r) => r.id);
  if (commitmentIds.length > 0) {
    collect(
      await db
        .selectDistinct({ currency: schema.commitmentPayments.currency })
        .from(schema.commitmentPayments)
        .where(
          and(
            inArray(schema.commitmentPayments.commitmentId, commitmentIds),
            ne(schema.commitmentPayments.currency, defaultCurrency),
          ),
        ),
    );
  }

  return [...found].sort();
}

/**
 * Relabel every money row for `familyId` whose currency is `from` → `to`.
 * Amounts are untouched. Idempotent when `from === to` or nothing matches.
 */
export async function relabelFamilyCurrency(
  db: Db,
  familyId: string,
  from: string,
  to: string,
): Promise<RelabelCounts> {
  if (from === to) return emptyCounts();

  const counts = emptyCounts();

  counts.expenses = changes(
    await db
      .update(schema.expenses)
      .set({ currency: to, updatedAt: sql`(unixepoch())` })
      .where(
        and(eq(schema.expenses.familyId, familyId), eq(schema.expenses.currency, from)),
      )
      .run(),
  );

  counts.incomes = changes(
    await db
      .update(schema.incomes)
      .set({ currency: to, updatedAt: sql`(unixepoch())` })
      .where(
        and(eq(schema.incomes.familyId, familyId), eq(schema.incomes.currency, from)),
      )
      .run(),
  );

  counts.commitments = changes(
    await db
      .update(schema.commitments)
      .set({ currency: to, updatedAt: sql`(unixepoch())` })
      .where(
        and(
          eq(schema.commitments.familyId, familyId),
          eq(schema.commitments.currency, from),
        ),
      )
      .run(),
  );

  // Payments have no family_id — scope via this family's commitment ids.
  const allCommitmentIds = (
    await db
      .select({ id: schema.commitments.id })
      .from(schema.commitments)
      .where(eq(schema.commitments.familyId, familyId))
  ).map((r) => r.id);
  if (allCommitmentIds.length > 0) {
    counts.commitmentPayments = changes(
      await db
        .update(schema.commitmentPayments)
        .set({ currency: to })
        .where(
          and(
            inArray(schema.commitmentPayments.commitmentId, allCommitmentIds),
            eq(schema.commitmentPayments.currency, from),
          ),
        )
        .run(),
    );
  }

  counts.categoryBudgets = changes(
    await db
      .update(schema.categoryBudgets)
      .set({ currency: to, updatedAt: sql`(unixepoch())` })
      .where(
        and(
          eq(schema.categoryBudgets.familyId, familyId),
          eq(schema.categoryBudgets.currency, from),
        ),
      )
      .run(),
  );

  counts.wishlistItems = changes(
    await db
      .update(schema.wishlistItems)
      .set({ currency: to, updatedAt: sql`(unixepoch())` })
      .where(
        and(
          eq(schema.wishlistItems.familyId, familyId),
          eq(schema.wishlistItems.currency, from),
        ),
      )
      .run(),
  );

  counts.fundAccounts = changes(
    await db
      .update(schema.fundAccounts)
      .set({ currency: to, updatedAt: sql`(unixepoch())` })
      .where(
        and(
          eq(schema.fundAccounts.familyId, familyId),
          eq(schema.fundAccounts.currency, from),
        ),
      )
      .run(),
  );

  counts.fundContributions = changes(
    await db
      .update(schema.fundContributions)
      .set({ currency: to })
      .where(
        and(
          eq(schema.fundContributions.familyId, familyId),
          eq(schema.fundContributions.currency, from),
        ),
      )
      .run(),
  );

  counts.fundSpends = changes(
    await db
      .update(schema.fundSpends)
      .set({ currency: to })
      .where(
        and(
          eq(schema.fundSpends.familyId, familyId),
          eq(schema.fundSpends.currency, from),
        ),
      )
      .run(),
  );

  return counts;
}

export function totalRelabeled(counts: RelabelCounts): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}
