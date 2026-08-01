/**
 * Expenses — the core CRUD surface. Follows worker/routes/tasks.ts exactly:
 * requireSession → requireFamilyMember → Zod → family-scoped FK guards →
 * Drizzle → the house error shape. Business logic (reference validation,
 * inserts, the keyset-paginated list, suggestions) lives in
 * worker/lib/expenses/queries.ts so Phase F's analytics can reuse it.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { isExpenseHiddenFrom } from "../lib/expenses/visibility";
import {
  createExpense,
  getExpenseDetail,
  getExpenseSummary,
  frequentMerchants,
  listExpenses,
  parseAmountMinor,
  recentCategories,
  resolveDefaultCurrency,
  selectExpenseRow,
  todayIsoUtc,
  updateExpense,
  validateExpenseReferences,
} from "../lib/expenses/queries";
import { isSupportedCurrency, SUPPORTED_CURRENCY_CODES } from "../../shared/money";

export const expenseRoutes = new Hono<HonoEnv>();

// ── Validation schemas ────────────────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-mm-dd");
const isoTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:MM");
// The client sends the decimal amount it captured from the user ("450",
// "450.50", 1.005) — never a pre-computed minor-unit integer. See
// lib/expenses/queries.ts#parseAmountMinor for why.
const amountInput = z.union([z.string().min(1).max(20), z.number()]);
const currencyCode = z.string().refine(isSupportedCurrency, {
  message: `Must be one of: ${SUPPORTED_CURRENCY_CODES.join(", ")}`,
});

const createExpenseSchema = z.object({
  familyId: z.string().min(1),
  amount: amountInput,
  currency: currencyCode.optional(),
  spentOn: isoDate.optional(),
  spentTime: isoTime.optional(),
  categoryId: z.string().min(1),
  subcategoryId: z.string().min(1).optional(),
  merchant: z.string().max(200).optional(),
  paymentMethodId: z.string().min(1).optional(),
  notes: z.string().max(2000).optional(),
  payerMemberId: z.string().min(1).optional(),
  visibility: z.enum(["family", "private"]).optional(),
});

// currency is intentionally NOT editable after creation — the same
// amount_minor value means something different under a different currency's
// decimal exponent, and V1 does no conversion. Change the currency by
// deleting and re-entering the expense.
const updateExpenseSchema = z.object({
  amount: amountInput.optional(),
  spentOn: isoDate.optional(),
  spentTime: isoTime.nullable().optional(),
  categoryId: z.string().min(1).optional(),
  subcategoryId: z.string().min(1).nullable().optional(),
  merchant: z.string().max(200).nullable().optional(),
  paymentMethodId: z.string().min(1).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  payerMemberId: z.string().min(1).nullable().optional(),
  visibility: z.enum(["family", "private"]).optional(),
});

const listQuerySchema = z.object({
  familyId: z.string().min(1),
  from: isoDate.optional(),
  to: isoDate.optional(),
  categoryId: z.string().optional(),
  subcategoryId: z.string().optional(),
  merchant: z.string().optional(),
  paymentMethodId: z.string().optional(),
  memberId: z.string().optional(),
  minAmount: amountInput.optional(),
  maxAmount: amountInput.optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

/** Same behaviour as `zv` but for a GET's query string, so filter typos get
 * the identical `validation_error` shape mutations already return. */
function zvQuery<T extends z.ZodType>(s: T) {
  return zValidator("query", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /expenses — keyset-paginated, filtered list. See listExpenses() for the
// full filter set and the cursor design.
expenseRoutes.get("/", requireSession, zvQuery(listQuerySchema), async (c) => {
  const userId = c.get("userId")!;
  const query = c.req.valid("query");

  const membership = await requireFamilyMember(c, query.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);

  // Amount-range filters arrive as decimals ("50", "1000.50") just like the
  // create amount — resolved against the family's default currency so a
  // filter of "over ₹1000" behaves the way the family actually enters money.
  let minAmountMinor: number | undefined;
  let maxAmountMinor: number | undefined;
  if (query.minAmount !== undefined || query.maxAmount !== undefined) {
    const currency = await resolveDefaultCurrency(db, query.familyId);
    if (query.minAmount !== undefined) {
      const parsed = parseAmountMinor(query.minAmount, currency);
      if (parsed === null) return c.json({ error: "invalid_amount" }, 400);
      minAmountMinor = parsed;
    }
    if (query.maxAmount !== undefined) {
      const parsed = parseAmountMinor(query.maxAmount, currency);
      if (parsed === null) return c.json({ error: "invalid_amount" }, 400);
      maxAmountMinor = parsed;
    }
  }

  const result = await listExpenses(db, query.familyId, userId, {
    from: query.from,
    to: query.to,
    categoryId: query.categoryId,
    subcategoryId: query.subcategoryId,
    merchant: query.merchant,
    paymentMethodId: query.paymentMethodId,
    payerMemberId: query.memberId,
    minAmountMinor,
    maxAmountMinor,
    q: query.q,
    cursor: query.cursor,
  });

  return c.json(result);
});

// GET /expenses/suggestions?familyId= — recent categories + frequent
// merchants for the Add-Expense sheet. MUST be registered before /:id.
expenseRoutes.get("/suggestions", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const [categories, merchants] = await Promise.all([
    recentCategories(db, familyId, userId),
    frequentMerchants(db, familyId, userId),
  ]);

  return c.json({ recentCategories: categories, frequentMerchants: merchants });
});

// GET /expenses/summary?familyId=&from=&to= — a single SUM(), grouped by
// currency, for the Dashboard's "this month" stat tile. Not analytics (no
// breakdown, no trend) — see queries.ts#getExpenseSummary for the boundary.
expenseRoutes.get("/summary", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const familyId = c.req.query("familyId");
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return c.json({ error: "from and to query params (yyyy-mm-dd) required" }, 400);
  }

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const byCurrency = await getExpenseSummary(db, familyId, userId, { from, to });

  return c.json({
    byCurrency,
    mixed: byCurrency.length > 1,
    singleCurrency: byCurrency.length === 1 ? byCurrency[0] : null,
  });
});

// POST /expenses — create. Required: amount, category, date (defaulted).
// Everything else is optional so fast entry never needs more than that.
expenseRoutes.post("/", requireSession, zv(createExpenseSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const currency = data.currency ?? (await resolveDefaultCurrency(db, data.familyId));

  const amountMinor = parseAmountMinor(data.amount, currency);
  if (amountMinor === null) return c.json({ error: "invalid_amount" }, 400);

  const refCheck = await validateExpenseReferences(db, data.familyId, {
    categoryId: data.categoryId,
    subcategoryId: data.subcategoryId ?? null,
    paymentMethodId: data.paymentMethodId ?? null,
    payerMemberId: data.payerMemberId ?? null,
  });
  if (!refCheck.ok) return c.json({ error: refCheck.error }, 400);

  const id = await createExpense(db, {
    familyId: data.familyId,
    createdByUserId: userId,
    // Defaults to the acting member's own row — "who recorded it" is usually
    // also "who paid", and this is the one case the family model can default
    // cheaply; anything else the user picks explicitly.
    payerMemberId: data.payerMemberId ?? membership.id,
    amountMinor,
    currency,
    spentOn: data.spentOn ?? todayIsoUtc(),
    spentTime: data.spentTime,
    categoryId: data.categoryId,
    subcategoryId: data.subcategoryId ?? null,
    merchant: data.merchant ?? null,
    paymentMethodId: data.paymentMethodId ?? null,
    notes: data.notes ?? null,
    visibility: data.visibility ?? "family",
  });

  const expense = await getExpenseDetail(db, id);
  return c.json({ expense }, 201);
});

// GET /expenses/:id
expenseRoutes.get("/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const row = await selectExpenseRow(db, id);
  if (!row) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, row.familyId);
  if (membership instanceof Response) return membership;

  // A private expense someone else created must 404, not 403 — don't reveal
  // that it exists (matches documents.ts's isDocHiddenFrom treatment).
  if (isExpenseHiddenFrom(row, userId)) return c.json({ error: "not_found" }, 404);

  const expense = await getExpenseDetail(db, id);
  return c.json({ expense });
});

// PATCH /expenses/:id — same validation rules as create. Only re-validates a
// reference that is actually changing (see queries.ts) and auto-clears a
// subcategory left over from a previous category rather than ever storing an
// inconsistent pair.
expenseRoutes.patch("/:id", requireSession, zv(updateExpenseSchema), async (c) => {
  const { id } = c.req.param();
  const userId = c.get("userId")!;
  const data = c.req.valid("json");
  const db = getDb(c.env);

  const existing = await selectExpenseRow(db, id);
  if (!existing || existing.status === "trashed") return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, existing.familyId);
  if (membership instanceof Response) return membership;

  if (isExpenseHiddenFrom(existing, userId)) return c.json({ error: "not_found" }, 404);

  const canEdit =
    existing.createdByUserId === userId ||
    membership.role === "admin" ||
    membership.role === "owner";
  if (!canEdit) return c.json({ error: "forbidden" }, 403);

  const categoryChanging = data.categoryId !== undefined && data.categoryId !== existing.categoryId;
  const categoryId = data.categoryId ?? existing.categoryId;

  // A subcategory left over from the OLD category is never kept: if the
  // client didn't explicitly choose a new one, it's cleared rather than
  // silently retained (Phase C spec §27). A subcategory the client DID
  // explicitly send is validated normally — a mismatch there is a client bug,
  // not a stale carry-over, and should error.
  let subcategoryId: string | null;
  if ("subcategoryId" in data) {
    subcategoryId = data.subcategoryId ?? null;
  } else if (categoryChanging) {
    subcategoryId = null;
  } else {
    subcategoryId = existing.subcategoryId;
  }
  const subcategoryChanging = subcategoryId !== existing.subcategoryId;

  const paymentMethodProvided = "paymentMethodId" in data;
  const paymentMethodId = paymentMethodProvided ? (data.paymentMethodId ?? null) : existing.paymentMethodId;
  const paymentMethodChanging = paymentMethodId !== existing.paymentMethodId;

  const payerProvided = "payerMemberId" in data;
  const payerMemberId = payerProvided ? (data.payerMemberId ?? null) : existing.payerMemberId;
  const payerChanging = payerMemberId !== existing.payerMemberId;

  if (categoryChanging || subcategoryChanging || paymentMethodChanging || payerChanging) {
    const refCheck = await validateExpenseReferences(
      db,
      existing.familyId,
      { categoryId, subcategoryId, paymentMethodId, payerMemberId },
      {
        category: categoryChanging,
        subcategory: subcategoryChanging,
        paymentMethod: paymentMethodChanging,
        payer: payerChanging,
      },
    );
    if (!refCheck.ok) return c.json({ error: refCheck.error }, 400);
  }

  let amountMinor: number | undefined;
  if (data.amount !== undefined) {
    // Currency is immutable — reuse the row's own currency's decimal exponent.
    const parsed = parseAmountMinor(data.amount, existing.currency);
    if (parsed === null) return c.json({ error: "invalid_amount" }, 400);
    amountMinor = parsed;
  }

  await updateExpense(db, id, {
    amountMinor,
    spentOn: data.spentOn,
    spentTime: "spentTime" in data ? data.spentTime : undefined,
    categoryId: categoryChanging ? categoryId : undefined,
    subcategoryId: subcategoryChanging ? subcategoryId : undefined,
    merchant: "merchant" in data ? data.merchant : undefined,
    paymentMethodId: paymentMethodChanging ? paymentMethodId : undefined,
    notes: "notes" in data ? data.notes : undefined,
    payerMemberId: payerChanging ? payerMemberId : undefined,
    visibility: data.visibility,
  });

  const expense = await getExpenseDetail(db, id);
  return c.json({ expense });
});

// DELETE /expenses/:id — soft delete (status = 'trashed'), same pattern as
// documents.ts. An already-trashed expense 404s (the lookup excludes trashed
// rows, matching documents.ts exactly), so a second DELETE is a clean 404,
// not a special "already deleted" branch.
expenseRoutes.delete("/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const existing = await selectExpenseRow(db, id);
  if (!existing || existing.status === "trashed") return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, existing.familyId);
  if (membership instanceof Response) return membership;

  if (isExpenseHiddenFrom(existing, userId)) return c.json({ error: "not_found" }, 404);

  const canEdit =
    existing.createdByUserId === userId ||
    membership.role === "admin" ||
    membership.role === "owner";
  if (!canEdit) return c.json({ error: "forbidden" }, 403);

  await db
    .update(schema.expenses)
    .set({ status: "trashed", trashedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.expenses.id, id));

  return c.json({ ok: true });
});

// POST /expenses/:id/restore — undo a delete. Requires the row to actually be
// trashed; restoring an already-active expense is a 400, not a silent no-op,
// since that usually means the client's state is stale.
expenseRoutes.post("/:id/restore", requireSession, async (c) => {
  const { id } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const existing = await selectExpenseRow(db, id);
  if (!existing) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, existing.familyId);
  if (membership instanceof Response) return membership;

  if (isExpenseHiddenFrom(existing, userId)) return c.json({ error: "not_found" }, 404);

  const canEdit =
    existing.createdByUserId === userId ||
    membership.role === "admin" ||
    membership.role === "owner";
  if (!canEdit) return c.json({ error: "forbidden" }, 403);

  if (existing.status !== "trashed") return c.json({ error: "not_trashed" }, 400);

  await db
    .update(schema.expenses)
    .set({ status: "active", trashedAt: null, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.expenses.id, id));

  const expense = await getExpenseDetail(db, id);
  return c.json({ expense });
});
