/**
 * Default categories, subcategories and payment methods, plus the idempotent
 * per-family bootstrap that installs them.
 *
 * These are SEED DATA, not business logic. Every seeded row is fully editable:
 * a family can rename it, change its emoji, reorder it or archive it. Nothing
 * downstream may branch on a category name or slug — analytics groups by id,
 * the UI renders whatever the row says. (`is_system` exists only to protect
 * seeded rows from hard deletion and to support "reset to defaults" later.)
 *
 * Seeding a copy per family — rather than sharing global rows with
 * `family_id IS NULL` — keeps every query a plain `WHERE family_id = ?`, keeps
 * customisation from leaking across families, and costs ~4 KB per family.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { schema } from "../../db/client";
import { DEFAULT_CURRENCY } from "../../../shared/money";

/**
 * Palette slugs the frontend maps to static Tailwind classes. Stored as a slug
 * (not a hex value) so themes stay coherent and a re-theme doesn't require a
 * data migration.
 */
export const CATEGORY_COLORS = [
  "amber",
  "orange",
  "rose",
  "pink",
  "violet",
  "indigo",
  "blue",
  "sky",
  "cyan",
  "teal",
  "emerald",
  "lime",
  "slate",
] as const;
export type CategoryColor = (typeof CATEGORY_COLORS)[number];

export interface SubcategorySeed {
  slug: string;
  name: string;
  emoji: string;
}

export interface CategorySeed {
  slug: string;
  name: string;
  emoji: string;
  color: CategoryColor;
  children: SubcategorySeed[];
}

/**
 * Child slugs are parent-prefixed so the per-family slug namespace is
 * collision-free ("streaming" legitimately appears under both Entertainment and
 * Subscriptions).
 */
export const DEFAULT_EXPENSE_CATEGORIES: CategorySeed[] = [
  {
    slug: "food",
    name: "Food",
    emoji: "🍔",
    color: "amber",
    children: [
      { slug: "food-restaurants", name: "Restaurants", emoji: "🍛" },
      { slug: "food-groceries", name: "Groceries", emoji: "🛒" },
      { slug: "food-coffee", name: "Coffee", emoji: "☕" },
      { slug: "food-takeaway", name: "Takeaway", emoji: "🥡" },
      { slug: "food-fast-food", name: "Fast Food", emoji: "🍕" },
    ],
  },
  {
    slug: "transport",
    name: "Transport",
    emoji: "🚗",
    color: "sky",
    children: [
      { slug: "transport-fuel", name: "Fuel", emoji: "⛽" },
      { slug: "transport-taxi", name: "Taxi", emoji: "🚕" },
      { slug: "transport-public", name: "Public Transport", emoji: "🚌" },
      { slug: "transport-parking", name: "Parking", emoji: "🅿️" },
      { slug: "transport-maintenance", name: "Vehicle Maintenance", emoji: "🔧" },
    ],
  },
  {
    slug: "home",
    name: "Home",
    emoji: "🏠",
    color: "teal",
    children: [
      { slug: "home-rent", name: "Rent", emoji: "🏠" },
      { slug: "home-electricity", name: "Electricity", emoji: "💡" },
      { slug: "home-water", name: "Water", emoji: "💧" },
      { slug: "home-internet", name: "Internet", emoji: "🌐" },
      { slug: "home-furniture", name: "Furniture", emoji: "🛋️" },
      { slug: "home-cleaning", name: "Cleaning", emoji: "🧹" },
    ],
  },
  {
    slug: "shopping",
    name: "Shopping",
    emoji: "🛍️",
    color: "pink",
    children: [
      { slug: "shopping-clothing", name: "Clothing", emoji: "👕" },
      { slug: "shopping-electronics", name: "Electronics", emoji: "📱" },
      { slug: "shopping-general", name: "General", emoji: "🛒" },
      { slug: "shopping-gifts", name: "Gifts", emoji: "🎁" },
    ],
  },
  {
    slug: "health",
    name: "Health",
    emoji: "💊",
    color: "rose",
    children: [
      { slug: "health-medicine", name: "Medicine", emoji: "💊" },
      { slug: "health-hospital", name: "Hospital", emoji: "🏥" },
      { slug: "health-dental", name: "Dental", emoji: "🦷" },
      { slug: "health-fitness", name: "Fitness", emoji: "🏋️" },
    ],
  },
  {
    slug: "education",
    name: "Education",
    emoji: "🎓",
    color: "indigo",
    children: [
      { slug: "education-books", name: "Books", emoji: "📚" },
      { slug: "education-courses", name: "Courses", emoji: "🎓" },
      { slug: "education-tuition", name: "Tuition", emoji: "🏫" },
    ],
  },
  {
    slug: "entertainment",
    name: "Entertainment",
    emoji: "🎬",
    color: "violet",
    children: [
      { slug: "entertainment-movies", name: "Movies", emoji: "🎬" },
      { slug: "entertainment-gaming", name: "Gaming", emoji: "🎮" },
      { slug: "entertainment-music", name: "Music", emoji: "🎵" },
      { slug: "entertainment-streaming", name: "Streaming", emoji: "📺" },
    ],
  },
  {
    slug: "finance",
    name: "Finance",
    emoji: "💰",
    color: "emerald",
    children: [
      { slug: "finance-bank-fees", name: "Bank Fees", emoji: "🏦" },
      { slug: "finance-card-fees", name: "Credit Card Fees", emoji: "💳" },
      { slug: "finance-investments", name: "Investments", emoji: "📈" },
      // User-classified money sent out (gifts to relatives, loan repayment).
      // NOT the same as TransactionKind 'transfer' (movement between the
      // family's own accounts), which must never count as spending at all.
      { slug: "finance-money-sent", name: "Money Sent", emoji: "💸" },
    ],
  },
  {
    slug: "travel",
    name: "Travel",
    emoji: "✈️",
    color: "cyan",
    children: [
      { slug: "travel-flights", name: "Flights", emoji: "✈️" },
      { slug: "travel-hotels", name: "Hotels", emoji: "🏨" },
      { slug: "travel-food", name: "Travel Food", emoji: "🍽️" },
      { slug: "travel-transport", name: "Travel Transport", emoji: "🚕" },
    ],
  },
  {
    slug: "family",
    name: "Family",
    emoji: "👨‍👩‍👧",
    color: "orange",
    children: [
      { slug: "family-children", name: "Children", emoji: "👶" },
      { slug: "family-gifts", name: "Family Gifts", emoji: "🎁" },
      { slug: "family-education", name: "Family Education", emoji: "🏫" },
    ],
  },
  {
    slug: "subscriptions",
    name: "Subscriptions",
    emoji: "📦",
    color: "blue",
    children: [
      { slug: "subscriptions-streaming", name: "Streaming", emoji: "📺" },
      { slug: "subscriptions-cloud", name: "Cloud Storage", emoji: "☁️" },
      { slug: "subscriptions-software", name: "Software", emoji: "💻" },
      { slug: "subscriptions-mobile", name: "Mobile", emoji: "📱" },
    ],
  },
  {
    slug: "other",
    name: "Other",
    emoji: "📌",
    color: "slate",
    children: [],
  },
];

export interface PaymentMethodSeed {
  slug: string;
  name: string;
  emoji: string;
  kind: "cash" | "card" | "bank" | "upi" | "wallet" | "other";
}

export const DEFAULT_PAYMENT_METHODS: PaymentMethodSeed[] = [
  { slug: "cash", name: "Cash", emoji: "💵", kind: "cash" },
  { slug: "upi", name: "UPI", emoji: "📱", kind: "upi" },
  { slug: "credit-card", name: "Credit Card", emoji: "💳", kind: "card" },
  { slug: "debit-card", name: "Debit Card", emoji: "💳", kind: "card" },
  { slug: "bank-transfer", name: "Bank Transfer", emoji: "🏦", kind: "bank" },
  { slug: "wallet", name: "Wallet", emoji: "👛", kind: "wallet" },
  { slug: "other", name: "Other", emoji: "❔", kind: "other" },
];

/**
 * D1 caps a query at 100 bound parameters, so multi-row inserts are chunked.
 * Categories bind 10 columns per row → 8 rows (80 params) stays well clear.
 */
const INSERT_CHUNK_SIZE = 8;
/** Sort orders are spaced so a user can later drop a row between two others. */
const SORT_STEP = 10;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface ExpenseSetupResult {
  categoriesSeeded: number;
  paymentMethodsSeeded: number;
  settingsCreated: boolean;
}

/**
 * Install the expense module's per-family baseline. Safe to call repeatedly —
 * every step no-ops when the data already exists, and the unique
 * (family_id, slug) indexes make concurrent calls harmless.
 *
 * The caller must have already verified family membership.
 */
export async function ensureExpenseSetup(
  db: Db,
  familyId: string,
): Promise<ExpenseSetupResult> {
  return {
    categoriesSeeded: await seedCategories(db, familyId),
    paymentMethodsSeeded: await seedPaymentMethods(db, familyId),
    settingsCreated: await ensureSettings(db, familyId),
  };
}

async function seedCategories(db: Db, familyId: string): Promise<number> {
  const existing = await db
    .select({ id: schema.expenseCategories.id })
    .from(schema.expenseCategories)
    .where(eq(schema.expenseCategories.familyId, familyId))
    .limit(1);
  if (existing.length > 0) return 0;

  const parentRows = DEFAULT_EXPENSE_CATEGORIES.map((cat, i) => ({
    id: crypto.randomUUID(),
    familyId,
    parentId: null,
    name: cat.name,
    slug: cat.slug,
    emoji: cat.emoji,
    color: cat.color as string,
    sortOrder: i * SORT_STEP,
    isSystem: true,
  }));

  for (const part of chunk(parentRows, INSERT_CHUNK_SIZE)) {
    await db.insert(schema.expenseCategories).values(part).onConflictDoNothing();
  }

  // Re-read the parent ids instead of trusting the ones we just generated: if a
  // concurrent bootstrap won the race, our inserts were skipped and the real
  // ids are the other run's. Children must never point at a phantom parent.
  const parents = await db
    .select({
      id: schema.expenseCategories.id,
      slug: schema.expenseCategories.slug,
    })
    .from(schema.expenseCategories)
    .where(eq(schema.expenseCategories.familyId, familyId));
  const idBySlug = new Map(parents.map((p) => [p.slug, p.id]));

  const childRows = DEFAULT_EXPENSE_CATEGORIES.flatMap((cat) => {
    const parentId = idBySlug.get(cat.slug);
    if (!parentId) return [];
    return cat.children.map((child, i) => ({
      id: crypto.randomUUID(),
      familyId,
      parentId,
      name: child.name,
      slug: child.slug,
      emoji: child.emoji,
      // NULL colour = inherit the parent's, so re-theming a category carries
      // through to its subcategories.
      color: null,
      sortOrder: i * SORT_STEP,
      isSystem: true,
    }));
  });

  for (const part of chunk(childRows, INSERT_CHUNK_SIZE)) {
    await db.insert(schema.expenseCategories).values(part).onConflictDoNothing();
  }

  return parentRows.length + childRows.length;
}

async function seedPaymentMethods(db: Db, familyId: string): Promise<number> {
  const existing = await db
    .select({ id: schema.expensePaymentMethods.id })
    .from(schema.expensePaymentMethods)
    .where(eq(schema.expensePaymentMethods.familyId, familyId))
    .limit(1);
  if (existing.length > 0) return 0;

  const rows = DEFAULT_PAYMENT_METHODS.map((pm, i) => ({
    id: crypto.randomUUID(),
    familyId,
    name: pm.name,
    slug: pm.slug,
    kind: pm.kind,
    emoji: pm.emoji,
    sortOrder: i * SORT_STEP,
    isSystem: true,
  }));

  for (const part of chunk(rows, INSERT_CHUNK_SIZE)) {
    await db.insert(schema.expensePaymentMethods).values(part).onConflictDoNothing();
  }

  return rows.length;
}

async function ensureSettings(db: Db, familyId: string): Promise<boolean> {
  const existing = await db
    .select({ familyId: schema.expenseSettings.familyId })
    .from(schema.expenseSettings)
    .where(eq(schema.expenseSettings.familyId, familyId))
    .limit(1);
  if (existing.length > 0) return false;

  await db
    .insert(schema.expenseSettings)
    .values({ familyId, defaultCurrency: DEFAULT_CURRENCY })
    .onConflictDoNothing();

  return true;
}
