/**
 * Built-in expense categories (docs/EXPENSE_TRACKER_SPEC.md §13).
 *
 * Global rows use familyId = NULL and stable ids (`builtin_*`) so they can be
 * upserted idempotently on first read without a data migration. Custom
 * family categories are created via the categories API (admin+).
 *
 * Decision (E1): seed household-oriented built-ins covering the fast-entry
 * grocery/rent/utilities cases in the product brief, plus giving / EMI /
 * investments. Icons are lucide names for the SPA; color is an optional accent
 * hint. Built-ins cannot be archived in V1 (no per-family hide table —
 * deferred §25). One level of nesting is supported via parentCategoryId
 * (e.g. Fuel under Transport).
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../../db/client";
import { schema } from "../../db/client";

export type BuiltinCategoryDef = {
  id: string;
  name: string;
  icon: string;
  color: string;
  /** Optional parent among the builtins (one level of nesting only). */
  parentCategoryId?: string | null;
};

export const BUILTIN_EXPENSE_CATEGORIES: readonly BuiltinCategoryDef[] = [
  { id: "builtin_groceries", name: "Groceries", icon: "ShoppingCart", color: "#16a34a" },
  {
    id: "builtin_groceries_supermarket",
    name: "Supermarket",
    icon: "Store",
    color: "#16a34a",
    parentCategoryId: "builtin_groceries",
  },
  {
    id: "builtin_groceries_vegetables",
    name: "Vegetables",
    icon: "Leaf",
    color: "#15803d",
    parentCategoryId: "builtin_groceries",
  },
  { id: "builtin_dining", name: "Dining out", icon: "Utensils", color: "#ea580c" },
  {
    id: "builtin_dining_coffee",
    name: "Coffee",
    icon: "Coffee",
    color: "#c2410c",
    parentCategoryId: "builtin_dining",
  },
  {
    id: "builtin_dining_restaurants",
    name: "Restaurants",
    icon: "UtensilsCrossed",
    color: "#ea580c",
    parentCategoryId: "builtin_dining",
  },
  { id: "builtin_transport", name: "Transport", icon: "Bus", color: "#2563eb" },
  {
    id: "builtin_fuel",
    name: "Fuel",
    icon: "Fuel",
    color: "#ca8a04",
    parentCategoryId: "builtin_transport",
  },
  {
    id: "builtin_transport_rideshare",
    name: "Rideshare & taxi",
    icon: "Car",
    color: "#1d4ed8",
    parentCategoryId: "builtin_transport",
  },
  { id: "builtin_housing", name: "Housing", icon: "Home", color: "#7c3aed" },
  { id: "builtin_utilities", name: "Utilities", icon: "Zap", color: "#0891b2" },
  { id: "builtin_internet", name: "Internet & phone", icon: "Wifi", color: "#4f46e5" },
  { id: "builtin_healthcare", name: "Healthcare", icon: "HeartPulse", color: "#dc2626" },
  { id: "builtin_education", name: "Education", icon: "GraduationCap", color: "#0d9488" },
  { id: "builtin_insurance", name: "Insurance", icon: "Shield", color: "#0369a1" },
  { id: "builtin_subscriptions", name: "Subscriptions", icon: "Repeat", color: "#db2777" },
  { id: "builtin_shopping", name: "Shopping", icon: "ShoppingBag", color: "#9333ea" },
  {
    id: "builtin_shopping_online",
    name: "Online",
    icon: "Globe",
    color: "#7e22ce",
    parentCategoryId: "builtin_shopping",
  },
  {
    id: "builtin_shopping_offline",
    name: "Offline",
    icon: "Store",
    color: "#9333ea",
    parentCategoryId: "builtin_shopping",
  },
  { id: "builtin_entertainment", name: "Entertainment", icon: "Clapperboard", color: "#c026d3" },
  { id: "builtin_travel", name: "Travel", icon: "Plane", color: "#0284c7" },
  { id: "builtin_personal_care", name: "Personal care", icon: "Sparkles", color: "#d97706" },
  { id: "builtin_gifts", name: "Gifts & donations", icon: "Gift", color: "#e11d48" },
  { id: "builtin_tithe", name: "Tithe", icon: "HeartHandshake", color: "#be123c" },
  {
    id: "builtin_children",
    name: "Children & family help",
    icon: "Users",
    color: "#db2777",
  },
  {
    id: "builtin_investments",
    name: "Investments",
    icon: "TrendingUp",
    color: "#059669",
  },
  { id: "builtin_emi", name: "EMI & loans", icon: "Landmark", color: "#b45309" },
  { id: "builtin_fees", name: "Fees & charges", icon: "Receipt", color: "#57534e" },
  { id: "builtin_other", name: "Other", icon: "CircleDot", color: "#64748b" },
] as const;

/**
 * Ensure all built-in categories exist. Idempotent — safe to call on every
 * categories list/create. Uses stable primary keys; does not update names of
 * rows that already exist (avoids silently renaming user-visible labels).
 * Parent links for known nesting (e.g. Fuel → Transport) are backfilled when
 * still null so already-seeded DBs pick up the hierarchy.
 */
export async function ensureBuiltinCategories(db: Db): Promise<void> {
  const ids = BUILTIN_EXPENSE_CATEGORIES.map((c) => c.id);
  const existing = await db
    .select({ id: schema.expenseCategories.id })
    .from(schema.expenseCategories)
    .where(inArray(schema.expenseCategories.id, ids));
  const have = new Set(existing.map((r) => r.id));
  const missing = BUILTIN_EXPENSE_CATEGORIES.filter((c) => !have.has(c.id));

  if (missing.length > 0) {
    await db.insert(schema.expenseCategories).values(
      missing.map((c) => ({
        id: c.id,
        familyId: null,
        parentCategoryId: c.parentCategoryId ?? null,
        name: c.name,
        icon: c.icon,
        color: c.color,
        archived: false,
      })),
    );
  }

  // Backfill parent links on already-seeded rows that predate nesting.
  for (const c of BUILTIN_EXPENSE_CATEGORIES) {
    if (!c.parentCategoryId) continue;
    await db
      .update(schema.expenseCategories)
      .set({ parentCategoryId: c.parentCategoryId })
      .where(
        and(
          eq(schema.expenseCategories.id, c.id),
          isNull(schema.expenseCategories.parentCategoryId),
        ),
      );
  }
}
