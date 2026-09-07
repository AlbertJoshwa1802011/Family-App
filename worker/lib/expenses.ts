/** Shared expense helpers — used by the expenses API and the assistant tools. */

import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { schema } from "../db/client";

/** Top-level category slugs kept for filters + assistant tool enums. */
export const EXPENSE_CATEGORIES = [
  "food",
  "groceries",
  "transport",
  "household",
  "medical",
  "education",
  "entertainment",
  "travel",
  "shopping",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const CATEGORY_SET = new Set<string>(EXPENSE_CATEGORIES);

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return CATEGORY_SET.has(value);
}

/**
 * Money Manager–style default tree. Parents are the top-level buckets; children
 * are the leaf picks users make when logging an expense. `slug` is stable so
 * we can seed once per family and map legacy `expenses.category` text.
 */
export const DEFAULT_EXPENSE_CATEGORY_TREE: ReadonlyArray<{
  slug: ExpenseCategory;
  name: string;
  emoji: string;
  children: ReadonlyArray<{ slug: string; name: string; emoji: string }>;
}> = [
  {
    slug: "food",
    name: "Food & Dining",
    emoji: "🍔",
    children: [
      { slug: "food-breakfast", name: "Breakfast", emoji: "🥐" },
      { slug: "food-lunch", name: "Lunch", emoji: "🍱" },
      { slug: "food-dinner", name: "Dinner", emoji: "🍽️" },
      { slug: "food-snacks", name: "Snacks", emoji: "🍿" },
      { slug: "food-coffee", name: "Coffee & Tea", emoji: "☕" },
      { slug: "food-restaurant", name: "Restaurant", emoji: "🍜" },
      { slug: "food-delivery", name: "Delivery", emoji: "🛵" },
    ],
  },
  {
    slug: "groceries",
    name: "Groceries",
    emoji: "🛒",
    children: [
      { slug: "groceries-supermarket", name: "Supermarket", emoji: "🏪" },
      { slug: "groceries-vegetables", name: "Vegetables & Fruit", emoji: "🥬" },
      { slug: "groceries-dairy", name: "Dairy & Eggs", emoji: "🥛" },
      { slug: "groceries-meat", name: "Meat & Fish", emoji: "🥩" },
    ],
  },
  {
    slug: "transport",
    name: "Transport",
    emoji: "🚗",
    children: [
      { slug: "transport-fuel", name: "Fuel", emoji: "⛽" },
      { slug: "transport-taxi", name: "Taxi / Cab", emoji: "🚕" },
      { slug: "transport-parking", name: "Parking", emoji: "🅿️" },
      { slug: "transport-transit", name: "Bus / Metro", emoji: "🚇" },
      { slug: "transport-toll", name: "Toll", emoji: "🛣️" },
    ],
  },
  {
    slug: "household",
    name: "Household",
    emoji: "🏠",
    children: [
      { slug: "household-rent", name: "Rent", emoji: "🔑" },
      { slug: "household-utilities", name: "Utilities", emoji: "💡" },
      { slug: "household-maintenance", name: "Maintenance", emoji: "🔧" },
      { slug: "household-supplies", name: "Supplies", emoji: "🧹" },
    ],
  },
  {
    slug: "medical",
    name: "Medical",
    emoji: "💊",
    children: [
      { slug: "medical-pharmacy", name: "Pharmacy", emoji: "💉" },
      { slug: "medical-doctor", name: "Doctor", emoji: "🩺" },
      { slug: "medical-lab", name: "Lab tests", emoji: "🧪" },
      { slug: "medical-insurance", name: "Insurance", emoji: "🛡️" },
    ],
  },
  {
    slug: "education",
    name: "Education",
    emoji: "📚",
    children: [
      { slug: "education-tuition", name: "Tuition", emoji: "🎓" },
      { slug: "education-books", name: "Books", emoji: "📖" },
      { slug: "education-courses", name: "Courses", emoji: "🧑‍💻" },
      { slug: "education-stationery", name: "Stationery", emoji: "✏️" },
    ],
  },
  {
    slug: "entertainment",
    name: "Entertainment",
    emoji: "🎬",
    children: [
      { slug: "entertainment-movies", name: "Movies", emoji: "🎥" },
      { slug: "entertainment-games", name: "Games", emoji: "🎮" },
      { slug: "entertainment-streaming", name: "Streaming", emoji: "📺" },
      { slug: "entertainment-outing", name: "Outing", emoji: "🎢" },
    ],
  },
  {
    slug: "travel",
    name: "Travel",
    emoji: "✈️",
    children: [
      { slug: "travel-flights", name: "Flights", emoji: "🛫" },
      { slug: "travel-hotel", name: "Hotel", emoji: "🏨" },
      { slug: "travel-local", name: "Local travel", emoji: "🗺️" },
      { slug: "travel-sightseeing", name: "Sightseeing", emoji: "🗽" },
    ],
  },
  {
    slug: "shopping",
    name: "Shopping",
    emoji: "🛍️",
    children: [
      { slug: "shopping-clothes", name: "Clothes", emoji: "👕" },
      { slug: "shopping-electronics", name: "Electronics", emoji: "📱" },
      { slug: "shopping-gifts", name: "Gifts", emoji: "🎁" },
    ],
  },
  {
    slug: "other",
    name: "Other",
    emoji: "📦",
    children: [{ slug: "other-misc", name: "Misc", emoji: "🔖" }],
  },
];

export type ExpenseCategoryRow = typeof schema.expenseCategories.$inferSelect;

export type ExpenseCategoryNode = {
  id: string;
  name: string;
  emoji: string;
  slug: string | null;
  parentId: string | null;
  sortOrder: number;
  children: ExpenseCategoryNode[];
};

/** Convert a major-unit amount (100, 99.5) to integer cents. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Convert integer cents to a major-unit number (10000 → 100). */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** Display helper: 10000 + INR → "₹100"; 1050 + USD → "$10.50". */
export function formatMoney(cents: number, currency: string): string {
  const major = fromCents(cents);
  const formatted = cents % 100 === 0 ? String(major) : major.toFixed(2);
  if (currency === "INR") return `₹${formatted}`;
  if (currency === "USD") return `$${formatted}`;
  if (currency === "EUR") return `€${formatted}`;
  if (currency === "GBP") return `£${formatted}`;
  return `${formatted} ${currency}`;
}

/**
 * Seed the Money Manager–style default tree the first time a family opens
 * expenses. Idempotent: if any category already exists for the family, skip.
 */
export async function ensureFamilyCategories(
  db: Db,
  familyId: string,
): Promise<ExpenseCategoryRow[]> {
  const existing = await db
    .select()
    .from(schema.expenseCategories)
    .where(eq(schema.expenseCategories.familyId, familyId));

  if (existing.length > 0) return existing;

  const now = Math.floor(Date.now() / 1000);
  const rows: (typeof schema.expenseCategories.$inferInsert)[] = [];

  for (let i = 0; i < DEFAULT_EXPENSE_CATEGORY_TREE.length; i++) {
    const parent = DEFAULT_EXPENSE_CATEGORY_TREE[i]!;
    const parentId = crypto.randomUUID();
    rows.push({
      id: parentId,
      familyId,
      parentId: null,
      name: parent.name,
      emoji: parent.emoji,
      slug: parent.slug,
      sortOrder: i,
      createdAt: now,
      updatedAt: now,
    });
    for (let j = 0; j < parent.children.length; j++) {
      const child = parent.children[j]!;
      rows.push({
        id: crypto.randomUUID(),
        familyId,
        parentId,
        name: child.name,
        emoji: child.emoji,
        slug: child.slug,
        sortOrder: j,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  await db.insert(schema.expenseCategories).values(rows);

  // Backfill legacy expenses that only had a category slug text.
  for (const parent of DEFAULT_EXPENSE_CATEGORY_TREE) {
    const parentRow = rows.find((r) => r.slug === parent.slug && !r.parentId);
    if (!parentRow) continue;
    await db
      .update(schema.expenses)
      .set({ categoryId: parentRow.id as string, updatedAt: now })
      .where(
        and(
          eq(schema.expenses.familyId, familyId),
          eq(schema.expenses.category, parent.slug),
          isNull(schema.expenses.categoryId),
        ),
      );
  }

  return db
    .select()
    .from(schema.expenseCategories)
    .where(eq(schema.expenseCategories.familyId, familyId));
}

/** Nest flat category rows into a parent → children tree, sorted. */
export function buildCategoryTree(
  rows: ExpenseCategoryRow[],
): ExpenseCategoryNode[] {
  const byParent = new Map<string | null, ExpenseCategoryRow[]>();
  for (const row of rows) {
    const key = row.parentId;
    const list = byParent.get(key) ?? [];
    list.push(row);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  function nest(parentId: string | null): ExpenseCategoryNode[] {
    return (byParent.get(parentId) ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      emoji: row.emoji,
      slug: row.slug,
      parentId: row.parentId,
      sortOrder: row.sortOrder,
      children: nest(row.id),
    }));
  }

  return nest(null);
}

/** Resolve a categoryId belonging to the family, or null if missing/cross-family. */
export async function getFamilyCategory(
  db: Db,
  familyId: string,
  categoryId: string,
): Promise<ExpenseCategoryRow | null> {
  const row = await db
    .select()
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

/**
 * Map a legacy/assistant parent slug to a category row (prefers the parent
 * itself so the expense keeps the familiar top-level label).
 */
export async function resolveCategoryBySlug(
  db: Db,
  familyId: string,
  slug: string,
): Promise<ExpenseCategoryRow | null> {
  const rows = await ensureFamilyCategories(db, familyId);
  return rows.find((r) => r.slug === slug && r.parentId === null) ??
    rows.find((r) => r.slug === slug) ??
    null;
}

/** Root parent slug for filtering (`food` even when the leaf is Snacks). */
export function rootCategorySlug(
  rows: ExpenseCategoryRow[],
  categoryId: string | null | undefined,
  fallback: string,
): string {
  if (!categoryId) return fallback;
  const byId = new Map(rows.map((r) => [r.id, r]));
  let cur = byId.get(categoryId);
  if (!cur) return fallback;
  while (cur.parentId) {
    const parent = byId.get(cur.parentId);
    if (!parent) break;
    cur = parent;
  }
  return cur.slug && isExpenseCategory(cur.slug) ? cur.slug : fallback;
}
