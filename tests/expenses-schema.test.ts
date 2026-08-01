/**
 * Expense schema + seeding, exercised against the REAL generated migrations
 * running on a real SQLite engine (see tests/helpers/testEnv.ts).
 *
 * These tests protect the invariants that are expensive to discover later:
 * positive amounts, import de-duplication, per-family slug uniqueness, and a
 * bootstrap that is safe to call twice.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DatabaseSync } from "node:sqlite";
import { getDb, schema } from "../worker/db/client";
import type { Env } from "../worker/types";
import {
  createTestEnv,
  seedExpense,
  seedExpenseCategory,
  seedFamily,
  seedMember,
  seedUser,
} from "./helpers/testEnv";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_PAYMENT_METHODS,
  ensureExpenseSetup,
} from "../worker/lib/expenses/defaults";

let env: Env;
let sqlite: DatabaseSync;
let familyId: string;
let userId: string;

beforeEach(() => {
  ({ env, sqlite } = createTestEnv());
  const user = seedUser(sqlite);
  userId = user.id;
  familyId = seedFamily(sqlite, userId).id;
  seedMember(sqlite, familyId, userId, "owner");
});

describe("migration 0005", () => {
  it("creates the four expense tables", () => {
    const names = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);

    expect(names).toContain("expense_categories");
    expect(names).toContain("expense_payment_methods");
    expect(names).toContain("expenses");
    expect(names).toContain("expense_settings");
  });

  it("creates every index the analytics layer depends on", () => {
    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all()
      .map((r) => (r as { name: string }).name);

    for (const name of [
      "idx_exp_family_date",
      "idx_exp_family_status_date",
      "idx_exp_family_cat_date",
      "idx_exp_family_merchant",
      "uq_exp_external",
      "uq_expcat_family_slug",
      "idx_expcat_family_parent",
      "uq_exppm_family_slug",
    ]) {
      expect(indexes, `missing index ${name}`).toContain(name);
    }
  });

  it("leaves the existing tables untouched", () => {
    const names = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);

    // Spot-check the core of the pre-existing app: the expense migration is
    // purely additive and must not have recreated or dropped anything.
    for (const name of ["users", "families", "documents", "events", "tasks"]) {
      expect(names).toContain(name);
    }
  });
});

describe("expenses table constraints", () => {
  let categoryId: string;

  beforeEach(() => {
    categoryId = seedExpenseCategory(sqlite, { familyId, slug: "food" }).id;
  });

  function insert(sql: string, params: unknown[]) {
    return () =>
      sqlite
        .prepare(sql)
        .run(...(params as (string | number | null)[]));
  }

  const BASE =
    `INSERT INTO expenses (id, family_id, created_by_user_id, amount_minor, spent_on, category_id)
     VALUES (?, ?, ?, ?, ?, ?)`;

  it("rejects a zero amount", () => {
    expect(
      insert(BASE, [crypto.randomUUID(), familyId, userId, 0, "2026-08-01", categoryId]),
    ).toThrow(/CHECK/i);
  });

  it("rejects a negative amount — refunds are never negative expenses", () => {
    expect(
      insert(BASE, [crypto.randomUUID(), familyId, userId, -500, "2026-08-01", categoryId]),
    ).toThrow(/CHECK/i);
  });

  it("accepts a positive amount", () => {
    expect(
      insert(BASE, [crypto.randomUUID(), familyId, userId, 45000, "2026-08-01", categoryId]),
    ).not.toThrow();
  });

  it("defaults to INR, family visibility, active status and manual source", () => {
    const id = seedExpense(sqlite, { familyId, createdByUserId: userId, categoryId }).id;
    const row = sqlite
      .prepare(
        "SELECT currency, visibility, status, source FROM expenses WHERE id = ?",
      )
      .get(id) as Record<string, string>;

    expect(row.currency).toBe("INR");
    expect(row.visibility).toBe("family");
    expect(row.status).toBe("active");
    expect(row.source).toBe("manual");
  });

  it("de-duplicates imported transactions by (family, source, external id)", () => {
    seedExpense(sqlite, {
      familyId,
      createdByUserId: userId,
      categoryId,
      source: "bank_sync",
      externalId: "TXN-1",
    });

    expect(() =>
      seedExpense(sqlite, {
        familyId,
        createdByUserId: userId,
        categoryId,
        source: "bank_sync",
        externalId: "TXN-1",
      }),
    ).toThrow(/UNIQUE/i);
  });

  it("scopes the dedupe index by source and family", () => {
    seedExpense(sqlite, {
      familyId,
      createdByUserId: userId,
      categoryId,
      source: "bank_sync",
      externalId: "TXN-1",
    });

    // Same id from a different provider is a different transaction.
    expect(() =>
      seedExpense(sqlite, {
        familyId,
        createdByUserId: userId,
        categoryId,
        source: "csv_import",
        externalId: "TXN-1",
      }),
    ).not.toThrow();

    // Same id in another family is also unrelated.
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    const otherCategory = seedExpenseCategory(sqlite, {
      familyId: otherFamily,
      slug: "food",
    }).id;
    expect(() =>
      seedExpense(sqlite, {
        familyId: otherFamily,
        createdByUserId: otherUser.id,
        categoryId: otherCategory,
        source: "bank_sync",
        externalId: "TXN-1",
      }),
    ).not.toThrow();
  });

  it("lets any number of manual expenses coexist (partial index)", () => {
    for (let i = 0; i < 5; i++) {
      expect(() =>
        seedExpense(sqlite, { familyId, createdByUserId: userId, categoryId }),
      ).not.toThrow();
    }
  });

  it("deletes a family's expenses when the family goes away", () => {
    seedExpense(sqlite, { familyId, createdByUserId: userId, categoryId });
    sqlite.prepare("DELETE FROM families WHERE id = ?").run(familyId);

    const remaining = sqlite
      .prepare("SELECT COUNT(*) AS c FROM expenses")
      .get() as { c: number };
    expect(remaining.c).toBe(0);
  });
});

describe("expense_categories constraints", () => {
  it("enforces one slug per family", () => {
    seedExpenseCategory(sqlite, { familyId, slug: "food" });
    expect(() => seedExpenseCategory(sqlite, { familyId, slug: "food" })).toThrow(
      /UNIQUE/i,
    );
  });

  it("allows the same slug in a different family", () => {
    seedExpenseCategory(sqlite, { familyId, slug: "food" });
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    expect(() =>
      seedExpenseCategory(sqlite, { familyId: otherFamily, slug: "food" }),
    ).not.toThrow();
  });

  it("supports subcategories via the self reference", () => {
    const parent = seedExpenseCategory(sqlite, { familyId, slug: "food" });
    const child = seedExpenseCategory(sqlite, {
      familyId,
      slug: "food-groceries",
      parentId: parent.id,
    });

    const row = sqlite
      .prepare("SELECT parent_id FROM expense_categories WHERE id = ?")
      .get(child.id) as { parent_id: string };
    expect(row.parent_id).toBe(parent.id);
  });
});

describe("ensureExpenseSetup", () => {
  it("seeds categories, subcategories, payment methods and settings", async () => {
    const db = getDb(env);
    const result = await ensureExpenseSetup(db, familyId);

    const expectedParents = DEFAULT_EXPENSE_CATEGORIES.length;
    const expectedChildren = DEFAULT_EXPENSE_CATEGORIES.reduce(
      (n, c) => n + c.children.length,
      0,
    );

    expect(result.categoriesSeeded).toBe(expectedParents + expectedChildren);
    expect(result.paymentMethodsSeeded).toBe(DEFAULT_PAYMENT_METHODS.length);
    expect(result.settingsCreated).toBe(true);

    const rows = await db
      .select({
        id: schema.expenseCategories.id,
        parentId: schema.expenseCategories.parentId,
      })
      .from(schema.expenseCategories)
      .where(eq(schema.expenseCategories.familyId, familyId));

    expect(rows.filter((r) => r.parentId === null)).toHaveLength(expectedParents);
    expect(rows.filter((r) => r.parentId !== null)).toHaveLength(expectedChildren);
  });

  it("is idempotent — a second call changes nothing", async () => {
    const db = getDb(env);
    await ensureExpenseSetup(db, familyId);
    const second = await ensureExpenseSetup(db, familyId);

    expect(second).toEqual({
      categoriesSeeded: 0,
      paymentMethodsSeeded: 0,
      settingsCreated: false,
    });

    const count = sqlite
      .prepare("SELECT COUNT(*) AS c FROM expense_categories WHERE family_id = ?")
      .get(familyId) as { c: number };
    const expected =
      DEFAULT_EXPENSE_CATEGORIES.length +
      DEFAULT_EXPENSE_CATEGORIES.reduce((n, c) => n + c.children.length, 0);
    expect(count.c).toBe(expected);
  });

  it("every seeded subcategory points at a real parent in the same family", async () => {
    const db = getDb(env);
    await ensureExpenseSetup(db, familyId);

    const orphans = sqlite
      .prepare(
        `SELECT COUNT(*) AS c FROM expense_categories child
          WHERE child.parent_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM expense_categories parent
               WHERE parent.id = child.parent_id
                 AND parent.family_id = child.family_id
                 AND parent.parent_id IS NULL
            )`,
      )
      .get() as { c: number };

    expect(orphans.c).toBe(0);
  });

  it("keeps the category tree at most two levels deep", () => {
    const depthThree = DEFAULT_EXPENSE_CATEGORIES.every((cat) =>
      cat.children.every((child) => !("children" in child)),
    );
    expect(depthThree).toBe(true);
  });

  it("uses globally unique slugs across parents and children", () => {
    const slugs = DEFAULT_EXPENSE_CATEGORIES.flatMap((c) => [
      c.slug,
      ...c.children.map((ch) => ch.slug),
    ]);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("defaults the family's currency to INR", async () => {
    const db = getDb(env);
    await ensureExpenseSetup(db, familyId);

    const settings = await db
      .select({ currency: schema.expenseSettings.defaultCurrency })
      .from(schema.expenseSettings)
      .where(eq(schema.expenseSettings.familyId, familyId))
      .get();

    expect(settings?.currency).toBe("INR");
  });

  it("seeds each family independently", async () => {
    const db = getDb(env);
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;

    await ensureExpenseSetup(db, familyId);
    const second = await ensureExpenseSetup(db, otherFamily);

    expect(second.categoriesSeeded).toBeGreaterThan(0);
    expect(second.settingsCreated).toBe(true);
  });
});
