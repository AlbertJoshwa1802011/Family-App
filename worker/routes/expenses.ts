/**
 * Personal expenses + categories.
 *
 * Invariants:
 *   - splitType is always "none" (shared splits are a later phase)
 *   - private expenses return 404 (never 403) for anyone but their creator —
 *     owners and admins get NO bypass, see lib/expenses/visibility.ts
 *   - only the creator may edit or trash an expense
 *   - currency must equal families.defaultCurrency
 *   - paidByMemberId must pass resolveFinancialActors
 *   - clientRequestId create is idempotent (conflict → existing row, no side effects)
 *   - every mutation writes an audit_log row
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema, type Db } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { checkRateLimit } from "../lib/rateLimit";
import { insertAuditEvent } from "../lib/audit";
import { MAX_AMOUNT_MINOR } from "../lib/money";
import {
  memberInFamily,
  resolveFinancialActors,
} from "../lib/expenses/financialActors";
import { ensureBuiltinCategories } from "../lib/expenses/builtinCategories";
import {
  expenseSearchWhere,
  expenseVisibilityWhere,
  isExpenseHiddenFrom,
} from "../lib/expenses/visibility";

export const expenseRoutes = new Hono<HonoEnv>();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-mm-dd");
const currencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, "Must be an ISO 4217 currency code");

function zv<T extends z.ZodType>(schema_: T) {
  return zValidator("json", schema_, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "validation_error", issues: result.error.issues },
        400,
      );
    }
  });
}

const createExpenseSchema = z.object({
  familyId: z.string().min(1),
  paidByMemberId: z.string().min(1),
  categoryId: z.string().min(1).optional().nullable(),
  subjectMemberId: z.string().min(1).optional().nullable(),
  amountMinor: z.number().int().positive().lt(MAX_AMOUNT_MINOR),
  currency: currencyCode,
  expenseDate: isoDate,
  merchant: z.string().max(200).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  paymentMethod: z.string().max(100).optional().nullable(),
  splitType: z.literal("none").default("none"),
  visibility: z.enum(["family", "private"]).optional().default("private"),
  clientRequestId: z.string().uuid().optional(),
  participants: z.array(z.unknown()).max(0).optional(),
});

const updateExpenseSchema = z.object({
  paidByMemberId: z.string().min(1).optional(),
  categoryId: z.string().min(1).nullable().optional(),
  subjectMemberId: z.string().min(1).nullable().optional(),
  amountMinor: z.number().int().positive().lt(MAX_AMOUNT_MINOR).optional(),
  currency: currencyCode.optional(),
  expenseDate: isoDate.optional(),
  merchant: z.string().max(200).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  paymentMethod: z.string().max(100).nullable().optional(),
  visibility: z.enum(["family", "private"]).optional(),
  splitType: z.literal("none").optional(),
  participants: z.array(z.unknown()).max(0).optional(),
});

const createCategorySchema = z.object({
  familyId: z.string().min(1),
  name: z.string().min(1).max(80),
  icon: z.string().max(40).optional().nullable(),
  color: z.string().max(20).optional().nullable(),
});

type ExpenseRow = typeof schema.expenses.$inferSelect;

async function loadExpense(db: Db, id: string) {
  return db.select().from(schema.expenses).where(eq(schema.expenses.id, id)).get();
}

// Only the person who recorded an expense may change it. A family role does not
// grant edit rights over someone else's books.
function canEditPersonal(expense: ExpenseRow, userId: string) {
  return expense.createdByUserId === userId;
}

function canTrashExpense(expense: ExpenseRow, userId: string) {
  return expense.createdByUserId === userId;
}

async function assertUsableCategory(
  db: Db,
  familyId: string,
  categoryId: string,
): Promise<Response | null> {
  const cat = await db
    .select()
    .from(schema.expenseCategories)
    .where(eq(schema.expenseCategories.id, categoryId))
    .get();
  if (!cat) return Response.json({ error: "not_found" }, { status: 404 });
  if (cat.familyId !== null && cat.familyId !== familyId) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (cat.archived) {
    return Response.json(
      {
        error: "validation_error",
        issues: [
          { code: "custom", path: ["categoryId"], message: "category is archived" },
        ],
      },
      { status: 400 },
    );
  }
  return null;
}

async function serializeExpense(db: Db, expense: ExpenseRow) {
  let category: {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
  } | null = null;
  if (expense.categoryId) {
    category =
      (await db
        .select({
          id: schema.expenseCategories.id,
          name: schema.expenseCategories.name,
          icon: schema.expenseCategories.icon,
          color: schema.expenseCategories.color,
        })
        .from(schema.expenseCategories)
        .where(eq(schema.expenseCategories.id, expense.categoryId))
        .get()) ?? null;
  }
  return {
    ...expense,
    participants: [] as [],
    category,
    scope: (expense.splitType === "none" ? "personal" : "shared") as
      | "personal"
      | "shared",
  };
}

function financialActorError(
  result: Extract<
    Awaited<ReturnType<typeof resolveFinancialActors>>,
    { ok: false }
  >,
) {
  const error =
    result.error === "not_financial_actor"
      ? "not_financial_actor"
      : "invalid_member_ids";
  return Response.json({ error, memberId: result.memberId }, { status: 400 });
}

// ── Categories ──────────────────────────────────────────────────────────────

expenseRoutes.get("/categories", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  await ensureBuiltinCategories(db);

  const includeArchived = c.req.query("includeArchived") === "1";
  const rows = await db
    .select()
    .from(schema.expenseCategories)
    .where(
      and(
        or(
          isNull(schema.expenseCategories.familyId),
          eq(schema.expenseCategories.familyId, familyId),
        ),
        includeArchived ? undefined : eq(schema.expenseCategories.archived, false),
      ),
    )
    .orderBy(schema.expenseCategories.name);

  return c.json({
    categories: rows.map((r) => ({ ...r, builtin: r.familyId === null })),
  });
});

expenseRoutes.post("/categories", requireSession, zv(createCategorySchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId, "admin");
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  await ensureBuiltinCategories(db);

  const id = crypto.randomUUID();
  try {
    await db.insert(schema.expenseCategories).values({
      id,
      familyId: data.familyId,
      name: data.name.trim(),
      icon: data.icon ?? null,
      color: data.color ?? null,
      archived: false,
    });
  } catch {
    return c.json(
      {
        error: "validation_error",
        issues: [
          {
            code: "custom",
            path: ["name"],
            message: "a category with this name already exists",
          },
        ],
      },
      400,
    );
  }

  await insertAuditEvent(db, {
    familyId: data.familyId,
    actorUserId: userId,
    action: "expense_category_created",
    targetType: "expense_category",
    targetId: id,
    meta: { name: data.name.trim() },
  });

  const category = await db
    .select()
    .from(schema.expenseCategories)
    .where(eq(schema.expenseCategories.id, id))
    .get();
  return c.json({ category: { ...category!, builtin: false } }, 201);
});

expenseRoutes.post("/categories/:id/archive", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const { id } = c.req.param();
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId, "admin");
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const cat = await db
    .select()
    .from(schema.expenseCategories)
    .where(eq(schema.expenseCategories.id, id))
    .get();
  if (!cat || cat.familyId !== familyId) {
    return c.json({ error: "not_found" }, 404);
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(schema.expenseCategories)
    .set({ archived: true, archivedAt: now })
    .where(eq(schema.expenseCategories.id, id));

  await insertAuditEvent(db, {
    familyId,
    actorUserId: userId,
    action: "expense_category_archived",
    targetType: "expense_category",
    targetId: id,
    meta: { name: cat.name },
  });

  return c.json({ ok: true });
});

// ── Expenses ────────────────────────────────────────────────────────────────

expenseRoutes.get("/", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  let where = expenseVisibilityWhere(familyId, userId);

  const from = c.req.query("from");
  const to = c.req.query("to");
  const categoryId = c.req.query("categoryId");
  const paidBy = c.req.query("paidBy");
  const scope = c.req.query("scope");
  const q = c.req.query("q")?.trim();

  if (from) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return c.json(
        {
          error: "validation_error",
          issues: [{ path: ["from"], message: "Must be yyyy-mm-dd" }],
        },
        400,
      );
    }
    where = and(where, gte(schema.expenses.expenseDate, from));
  }
  if (to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return c.json(
        {
          error: "validation_error",
          issues: [{ path: ["to"], message: "Must be yyyy-mm-dd" }],
        },
        400,
      );
    }
    where = and(where, lte(schema.expenses.expenseDate, to));
  }
  if (categoryId) where = and(where, eq(schema.expenses.categoryId, categoryId));
  if (paidBy) where = and(where, eq(schema.expenses.paidByMemberId, paidBy));
  if (scope === "personal") {
    where = and(where, eq(schema.expenses.splitType, "none"));
  } else if (scope === "shared") {
    where = and(where, sql`${schema.expenses.splitType} != 'none'`);
  }
  if (q) {
    const search = expenseSearchWhere(q);
    if (!search) return c.json({ expenses: [], totalMinor: 0 });
    where = and(where, search);
  }

  const rows = await db
    .select()
    .from(schema.expenses)
    .where(where)
    .orderBy(desc(schema.expenses.expenseDate), desc(sql`expenses.rowid`));

  const expenses = await Promise.all(rows.map((r) => serializeExpense(db, r)));
  const totalMinor = rows.reduce((sum, r) => sum + r.amountMinor, 0);
  return c.json({ expenses, totalMinor });
});

expenseRoutes.post("/", requireSession, zv(createExpenseSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const limited = await checkRateLimit(c, `expense-create:${userId}`, {
    limit: 60,
    windowSecs: 60,
  });
  if (limited) return limited;

  const db = getDb(c.env);

  const family = await db
    .select({
      id: schema.families.id,
      defaultCurrency: schema.families.defaultCurrency,
    })
    .from(schema.families)
    .where(eq(schema.families.id, data.familyId))
    .get();
  if (!family) return c.json({ error: "not_found" }, 404);

  if (data.currency !== family.defaultCurrency) {
    return c.json(
      {
        error: "validation_error",
        issues: [
          {
            code: "custom",
            path: ["currency"],
            message: `currency must match family default (${family.defaultCurrency})`,
          },
        ],
      },
      400,
    );
  }

  const payer = await resolveFinancialActors(db, data.familyId, [
    data.paidByMemberId,
  ]);
  if (!payer.ok) return financialActorError(payer);

  if (
    data.subjectMemberId &&
    !(await memberInFamily(db, data.familyId, data.subjectMemberId))
  ) {
    return c.json({ error: "invalid_member_ids" }, 400);
  }

  if (data.categoryId) {
    const catErr = await assertUsableCategory(db, data.familyId, data.categoryId);
    if (catErr) return catErr;
  }

  const expenseId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const insertResult = await db
    .insert(schema.expenses)
    .values({
      id: expenseId,
      familyId: data.familyId,
      paidByMemberId: data.paidByMemberId,
      subjectMemberId: data.subjectMemberId ?? null,
      categoryId: data.categoryId ?? null,
      amountMinor: data.amountMinor,
      currency: data.currency,
      expenseDate: data.expenseDate,
      merchant: data.merchant ?? null,
      description: data.description ?? null,
      paymentMethod: data.paymentMethod ?? null,
      splitType: "none",
      visibility: data.visibility ?? "private",
      status: "active",
      createdByUserId: userId,
      clientRequestId: data.clientRequestId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  if ((insertResult.meta?.changes ?? 0) === 0 && data.clientRequestId) {
    const existing = await db
      .select()
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.familyId, data.familyId),
          eq(schema.expenses.createdByUserId, userId),
          eq(schema.expenses.clientRequestId, data.clientRequestId),
        ),
      )
      .get();
    if (existing) {
      return c.json({ expense: await serializeExpense(db, existing) }, 200);
    }
    return c.json({ error: "conflict" }, 409);
  }

  await insertAuditEvent(db, {
    familyId: data.familyId,
    actorUserId: userId,
    action: "expense_created",
    targetType: "expense",
    targetId: expenseId,
    meta: {
      amountMinor: data.amountMinor,
      currency: data.currency,
      splitType: "none",
      visibility: data.visibility ?? "private",
    },
  });

  const expense = await loadExpense(db, expenseId);
  return c.json({ expense: await serializeExpense(db, expense!) }, 201);
});

// ── Summary ─────────────────────────────────────────────────────────────────
// Registered before "/:id" so the literal path wins the match.

expenseRoutes.get("/summary", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const familyId = c.req.query("familyId");
  if (!familyId) {
    return c.json(
      {
        error: "validation_error",
        issues: [{ path: ["familyId"], message: "familyId is required" }],
      },
      400,
    );
  }

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const from = c.req.query("from");
  const to = c.req.query("to");
  for (const [name, value] of [["from", from], ["to", to]] as const) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return c.json(
        {
          error: "validation_error",
          issues: [{ path: [name], message: "Must be yyyy-mm-dd" }],
        },
        400,
      );
    }
  }

  // "mine" (the default) reports only what this user recorded — the private
  // books. "family" widens to everything they're allowed to see, which is
  // their own rows plus expenses others explicitly shared.
  const view = c.req.query("view") === "family" ? "family" : "mine";

  const db = getDb(c.env);

  let where = expenseVisibilityWhere(familyId, userId);
  if (view === "mine") {
    where = and(where, eq(schema.expenses.createdByUserId, userId));
  }
  if (from) where = and(where, gte(schema.expenses.expenseDate, from));
  if (to) where = and(where, lte(schema.expenses.expenseDate, to));

  const family = await db
    .select({ defaultCurrency: schema.families.defaultCurrency })
    .from(schema.families)
    .where(eq(schema.families.id, familyId))
    .get();

  const rows = await db
    .select({
      amountMinor: schema.expenses.amountMinor,
      expenseDate: schema.expenses.expenseDate,
      categoryId: schema.expenses.categoryId,
      visibility: schema.expenses.visibility,
    })
    .from(schema.expenses)
    .where(where);

  // Aggregate in the Worker rather than SQL: the row counts here are per-family
  // per-period (hundreds, not millions), and this keeps one code path for the
  // category/month/visibility rollups instead of three GROUP BY round-trips.
  let totalMinor = 0;
  const byCategoryMap = new Map<string, { categoryId: string | null; totalMinor: number; count: number }>();
  const byMonthMap = new Map<string, number>();
  let privateMinor = 0;
  let sharedMinor = 0;

  for (const r of rows) {
    totalMinor += r.amountMinor;

    const key = r.categoryId ?? "__uncategorized__";
    const cat = byCategoryMap.get(key) ?? {
      categoryId: r.categoryId ?? null,
      totalMinor: 0,
      count: 0,
    };
    cat.totalMinor += r.amountMinor;
    cat.count += 1;
    byCategoryMap.set(key, cat);

    const month = r.expenseDate.slice(0, 7); // yyyy-mm
    byMonthMap.set(month, (byMonthMap.get(month) ?? 0) + r.amountMinor);

    if (r.visibility === "private") privateMinor += r.amountMinor;
    else sharedMinor += r.amountMinor;
  }

  // Resolve category labels for the ids we actually saw.
  const catIds = [...byCategoryMap.values()]
    .map((v) => v.categoryId)
    .filter((v): v is string => v !== null);
  const catRows = catIds.length
    ? await db
        .select({
          id: schema.expenseCategories.id,
          name: schema.expenseCategories.name,
          icon: schema.expenseCategories.icon,
          color: schema.expenseCategories.color,
        })
        .from(schema.expenseCategories)
        .where(inArray(schema.expenseCategories.id, catIds))
    : [];
  const catById = new Map(catRows.map((r) => [r.id, r]));

  const byCategory = [...byCategoryMap.values()]
    .map((v) => {
      const meta = v.categoryId ? catById.get(v.categoryId) : undefined;
      return {
        categoryId: v.categoryId,
        name: meta?.name ?? "Uncategorized",
        icon: meta?.icon ?? null,
        color: meta?.color ?? null,
        totalMinor: v.totalMinor,
        count: v.count,
      };
    })
    .sort((a, b) => b.totalMinor - a.totalMinor);

  const byMonth = [...byMonthMap.entries()]
    .map(([month, minor]) => ({ month, totalMinor: minor }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  return c.json({
    view,
    currency: family?.defaultCurrency ?? "USD",
    totalMinor,
    count: rows.length,
    privateMinor,
    sharedMinor,
    byCategory,
    byMonth,
  });
});

expenseRoutes.get("/:id", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const { id } = c.req.param();
  const db = getDb(c.env);

  const expense = await loadExpense(db, id);
  if (!expense || expense.status === "trashed") {
    return c.json({ error: "not_found" }, 404);
  }

  const membership = await requireFamilyMember(c, expense.familyId);
  if (membership instanceof Response) return membership;

  if (isExpenseHiddenFrom(expense, userId)) {
    return c.json({ error: "not_found" }, 404);
  }

  return c.json({ expense: await serializeExpense(db, expense) });
});

expenseRoutes.patch("/:id", requireSession, zv(updateExpenseSchema), async (c) => {
  const userId = c.get("userId")!;
  const { id } = c.req.param();
  const updates = c.req.valid("json");
  const db = getDb(c.env);

  const expense = await loadExpense(db, id);
  if (!expense || expense.status === "trashed") {
    return c.json({ error: "not_found" }, 404);
  }

  const membership = await requireFamilyMember(c, expense.familyId);
  if (membership instanceof Response) return membership;

  if (isExpenseHiddenFrom(expense, userId)) {
    return c.json({ error: "not_found" }, 404);
  }

  if (expense.splitType !== "none") {
    return c.json({ error: "not_implemented", phase: "E2" }, 501);
  }

  if (!canEditPersonal(expense, userId)) {
    return c.json({ error: "forbidden" }, 403);
  }

  const family = await db
    .select({ defaultCurrency: schema.families.defaultCurrency })
    .from(schema.families)
    .where(eq(schema.families.id, expense.familyId))
    .get();

  if (
    updates.currency !== undefined &&
    updates.currency !== family?.defaultCurrency
  ) {
    return c.json(
      {
        error: "validation_error",
        issues: [
          {
            code: "custom",
            path: ["currency"],
            message: `currency must match family default (${family?.defaultCurrency})`,
          },
        ],
      },
      400,
    );
  }

  if (updates.paidByMemberId) {
    const payer = await resolveFinancialActors(db, expense.familyId, [
      updates.paidByMemberId,
    ]);
    if (!payer.ok) return financialActorError(payer);
  }

  if (
    updates.subjectMemberId &&
    !(await memberInFamily(db, expense.familyId, updates.subjectMemberId))
  ) {
    return c.json({ error: "invalid_member_ids" }, 400);
  }

  if (updates.categoryId) {
    const catErr = await assertUsableCategory(
      db,
      expense.familyId,
      updates.categoryId,
    );
    if (catErr) return catErr;
  }

  const now = Math.floor(Date.now() / 1000);
  const set: Partial<typeof schema.expenses.$inferInsert> = { updatedAt: now };

  if (updates.paidByMemberId !== undefined) set.paidByMemberId = updates.paidByMemberId;
  if (updates.categoryId !== undefined) set.categoryId = updates.categoryId;
  if (updates.subjectMemberId !== undefined) set.subjectMemberId = updates.subjectMemberId;
  if (updates.amountMinor !== undefined) set.amountMinor = updates.amountMinor;
  if (updates.currency !== undefined) set.currency = updates.currency;
  if (updates.expenseDate !== undefined) set.expenseDate = updates.expenseDate;
  if (updates.merchant !== undefined) set.merchant = updates.merchant;
  if (updates.description !== undefined) set.description = updates.description;
  if (updates.paymentMethod !== undefined) set.paymentMethod = updates.paymentMethod;
  if (updates.visibility !== undefined) set.visibility = updates.visibility;

  await db.update(schema.expenses).set(set).where(eq(schema.expenses.id, id));

  await insertAuditEvent(db, {
    familyId: expense.familyId,
    actorUserId: userId,
    action: "expense_updated",
    targetType: "expense",
    targetId: id,
    meta: {
      before: {
        amountMinor: expense.amountMinor,
        paidByMemberId: expense.paidByMemberId,
        visibility: expense.visibility,
        categoryId: expense.categoryId,
      },
      after: set,
    },
  });

  const updated = await loadExpense(db, id);
  return c.json({ expense: await serializeExpense(db, updated!) });
});

expenseRoutes.delete("/:id", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const { id } = c.req.param();
  const db = getDb(c.env);

  const expense = await loadExpense(db, id);
  if (!expense || expense.status === "trashed") {
    return c.json({ error: "not_found" }, 404);
  }

  const membership = await requireFamilyMember(c, expense.familyId);
  if (membership instanceof Response) return membership;

  if (isExpenseHiddenFrom(expense, userId)) {
    return c.json({ error: "not_found" }, 404);
  }

  if (!canTrashExpense(expense, userId)) {
    return c.json({ error: "forbidden" }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(schema.expenses)
    .set({ status: "trashed", trashedAt: now, updatedAt: now })
    .where(eq(schema.expenses.id, id));

  await insertAuditEvent(db, {
    familyId: expense.familyId,
    actorUserId: userId,
    action: "expense_trashed",
    targetType: "expense",
    targetId: id,
    meta: { amountMinor: expense.amountMinor, currency: expense.currency },
  });

  return c.json({ ok: true });
});
