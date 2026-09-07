import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, gte, isNotNull, like, lte, sql } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { insertAuditEvent } from "../lib/audit";
import {
  EXPENSE_CATEGORIES,
  buildCategoryTree,
  ensureFamilyCategories,
  fromCents,
  getFamilyCategory,
  isExpenseCategory,
  resolveCategoryBySlug,
  rootCategorySlug,
  toCents,
  type ExpenseCategoryRow,
} from "../lib/expenses";

export const expenseRoutes = new Hono<HonoEnv>();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-mm-dd");
// Soft length bound — clients send a single emoji (incl. ZWJ sequences).
const emojiSchema = z.string().trim().min(1).max(16);

const createExpenseFields = {
  familyId: z.string().min(1),
  amount: z.number().finite().positive().max(10_000_000),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Must be a 3-letter currency code")
    .optional()
    .default("INR"),
  // Prefer categoryId (leaf or parent). Legacy `category` slug still accepted.
  categoryId: z.string().min(1).optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional().default("other"),
  note: z.string().max(500).optional(),
  spentOn: isoDate.optional(),
};

const createExpenseSchema = z.object(createExpenseFields);

const updateExpenseSchema = z.object({
  amount: z.number().finite().positive().max(10_000_000).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Must be a 3-letter currency code")
    .optional(),
  categoryId: z.string().min(1).nullable().optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  note: z.string().max(500).nullable().optional(),
  spentOn: isoDate.optional(),
});

const createCategorySchema = z.object({
  familyId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  emoji: emojiSchema.optional().default("📦"),
  parentId: z.string().min(1).nullable().optional(),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function serializeExpense(
  row: typeof schema.expenses.$inferSelect,
  categoriesById?: Map<string, ExpenseCategoryRow>,
) {
  const cat = row.categoryId ? categoriesById?.get(row.categoryId) : undefined;
  const parent =
    cat?.parentId && categoriesById ? categoriesById.get(cat.parentId) : undefined;
  return {
    ...row,
    amount: fromCents(row.amountCents),
    categoryName: cat?.name ?? row.category,
    categoryEmoji: cat?.emoji ?? "📦",
    parentCategoryName: parent?.name ?? null,
    parentCategoryEmoji: parent?.emoji ?? null,
  };
}

async function categoriesMap(
  db: ReturnType<typeof getDb>,
  familyId: string,
): Promise<Map<string, ExpenseCategoryRow>> {
  const rows = await ensureFamilyCategories(db, familyId);
  return new Map(rows.map((r) => [r.id, r]));
}

// GET /expenses/categories?familyId=:id — tree (seeds defaults on first call)
expenseRoutes.get("/categories", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const rows = await ensureFamilyCategories(db, familyId);
  return c.json({ categories: buildCategoryTree(rows) });
});

// POST /expenses/categories — create parent or child while adding an expense
expenseRoutes.post("/categories", requireSession, zv(createCategorySchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  await ensureFamilyCategories(db, data.familyId);

  if (data.parentId) {
    const parentRow = await getFamilyCategory(db, data.familyId, data.parentId);
    if (!parentRow) return c.json({ error: "invalid_parent_id" }, 400);
    if (parentRow.parentId) {
      // Depth capped at 2 (parent → child), Money Manager style.
      return c.json({ error: "max_depth" }, 400);
    }
  }

  const siblings = await db
    .select({ sortOrder: schema.expenseCategories.sortOrder })
    .from(schema.expenseCategories)
    .where(
      and(
        eq(schema.expenseCategories.familyId, data.familyId),
        data.parentId
          ? eq(schema.expenseCategories.parentId, data.parentId)
          : sql`${schema.expenseCategories.parentId} IS NULL`,
      ),
    );
  const nextOrder =
    siblings.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1;

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db.insert(schema.expenseCategories).values({
    id,
    familyId: data.familyId,
    parentId: data.parentId ?? null,
    name: data.name,
    emoji: data.emoji,
    slug: null,
    sortOrder: nextOrder,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });

  const category = await db
    .select()
    .from(schema.expenseCategories)
    .where(eq(schema.expenseCategories.id, id))
    .get();

  return c.json({ category }, 201);
});

// GET /expenses/suggestions?familyId=&q= — note lookup from past expenses
expenseRoutes.get("/suggestions", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const rawQ = (c.req.query("q") ?? "").trim().slice(0, 120);
  // Strip LIKE wildcards so user input cannot broaden the match.
  const q = rawQ.replace(/[%_]/g, "");
  const db = getDb(c.env);
  const cats = await categoriesMap(db, familyId);

  // Pull recent expenses with notes, then rank in app code (D1 has no
  // reliable GROUP BY + ORDER BY count without a subquery dance).
  const rows = await db
    .select()
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.familyId, familyId),
        isNotNull(schema.expenses.note),
        q.length > 0
          ? like(schema.expenses.note, `%${q}%`)
          : sql`length(trim(${schema.expenses.note})) > 0`,
      ),
    )
    .orderBy(desc(schema.expenses.spentOn), desc(sql`"expenses".rowid`))
    .limit(80);

  type Agg = {
    note: string;
    amount: number;
    amountCents: number;
    currency: string;
    category: string;
    categoryId: string | null;
    categoryName: string;
    categoryEmoji: string;
    parentCategoryName: string | null;
    count: number;
    lastSpentOn: string;
  };
  const byNote = new Map<string, Agg>();
  const qLower = q.toLowerCase();

  for (const row of rows) {
    const note = row.note?.trim();
    if (!note) continue;
    if (qLower && !note.toLowerCase().includes(qLower)) continue;
    const key = note.toLowerCase();
    const existing = byNote.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const cat = row.categoryId ? cats.get(row.categoryId) : undefined;
    const parent =
      cat?.parentId && cats.has(cat.parentId) ? cats.get(cat.parentId) : undefined;
    byNote.set(key, {
      note,
      amount: fromCents(row.amountCents),
      amountCents: row.amountCents,
      currency: row.currency,
      category: row.category,
      categoryId: row.categoryId,
      categoryName: cat?.name ?? row.category,
      categoryEmoji: cat?.emoji ?? "📦",
      parentCategoryName: parent?.name ?? null,
      count: 1,
      lastSpentOn: row.spentOn,
    });
  }

  const suggestions = [...byNote.values()]
    .sort((a, b) => {
      // Prefix matches first when searching, then frequency, then recency.
      if (qLower) {
        const aPrefix = a.note.toLowerCase().startsWith(qLower) ? 1 : 0;
        const bPrefix = b.note.toLowerCase().startsWith(qLower) ? 1 : 0;
        if (aPrefix !== bPrefix) return bPrefix - aPrefix;
      }
      if (a.count !== b.count) return b.count - a.count;
      return b.lastSpentOn.localeCompare(a.lastSpentOn);
    })
    .slice(0, 8);

  return c.json({ suggestions });
});

// GET /expenses?familyId=:id&from=&to=&category=
expenseRoutes.get("/", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const from = c.req.query("from");
  const to = c.req.query("to");
  const category = c.req.query("category");
  const cats = await categoriesMap(db, familyId);

  const conditions = [eq(schema.expenses.familyId, familyId)];
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    conditions.push(gte(schema.expenses.spentOn, from));
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    conditions.push(lte(schema.expenses.spentOn, to));
  }
  if (category && isExpenseCategory(category)) {
    conditions.push(eq(schema.expenses.category, category));
  }

  const rows = await db
    .select()
    .from(schema.expenses)
    .where(and(...(conditions as [typeof conditions[0], ...typeof conditions])))
    .orderBy(desc(schema.expenses.spentOn), desc(sql`"expenses".rowid`));

  const expenses = rows.map((r) => serializeExpense(r, cats));
  const totalCents = rows.reduce((sum, r) => sum + r.amountCents, 0);

  return c.json({
    expenses,
    total: fromCents(totalCents),
    totalCents,
  });
});

// POST /expenses
expenseRoutes.post("/", requireSession, zv(createExpenseSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const cats = await categoriesMap(db, data.familyId);

  let categoryRow: ExpenseCategoryRow | null = null;
  if (data.categoryId) {
    categoryRow = cats.get(data.categoryId) ?? null;
    if (!categoryRow) return c.json({ error: "invalid_category_id" }, 400);
  } else if (data.category) {
    categoryRow = await resolveCategoryBySlug(db, data.familyId, data.category);
  }

  const rootSlug = categoryRow
    ? rootCategorySlug([...cats.values()], categoryRow.id, data.category)
    : data.category;

  const expenseId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const spentOn = data.spentOn ?? todayIso();
  const amountCents = toCents(data.amount);

  await db.insert(schema.expenses).values({
    id: expenseId,
    familyId: data.familyId,
    createdBy: userId,
    amountCents,
    currency: data.currency,
    category: rootSlug,
    categoryId: categoryRow?.id ?? null,
    note: data.note,
    spentOn,
    updatedAt: now,
  });

  await insertAuditEvent(db, {
    familyId: data.familyId,
    actorUserId: userId,
    action: "expense_created",
    targetType: "expense",
    targetId: expenseId,
    meta: {
      amountCents,
      category: rootSlug,
      categoryId: categoryRow?.id ?? null,
      note: data.note,
    },
  });

  const expense = await db
    .select()
    .from(schema.expenses)
    .where(eq(schema.expenses.id, expenseId))
    .get();

  return c.json(
    { expense: expense ? serializeExpense(expense, cats) : expense },
    201,
  );
});

// GET /expenses/:id
expenseRoutes.get("/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const db = getDb(c.env);

  const expense = await db
    .select()
    .from(schema.expenses)
    .where(eq(schema.expenses.id, id))
    .get();

  if (!expense) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, expense.familyId);
  if (membership instanceof Response) return membership;

  const cats = await categoriesMap(db, expense.familyId);
  return c.json({ expense: serializeExpense(expense, cats) });
});

// PATCH /expenses/:id
expenseRoutes.patch("/:id", requireSession, zv(updateExpenseSchema), async (c) => {
  const { id } = c.req.param();
  const userId = c.get("userId")!;
  const updates = c.req.valid("json");
  const db = getDb(c.env);

  const expense = await db
    .select()
    .from(schema.expenses)
    .where(eq(schema.expenses.id, id))
    .get();

  if (!expense) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, expense.familyId);
  if (membership instanceof Response) return membership;

  if (expense.createdBy !== userId && membership.role === "member") {
    return c.json({ error: "forbidden" }, 403);
  }

  const cats = await categoriesMap(db, expense.familyId);
  const set: Partial<typeof schema.expenses.$inferInsert> = {
    updatedAt: Math.floor(Date.now() / 1000),
  };
  if (updates.amount !== undefined) set.amountCents = toCents(updates.amount);
  if (updates.currency !== undefined) set.currency = updates.currency;
  if (updates.note !== undefined) set.note = updates.note;
  if (updates.spentOn !== undefined) set.spentOn = updates.spentOn;

  if (updates.categoryId !== undefined) {
    if (updates.categoryId === null) {
      set.categoryId = null;
    } else {
      const row = cats.get(updates.categoryId);
      if (!row) return c.json({ error: "invalid_category_id" }, 400);
      set.categoryId = row.id;
      set.category = rootCategorySlug([...cats.values()], row.id, expense.category);
    }
  } else if (updates.category !== undefined) {
    const row = await resolveCategoryBySlug(db, expense.familyId, updates.category);
    set.category = updates.category;
    set.categoryId = row?.id ?? null;
  }

  await db.update(schema.expenses).set(set).where(eq(schema.expenses.id, id));

  const updated = await db
    .select()
    .from(schema.expenses)
    .where(eq(schema.expenses.id, id))
    .get();

  return c.json({ expense: updated ? serializeExpense(updated, cats) : updated });
});

// DELETE /expenses/:id
expenseRoutes.delete("/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const expense = await db
    .select()
    .from(schema.expenses)
    .where(eq(schema.expenses.id, id))
    .get();

  if (!expense) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, expense.familyId);
  if (membership instanceof Response) return membership;

  if (expense.createdBy !== userId && membership.role === "member") {
    return c.json({ error: "forbidden" }, 403);
  }

  await db.delete(schema.expenses).where(eq(schema.expenses.id, id));

  await insertAuditEvent(db, {
    familyId: expense.familyId,
    actorUserId: userId,
    action: "expense_deleted",
    targetType: "expense",
    targetId: id,
  });

  return c.json({ ok: true });
});
