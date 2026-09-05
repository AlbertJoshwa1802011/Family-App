import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { insertAuditEvent } from "../lib/audit";
import {
  EXPENSE_CATEGORIES,
  fromCents,
  toCents,
} from "../lib/expenses";

export const expenseRoutes = new Hono<HonoEnv>();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-mm-dd");

const createExpenseSchema = z.object({
  familyId: z.string().min(1),
  amount: z.number().finite().positive().max(10_000_000),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Must be a 3-letter currency code")
    .optional()
    .default("INR"),
  category: z.enum(EXPENSE_CATEGORIES).optional().default("other"),
  note: z.string().max(500).optional(),
  spentOn: isoDate.optional(),
});

const updateExpenseSchema = z.object({
  amount: z.number().finite().positive().max(10_000_000).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Must be a 3-letter currency code")
    .optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  note: z.string().max(500).nullable().optional(),
  spentOn: isoDate.optional(),
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

function serializeExpense(row: typeof schema.expenses.$inferSelect) {
  return {
    ...row,
    amount: fromCents(row.amountCents),
  };
}

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

  const conditions = [eq(schema.expenses.familyId, familyId)];
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    conditions.push(gte(schema.expenses.spentOn, from));
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    conditions.push(lte(schema.expenses.spentOn, to));
  }
  if (category && EXPENSE_CATEGORIES.includes(category as (typeof EXPENSE_CATEGORIES)[number])) {
    conditions.push(eq(schema.expenses.category, category));
  }

  const rows = await db
    .select()
    .from(schema.expenses)
    .where(and(...(conditions as [typeof conditions[0], ...typeof conditions])))
    .orderBy(desc(schema.expenses.spentOn), desc(sql`"expenses".rowid`));

  const expenses = rows.map(serializeExpense);
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
    category: data.category,
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
    meta: { amountCents, category: data.category, note: data.note },
  });

  const expense = await db
    .select()
    .from(schema.expenses)
    .where(eq(schema.expenses.id, expenseId))
    .get();

  return c.json({ expense: expense ? serializeExpense(expense) : expense }, 201);
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

  return c.json({ expense: serializeExpense(expense) });
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

  const set: Partial<typeof schema.expenses.$inferInsert> = {
    updatedAt: Math.floor(Date.now() / 1000),
  };
  if (updates.amount !== undefined) set.amountCents = toCents(updates.amount);
  if (updates.currency !== undefined) set.currency = updates.currency;
  if (updates.category !== undefined) set.category = updates.category;
  if (updates.note !== undefined) set.note = updates.note;
  if (updates.spentOn !== undefined) set.spentOn = updates.spentOn;

  await db.update(schema.expenses).set(set).where(eq(schema.expenses.id, id));

  const updated = await db
    .select()
    .from(schema.expenses)
    .where(eq(schema.expenses.id, id))
    .get();

  return c.json({ expense: updated ? serializeExpense(updated) : updated });
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
