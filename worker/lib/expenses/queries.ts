/**
 * Expense domain logic — reference validation, CRUD, listing and the small
 * derived signals the Add-Expense sheet uses (recent categories, frequent
 * merchants). Route handlers stay thin (auth + this); Phase F's analytics
 * layer reuses `listExpenses`'s filter-building and `expenseScopeWhere`
 * rather than re-deriving them.
 */
import { and, desc, eq, gte, like, lte, or, sql, type SQL } from "drizzle-orm";
import { alias, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "../../db/client";
import { schema } from "../../db/client";
import {
  allMembersInFamily,
  expenseCategoryInFamily,
  paymentMethodInFamily,
} from "../familyScope";
import { expenseScopeWhere } from "./visibility";
import { displayMerchant, merchantKey } from "./merchant";
import { DEFAULT_CURRENCY, isValidAmountMinor, toMinorUnits } from "../../../shared/money";

/**
 * Forces a REAL `AS "alias"` in the emitted SQL.
 *
 * Drizzle's sqlite dialect does not alias a plain `{ key: column }` selection
 * in the generated SQL text — it relies on the driver returning columns in
 * order. The test harness (tests/helpers/testEnv.ts) goes through
 * `node:sqlite`, which returns rows as plain objects keyed by each column's
 * OWN (unqualified) name; when a query joins several tables that share column
 * names — every one of these joins does, on "id"/"name"/"status"/"slug" — the
 * unaliased names collide and silently overwrite each other. Wrapping every
 * joined-table column in `col()` gives it a genuine, unique SQL alias, so the
 * result is unambiguous under both the real D1 driver and this test harness.
 */
function col<T>(column: AnySQLiteColumn, name: string): SQL.Aliased<T> {
  return sql<T>`${column}`.as(name);
}

// ── Small shared helpers ────────────────────────────────────────────────────

/** Server-side fallback "today" when a client omits spentOn. UTC, matching
 * the app-wide convention (CLAUDE.md §3) of comparing calendar dates at UTC
 * midnight rather than local time. The client normally sends its own local
 * "today" explicitly; this is only a safety net. */
export function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The currency new expenses default to: the family's configured default, or
 * the app default if the family hasn't saved settings yet (matches the GET
 * /expense-settings behaviour from Phase B — no row is ever required to exist). */
export async function resolveDefaultCurrency(db: Db, familyId: string): Promise<string> {
  const row = await db
    .select({ currency: schema.expenseSettings.defaultCurrency })
    .from(schema.expenseSettings)
    .where(eq(schema.expenseSettings.familyId, familyId))
    .get();
  return row?.currency ?? DEFAULT_CURRENCY;
}

/** Parse a client-submitted decimal amount into minor units for a given
 * currency. Never accepts a pre-computed minor integer from the client — this
 * is the one path amounts enter the system through, so it's the one place
 * Math.round(amount*100)-style drift could sneak back in. */
export function parseAmountMinor(
  amount: string | number,
  currency: string,
): number | null {
  const minor = toMinorUnits(amount, currency);
  if (minor === null || !isValidAmountMinor(minor)) return null;
  return minor;
}

// ── Reference integrity ─────────────────────────────────────────────────────

export type ExpenseReferenceError =
  | "invalid_category"
  | "category_archived"
  | "invalid_subcategory"
  | "subcategory_archived"
  | "invalid_payment_method"
  | "payment_method_archived"
  | "invalid_member_ids";

export interface ExpenseReferenceInput {
  categoryId: string;
  subcategoryId?: string | null;
  paymentMethodId?: string | null;
  payerMemberId?: string | null;
}

/**
 * Which of the four references to actually validate. CREATE always validates
 * everything being set. UPDATE only re-validates a reference that's actually
 * changing — an archived category must block a NEW selection of it, but must
 * not retroactively lock every other field of the historical expenses that
 * already reference it (that would defeat the entire point of archiving
 * instead of deleting — see worker/routes/expenseCategories.ts).
 */
export interface ExpenseReferenceChecks {
  category?: boolean;
  subcategory?: boolean;
  paymentMethod?: boolean;
  payer?: boolean;
}

const ALL_CHECKS: Required<ExpenseReferenceChecks> = {
  category: true,
  subcategory: true,
  paymentMethod: true,
  payer: true,
};

/**
 * Validates categoryId/subcategoryId/paymentMethodId/payerMemberId against
 * the family scope, archive status, and (for subcategories) the depth-2
 * parent/child invariant — server-side, unconditionally, regardless of what
 * the client sent. This is the single gate both create and update go through.
 */
export async function validateExpenseReferences(
  db: Db,
  familyId: string,
  input: ExpenseReferenceInput,
  checks: ExpenseReferenceChecks = ALL_CHECKS,
): Promise<{ ok: true } | { ok: false; error: ExpenseReferenceError }> {
  const check = { ...ALL_CHECKS, ...checks };

  if (check.category) {
    const cat = await expenseCategoryInFamily(db, familyId, input.categoryId);
    // A subcategory (parentId !== null) can never be used as the top-level
    // category — expenses.category_id always denotes a top-level row.
    if (!cat || cat.parentId !== null) {
      return { ok: false, error: "invalid_category" };
    }
    if (cat.status !== "active") return { ok: false, error: "category_archived" };
  }

  if (input.subcategoryId && check.subcategory) {
    const sub = await expenseCategoryInFamily(db, familyId, input.subcategoryId);
    if (!sub || sub.parentId !== input.categoryId) {
      return { ok: false, error: "invalid_subcategory" };
    }
    if (sub.status !== "active") return { ok: false, error: "subcategory_archived" };
  }

  if (input.paymentMethodId && check.paymentMethod) {
    const method = await paymentMethodInFamily(db, familyId, input.paymentMethodId);
    if (!method) return { ok: false, error: "invalid_payment_method" };
    if (method.status !== "active") return { ok: false, error: "payment_method_archived" };
  }

  if (input.payerMemberId && check.payer) {
    const ok = await allMembersInFamily(db, familyId, [input.payerMemberId]);
    if (!ok) return { ok: false, error: "invalid_member_ids" };
  }

  return { ok: true };
}

// ── Create ───────────────────────────────────────────────────────────────────

export interface CreateExpenseInput {
  familyId: string;
  createdByUserId: string;
  payerMemberId: string | null;
  amountMinor: number;
  currency: string;
  spentOn: string;
  spentTime?: string | null;
  categoryId: string;
  subcategoryId: string | null;
  merchant: string | null;
  paymentMethodId: string | null;
  notes: string | null;
  visibility: "family" | "private";
}

/** Inserts a manually-entered expense. `source` is always "manual" here —
 * external_id/external_account/import_batch_id are never populated for a
 * manual entry (see worker/lib/expenses/ingest.ts — those columns exist for a
 * future importer, not for this path). */
export async function createExpense(db: Db, input: CreateExpenseInput): Promise<string> {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const merchant = displayMerchant(input.merchant);

  await db.insert(schema.expenses).values({
    id,
    familyId: input.familyId,
    createdByUserId: input.createdByUserId,
    payerMemberId: input.payerMemberId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    spentOn: input.spentOn,
    spentTime: input.spentTime ?? null,
    categoryId: input.categoryId,
    subcategoryId: input.subcategoryId,
    merchant,
    merchantKey: merchantKey(merchant),
    paymentMethodId: input.paymentMethodId,
    notes: input.notes,
    visibility: input.visibility,
    status: "active",
    source: "manual",
    updatedAt: now,
  });

  return id;
}

// ── Update ───────────────────────────────────────────────────────────────────

export interface UpdateExpensePatch {
  amountMinor?: number;
  spentOn?: string;
  spentTime?: string | null;
  categoryId?: string;
  subcategoryId?: string | null;
  merchant?: string | null;
  paymentMethodId?: string | null;
  notes?: string | null;
  payerMemberId?: string | null;
  visibility?: "family" | "private";
}

export async function updateExpense(db: Db, id: string, patch: UpdateExpensePatch): Promise<void> {
  const set: Partial<typeof schema.expenses.$inferInsert> = {
    updatedAt: Math.floor(Date.now() / 1000),
  };

  if (patch.amountMinor !== undefined) set.amountMinor = patch.amountMinor;
  if (patch.spentOn !== undefined) set.spentOn = patch.spentOn;
  if (patch.spentTime !== undefined) set.spentTime = patch.spentTime;
  if (patch.categoryId !== undefined) set.categoryId = patch.categoryId;
  if (patch.subcategoryId !== undefined) set.subcategoryId = patch.subcategoryId;
  if (patch.merchant !== undefined) {
    const merchant = displayMerchant(patch.merchant);
    set.merchant = merchant;
    set.merchantKey = merchantKey(merchant);
  }
  if (patch.paymentMethodId !== undefined) set.paymentMethodId = patch.paymentMethodId;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.payerMemberId !== undefined) set.payerMemberId = patch.payerMemberId;
  if (patch.visibility !== undefined) set.visibility = patch.visibility;

  await db.update(schema.expenses).set(set).where(eq(schema.expenses.id, id));
}

// ── Enriched reads ───────────────────────────────────────────────────────────

const category = schema.expenseCategories;
const subcategory = alias(schema.expenseCategories, "subcategory");
const paymentMethod = schema.expensePaymentMethods;

/** Raw row lookup — used by route handlers for the ownership/visibility gate
 * before deciding whether to fetch (or return) the enriched view. */
export async function selectExpenseRow(db: Db, id: string) {
  return db.select().from(schema.expenses).where(eq(schema.expenses.id, id)).get();
}

const listSelection = {
  // The base expenses.* columns are included here too — "id"/"status" etc.
  // are just as ambiguous against the joined category/subcategory/payment-
  // method tables as those tables are against each other.
  id: col<string>(schema.expenses.id, "id"),
  familyId: col<string>(schema.expenses.familyId, "familyId"),
  createdByUserId: col<string>(schema.expenses.createdByUserId, "createdByUserId"),
  payerMemberId: col<string | null>(schema.expenses.payerMemberId, "payerMemberId"),
  amountMinor: col<number>(schema.expenses.amountMinor, "amountMinor"),
  currency: col<string>(schema.expenses.currency, "currency"),
  spentOn: col<string>(schema.expenses.spentOn, "spentOn"),
  spentTime: col<string | null>(schema.expenses.spentTime, "spentTime"),
  merchant: col<string | null>(schema.expenses.merchant, "merchant"),
  merchantKey: col<string | null>(schema.expenses.merchantKey, "merchantKey"),
  notes: col<string | null>(schema.expenses.notes, "notes"),
  visibility: col<"family" | "private">(schema.expenses.visibility, "visibility"),
  status: col<"active" | "trashed">(schema.expenses.status, "status"),
  source: col<string>(schema.expenses.source, "source"),
  createdAt: col<number>(schema.expenses.createdAt, "createdAt"),
  updatedAt: col<number>(schema.expenses.updatedAt, "updatedAt"),
  categoryId: col<string | null>(category.id, "categoryId"),
  categoryName: col<string | null>(category.name, "categoryName"),
  categorySlug: col<string | null>(category.slug, "categorySlug"),
  categoryEmoji: col<string | null>(category.emoji, "categoryEmoji"),
  categoryColor: col<string | null>(category.color, "categoryColor"),
  subcategoryId: col<string | null>(subcategory.id, "subcategoryId"),
  subcategoryName: col<string | null>(subcategory.name, "subcategoryName"),
  subcategorySlug: col<string | null>(subcategory.slug, "subcategorySlug"),
  subcategoryEmoji: col<string | null>(subcategory.emoji, "subcategoryEmoji"),
  paymentMethodId: col<string | null>(paymentMethod.id, "paymentMethodId"),
  paymentMethodName: col<string | null>(paymentMethod.name, "paymentMethodName"),
  paymentMethodEmoji: col<string | null>(paymentMethod.emoji, "paymentMethodEmoji"),
  paymentMethodKind: col<string | null>(paymentMethod.kind, "paymentMethodKind"),
} as const;

/** Single expense, joined with its category/subcategory/payment method AND
 * payer + creator display info — everything the detail screen needs in one
 * round trip. Returns undefined if the id doesn't exist; callers do the
 * visibility/authorization gate against `selectExpenseRow` first. */
export async function getExpenseDetail(db: Db, id: string) {
  const payer = alias(schema.familyMembers, "payer");
  const payerUser = alias(schema.users, "payer_user");
  const creator = alias(schema.users, "creator");

  return db
    .select({
      ...listSelection,
      payerDisplayName: col<string | null>(payer.displayName, "payerDisplayName"),
      payerMemberType: col<"user" | "dependent" | null>(payer.memberType, "payerMemberType"),
      payerName: col<string | null>(payerUser.name, "payerName"),
      creatorName: col<string | null>(creator.name, "creatorName"),
      creatorEmail: col<string | null>(creator.email, "creatorEmail"),
    })
    .from(schema.expenses)
    .leftJoin(category, eq(schema.expenses.categoryId, category.id))
    .leftJoin(subcategory, eq(schema.expenses.subcategoryId, subcategory.id))
    .leftJoin(paymentMethod, eq(schema.expenses.paymentMethodId, paymentMethod.id))
    .leftJoin(payer, eq(schema.expenses.payerMemberId, payer.id))
    .leftJoin(payerUser, eq(payer.userId, payerUser.id))
    .leftJoin(creator, eq(schema.expenses.createdByUserId, creator.id))
    .where(eq(schema.expenses.id, id))
    .get();
}

export type EnrichedExpenseDetail = Awaited<ReturnType<typeof getExpenseDetail>>;

// ── List (keyset paginated) ──────────────────────────────────────────────────

export const EXPENSE_PAGE_SIZE = 30;

export interface ListExpensesFilters {
  from?: string; // spentOn >= from
  to?: string; // spentOn <= to
  categoryId?: string;
  subcategoryId?: string;
  /** Raw merchant text — normalized to a merchantKey and matched exactly, the
   * same key merchant analytics will group by later. */
  merchant?: string;
  paymentMethodId?: string;
  payerMemberId?: string;
  minAmountMinor?: number;
  maxAmountMinor?: number;
  /** Free-text search over merchant + notes. */
  q?: string;
  /** Opaque keyset cursor from the previous page's nextCursor. */
  cursor?: string;
}

/** `${spentOn}:${rowid}` — the exact pair the list is ordered by, so a page
 * boundary can be resumed unambiguously even when many expenses share a date. */
export function encodeCursor(spentOn: string, rowid: number): string {
  return `${spentOn}:${rowid}`;
}

function decodeCursor(cursor: string): { spentOn: string; rowid: number } | null {
  const idx = cursor.lastIndexOf(":");
  if (idx === -1) return null;
  const spentOn = cursor.slice(0, idx);
  const rowid = Number(cursor.slice(idx + 1));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn) || !Number.isFinite(rowid)) return null;
  return { spentOn, rowid };
}

export async function listExpenses(
  db: Db,
  familyId: string,
  userId: string,
  filters: ListExpensesFilters,
) {
  // Bare (unaliased) for use in WHERE/ORDER BY — an aliased `SQL.Aliased`
  // (`.as(...)`) is only valid in a SELECT list, not a predicate.
  const rowidExpr = sql<number>`"expenses".rowid`;
  const conditions = [expenseScopeWhere(familyId, userId)];

  if (filters.from) conditions.push(gte(schema.expenses.spentOn, filters.from));
  if (filters.to) conditions.push(lte(schema.expenses.spentOn, filters.to));
  if (filters.categoryId) conditions.push(eq(schema.expenses.categoryId, filters.categoryId));
  if (filters.subcategoryId)
    conditions.push(eq(schema.expenses.subcategoryId, filters.subcategoryId));
  if (filters.paymentMethodId)
    conditions.push(eq(schema.expenses.paymentMethodId, filters.paymentMethodId));
  if (filters.payerMemberId)
    conditions.push(eq(schema.expenses.payerMemberId, filters.payerMemberId));
  if (filters.minAmountMinor !== undefined)
    conditions.push(gte(schema.expenses.amountMinor, filters.minAmountMinor));
  if (filters.maxAmountMinor !== undefined)
    conditions.push(lte(schema.expenses.amountMinor, filters.maxAmountMinor));

  if (filters.merchant) {
    const key = merchantKey(filters.merchant);
    // A merchant filter that normalizes to nothing (pure punctuation) can
    // never match anything real — short-circuit rather than scan for it.
    conditions.push(key ? eq(schema.expenses.merchantKey, key) : sql`0`);
  }

  if (filters.q !== undefined) {
    const sanitized = filters.q.replace(/[%_]/g, " ").trim();
    if (!sanitized) return { expenses: [], hasMore: false, nextCursor: null };
    const pattern = `%${sanitized}%`;
    conditions.push(or(like(schema.expenses.merchant, pattern), like(schema.expenses.notes, pattern)));
  }

  if (filters.cursor) {
    const decoded = decodeCursor(filters.cursor);
    if (decoded) {
      // Keyset predicate for a (spent_on DESC, rowid DESC) page boundary:
      // strictly-earlier date, OR same date with a strictly-smaller rowid.
      conditions.push(
        sql`(${schema.expenses.spentOn} < ${decoded.spentOn} OR (${schema.expenses.spentOn} = ${decoded.spentOn} AND ${rowidExpr} < ${decoded.rowid}))`,
      );
    }
  }

  const rows = await db
    .select({ ...listSelection, rowid: rowidExpr.as("rowid") })
    .from(schema.expenses)
    .leftJoin(category, eq(schema.expenses.categoryId, category.id))
    .leftJoin(subcategory, eq(schema.expenses.subcategoryId, subcategory.id))
    .leftJoin(paymentMethod, eq(schema.expenses.paymentMethodId, paymentMethod.id))
    .where(and(...(conditions as [(typeof conditions)[0], ...typeof conditions])))
    // spent_on DESC is the primary axis (transaction date, not entry order);
    // rowid DESC is the tiebreaker for same-day expenses, mirroring chat.ts's
    // created_at+rowid pattern so pages never skip or repeat a row.
    .orderBy(desc(schema.expenses.spentOn), desc(rowidExpr))
    .limit(EXPENSE_PAGE_SIZE + 1);

  const hasMore = rows.length > EXPENSE_PAGE_SIZE;
  const page = rows.slice(0, EXPENSE_PAGE_SIZE);
  const last = page[page.length - 1];

  return {
    expenses: page,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(last.spentOn, last.rowid) : null,
  };
}

// ── Suggestions (recent categories, frequent merchants) ────────────────────

const SUGGESTION_LIMIT = 8;

/**
 * "What did I use recently?" — deliberately simple (no ML): the categories
 * this user has actually used most recently in this family, most-recent
 * first. Scoped through expenseScopeWhere so suggestions never leak signal
 * from another member's private expenses.
 */
export async function recentCategories(db: Db, familyId: string, userId: string) {
  const lastUsedExpr = sql<number>`max(${schema.expenses.updatedAt})`;

  return db
    .select({
      categoryId: col<string>(category.id, "categoryId"),
      categoryName: col<string>(category.name, "categoryName"),
      categoryEmoji: col<string | null>(category.emoji, "categoryEmoji"),
      categoryColor: col<string | null>(category.color, "categoryColor"),
      subcategoryId: col<string | null>(subcategory.id, "subcategoryId"),
      subcategoryName: col<string | null>(subcategory.name, "subcategoryName"),
      subcategoryEmoji: col<string | null>(subcategory.emoji, "subcategoryEmoji"),
      lastUsedAt: lastUsedExpr.as("lastUsedAt"),
    })
    .from(schema.expenses)
    .innerJoin(category, eq(schema.expenses.categoryId, category.id))
    .leftJoin(subcategory, eq(schema.expenses.subcategoryId, subcategory.id))
    .where(and(expenseScopeWhere(familyId, userId), eq(category.status, "active")))
    .groupBy(schema.expenses.categoryId, schema.expenses.subcategoryId)
    .orderBy(desc(lastUsedExpr))
    .limit(SUGGESTION_LIMIT);
}

/** Merchants this user pays most often, most-frequent first. */
export async function frequentMerchants(db: Db, familyId: string, userId: string) {
  const usesExpr = sql<number>`count(*)`;
  const lastUsedExpr = sql<number>`max(${schema.expenses.updatedAt})`;

  return db
    .select({
      merchant: col<string | null>(schema.expenses.merchant, "merchant"),
      merchantKey: col<string | null>(schema.expenses.merchantKey, "merchantKey"),
      uses: usesExpr.as("uses"),
      lastUsedAt: lastUsedExpr.as("lastUsedAt"),
    })
    .from(schema.expenses)
    .where(and(expenseScopeWhere(familyId, userId), sql`${schema.expenses.merchantKey} is not null`))
    .groupBy(schema.expenses.merchantKey)
    .orderBy(desc(usesExpr), desc(lastUsedExpr))
    .limit(SUGGESTION_LIMIT);
}

// ── Dashboard summary (single aggregate, not analytics) ─────────────────────

/**
 * Total spend for a date range, grouped by currency — the ONE aggregate
 * Phase C needs for the Dashboard's "this month" stat tile. Deliberately not
 * a breakdown by category/merchant/time (that's Phase F's analytics service);
 * this is one SUM(), currency-grouped so it can never silently combine ₹ and $.
 */
export async function getExpenseSummary(
  db: Db,
  familyId: string,
  userId: string,
  range: { from: string; to: string },
) {
  return db
    .select({
      currency: col<string>(schema.expenses.currency, "currency"),
      totalMinor: sql<number>`sum(${schema.expenses.amountMinor})`.as("totalMinor"),
      count: sql<number>`count(*)`.as("count"),
    })
    .from(schema.expenses)
    .where(
      and(
        expenseScopeWhere(familyId, userId),
        gte(schema.expenses.spentOn, range.from),
        lte(schema.expenses.spentOn, range.to),
      ),
    )
    .groupBy(schema.expenses.currency);
}
