/**
 * Finance: income, recurring commitments, planning settings, and the overview
 * that ties them together.
 *
 * Privacy follows expenses exactly: rows are owned by the member who created
 * them and are private by default, with NO owner/admin bypass. Hidden rows 404.
 * The arithmetic lives in lib/finance/plan.ts — this file only fetches and
 * validates.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq, gte, inArray, isNotNull, lte, or } from "drizzle-orm";
import type { AppContext, HonoEnv } from "../types";
import { getDb, schema, type Db } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { insertAuditEvent } from "../lib/audit";
import { MAX_AMOUNT_MINOR } from "../lib/money";
import { buildPlan, type CommitmentInput, type IncomeInput } from "../lib/finance/plan";
import { cycleFor, recentCycles, toUtc } from "../lib/finance/periods";

export const financeRoutes = new Hono<HonoEnv>();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-mm-dd");
const currencyCode = z.string().regex(/^[A-Z]{3}$/, "Must be an ISO 4217 currency code");
const amount = z.number().int().positive().lt(MAX_AMOUNT_MINOR);

function zv<T extends z.ZodType>(schema_: T) {
  return zValidator("json", schema_, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
    }
  });
}

function invalid(c: AppContext, path: string[], message: string) {
  return c.json(
    { error: "validation_error", issues: [{ code: "custom", path, message }] },
    400,
  );
}

/** Visible = mine, or explicitly shared with the family. No role bypass. */
function ownerVisibility(
  table: typeof schema.incomes | typeof schema.commitments,
  familyId: string,
  userId: string,
) {
  return and(
    eq(table.familyId, familyId),
    or(eq(table.visibility, "family"), eq(table.ownerUserId, userId)),
  );
}

async function familyCurrency(db: Db, familyId: string): Promise<string> {
  const row = await db
    .select({ c: schema.families.defaultCurrency })
    .from(schema.families)
    .where(eq(schema.families.id, familyId))
    .get();
  return row?.c ?? "USD";
}

// ── Settings ─────────────────────────────────────────────────────────────────

const settingsSchema = z.object({
  familyId: z.string().min(1),
  savingsTargetKind: z.enum(["none", "amount", "percent"]),
  savingsTargetMinor: z.number().int().nonnegative().lt(MAX_AMOUNT_MINOR).nullable().optional(),
  savingsTargetPercentBp: z.number().int().min(0).max(10000).nullable().optional(),
  paydayDayOfMonth: z.number().int().min(1).max(28),
});

const DEFAULT_SETTINGS = {
  savingsTargetKind: "none" as const,
  savingsTargetMinor: null,
  savingsTargetPercentBp: null,
  paydayDayOfMonth: 1,
};

async function loadSettings(db: Db, userId: string, familyId: string) {
  const row = await db
    .select()
    .from(schema.financialSettings)
    .where(
      and(
        eq(schema.financialSettings.userId, userId),
        eq(schema.financialSettings.familyId, familyId),
      ),
    )
    .get();
  return row ?? { userId, familyId, ...DEFAULT_SETTINGS };
}

financeRoutes.get("/settings", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const familyId = c.req.query("familyId");
  if (!familyId) return invalid(c, ["familyId"], "familyId is required");

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const settings = await loadSettings(db, userId, familyId);
  return c.json({ settings, currency: await familyCurrency(db, familyId) });
});

financeRoutes.put("/settings", requireSession, zv(settingsSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  if (data.savingsTargetKind === "amount" && data.savingsTargetMinor == null) {
    return invalid(c, ["savingsTargetMinor"], "an amount target needs savingsTargetMinor");
  }
  if (data.savingsTargetKind === "percent" && data.savingsTargetPercentBp == null) {
    return invalid(c, ["savingsTargetPercentBp"], "a percent target needs savingsTargetPercentBp");
  }

  const db = getDb(c.env);
  const now = Math.floor(Date.now() / 1000);

  await db
    .insert(schema.financialSettings)
    .values({
      userId,
      familyId: data.familyId,
      savingsTargetKind: data.savingsTargetKind,
      savingsTargetMinor: data.savingsTargetMinor ?? null,
      savingsTargetPercentBp: data.savingsTargetPercentBp ?? null,
      paydayDayOfMonth: data.paydayDayOfMonth,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.financialSettings.userId, schema.financialSettings.familyId],
      set: {
        savingsTargetKind: data.savingsTargetKind,
        savingsTargetMinor: data.savingsTargetMinor ?? null,
        savingsTargetPercentBp: data.savingsTargetPercentBp ?? null,
        paydayDayOfMonth: data.paydayDayOfMonth,
        updatedAt: now,
      },
    });

  return c.json({ settings: await loadSettings(db, userId, data.familyId) });
});

// ── Income ───────────────────────────────────────────────────────────────────

const createIncomeSchema = z.object({
  familyId: z.string().min(1),
  label: z.string().min(1).max(120),
  amountMinor: amount,
  currency: currencyCode,
  cadence: z.enum(["monthly", "weekly", "biweekly", "yearly", "one_off"]).default("monthly"),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  startDate: isoDate,
  endDate: isoDate.nullable().optional(),
  visibility: z.enum(["family", "private"]).default("private"),
});

const updateIncomeSchema = createIncomeSchema
  .omit({ familyId: true })
  .partial()
  .extend({ active: z.boolean().optional() });

financeRoutes.get("/incomes", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const familyId = c.req.query("familyId");
  if (!familyId) return invalid(c, ["familyId"], "familyId is required");

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const incomes = await db
    .select()
    .from(schema.incomes)
    .where(ownerVisibility(schema.incomes, familyId, userId));

  return c.json({ incomes });
});

financeRoutes.post("/incomes", requireSession, zv(createIncomeSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const expected = await familyCurrency(db, data.familyId);
  if (data.currency !== expected) {
    return invalid(c, ["currency"], `must match the family currency (${expected})`);
  }
  if (data.endDate && toUtc(data.endDate) < toUtc(data.startDate)) {
    return invalid(c, ["endDate"], "endDate cannot be before startDate");
  }

  const id = crypto.randomUUID();
  await db.insert(schema.incomes).values({
    id,
    familyId: data.familyId,
    ownerUserId: userId,
    label: data.label.trim(),
    amountMinor: data.amountMinor,
    currency: data.currency,
    cadence: data.cadence,
    dayOfMonth: data.dayOfMonth ?? null,
    startDate: data.startDate,
    endDate: data.endDate ?? null,
    visibility: data.visibility,
  });

  await insertAuditEvent(db, {
    familyId: data.familyId,
    actorUserId: userId,
    action: "income_created",
    targetType: "income",
    targetId: id,
    meta: { label: data.label, amountMinor: data.amountMinor },
  });

  const income = await db.select().from(schema.incomes).where(eq(schema.incomes.id, id)).get();
  return c.json({ income }, 201);
});

financeRoutes.patch("/incomes/:id", requireSession, zv(updateIncomeSchema), async (c) => {
  const userId = c.get("userId")!;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "not_found" }, 404);
  const data = c.req.valid("json");
  const db = getDb(c.env);

  const row = await db.select().from(schema.incomes).where(eq(schema.incomes.id, id)).get();
  if (!row) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, row.familyId);
  if (membership instanceof Response) return membership;
  // Not mine and not shared → it does not exist, as far as this caller knows.
  if (row.visibility === "private" && row.ownerUserId !== userId) {
    return c.json({ error: "not_found" }, 404);
  }
  if (row.ownerUserId !== userId) return c.json({ error: "forbidden" }, 403);

  await db
    .update(schema.incomes)
    .set({
      ...(data.label !== undefined ? { label: data.label.trim() } : {}),
      ...(data.amountMinor !== undefined ? { amountMinor: data.amountMinor } : {}),
      ...(data.cadence !== undefined ? { cadence: data.cadence } : {}),
      ...(data.dayOfMonth !== undefined ? { dayOfMonth: data.dayOfMonth } : {}),
      ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
      ...(data.endDate !== undefined ? { endDate: data.endDate } : {}),
      ...(data.visibility !== undefined ? { visibility: data.visibility } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(schema.incomes.id, id));

  const income = await db.select().from(schema.incomes).where(eq(schema.incomes.id, id)).get();
  return c.json({ income });
});

financeRoutes.delete("/incomes/:id", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "not_found" }, 404);
  const db = getDb(c.env);

  const row = await db.select().from(schema.incomes).where(eq(schema.incomes.id, id)).get();
  if (!row) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, row.familyId);
  if (membership instanceof Response) return membership;
  if (row.visibility === "private" && row.ownerUserId !== userId) {
    return c.json({ error: "not_found" }, 404);
  }
  if (row.ownerUserId !== userId) return c.json({ error: "forbidden" }, 403);

  await db.delete(schema.incomes).where(eq(schema.incomes.id, id));
  return c.json({ ok: true });
});

// ── Commitments ──────────────────────────────────────────────────────────────

const commitmentKinds = [
  "emi",
  "loan",
  "insurance",
  "investment",
  "subscription",
  "giving",
  "rent",
  "utility",
  "other",
] as const;

const commitmentBaseSchema = z
  .object({
    familyId: z.string().min(1),
    kind: z.enum(commitmentKinds),
    name: z.string().min(1).max(120),
    notes: z.string().max(2000).nullable().optional(),
    amountKind: z.enum(["fixed", "percent_of_income"]).default("fixed"),
    amountMinor: amount.nullable().optional(),
    percentBp: z.number().int().min(1).max(10000).nullable().optional(),
    currency: currencyCode,
    cadence: z.enum(["weekly", "monthly", "quarterly", "yearly"]).default("monthly"),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    startDate: isoDate,
    endDate: isoDate.nullable().optional(),
    totalInstallments: z.number().int().min(1).max(1200).nullable().optional(),
    categoryId: z.string().min(1).nullable().optional(),
    autoLog: z.boolean().default(false),
    remindDaysBefore: z.number().int().min(0).max(60).default(3),
    visibility: z.enum(["family", "private"]).default("private"),
  });

// Derive both schemas from the unrefined base: the refinement is a create-time
// rule, and partial updates must not have to restate the amount every PATCH.
const createCommitmentSchema = commitmentBaseSchema.refine(
  (d) => (d.amountKind === "fixed" ? d.amountMinor != null : d.percentBp != null),
  {
    message: "fixed commitments need amountMinor; percent_of_income needs percentBp",
    path: ["amountMinor"],
  },
);

const updateCommitmentSchema = commitmentBaseSchema
  .omit({ familyId: true })
  .partial()
  .extend({ status: z.enum(["active", "paused", "completed"]).optional() });

financeRoutes.get("/commitments", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const familyId = c.req.query("familyId");
  if (!familyId) return invalid(c, ["familyId"], "familyId is required");

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  let where = ownerVisibility(schema.commitments, familyId, userId);
  const kind = c.req.query("kind");
  if (kind && (commitmentKinds as readonly string[]).includes(kind)) {
    where = and(where, eq(schema.commitments.kind, kind as (typeof commitmentKinds)[number]));
  }
  const status = c.req.query("status");
  if (status === "active" || status === "paused" || status === "completed") {
    where = and(where, eq(schema.commitments.status, status));
  }

  const commitments = await db.select().from(schema.commitments).where(where);
  return c.json({ commitments });
});

financeRoutes.post("/commitments", requireSession, zv(createCommitmentSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const expected = await familyCurrency(db, data.familyId);
  if (data.currency !== expected) {
    return invalid(c, ["currency"], `must match the family currency (${expected})`);
  }
  if (data.endDate && toUtc(data.endDate) < toUtc(data.startDate)) {
    return invalid(c, ["endDate"], "endDate cannot be before startDate");
  }

  const id = crypto.randomUUID();
  await db.insert(schema.commitments).values({
    id,
    familyId: data.familyId,
    ownerUserId: userId,
    kind: data.kind,
    name: data.name.trim(),
    notes: data.notes ?? null,
    amountKind: data.amountKind,
    amountMinor: data.amountKind === "fixed" ? (data.amountMinor ?? null) : null,
    percentBp: data.amountKind === "percent_of_income" ? (data.percentBp ?? null) : null,
    currency: data.currency,
    cadence: data.cadence,
    dayOfMonth: data.dayOfMonth ?? Number(data.startDate.slice(8, 10)),
    dayOfWeek: data.dayOfWeek ?? null,
    startDate: data.startDate,
    endDate: data.endDate ?? null,
    totalInstallments: data.totalInstallments ?? null,
    categoryId: data.categoryId ?? null,
    autoLog: data.autoLog,
    remindDaysBefore: data.remindDaysBefore,
    visibility: data.visibility,
  });

  await insertAuditEvent(db, {
    familyId: data.familyId,
    actorUserId: userId,
    action: "commitment_created",
    targetType: "commitment",
    targetId: id,
    meta: { kind: data.kind, name: data.name },
  });

  const commitment = await db
    .select()
    .from(schema.commitments)
    .where(eq(schema.commitments.id, id))
    .get();
  return c.json({ commitment }, 201);
});

financeRoutes.patch("/commitments/:id", requireSession, zv(updateCommitmentSchema), async (c) => {
  const userId = c.get("userId")!;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "not_found" }, 404);
  const data = c.req.valid("json");
  const db = getDb(c.env);

  const row = await db.select().from(schema.commitments).where(eq(schema.commitments.id, id)).get();
  if (!row) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, row.familyId);
  if (membership instanceof Response) return membership;
  if (row.visibility === "private" && row.ownerUserId !== userId) {
    return c.json({ error: "not_found" }, 404);
  }
  if (row.ownerUserId !== userId) return c.json({ error: "forbidden" }, 403);

  await db
    .update(schema.commitments)
    .set({
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.kind !== undefined ? { kind: data.kind } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      ...(data.amountMinor !== undefined ? { amountMinor: data.amountMinor } : {}),
      ...(data.percentBp !== undefined ? { percentBp: data.percentBp } : {}),
      ...(data.amountKind !== undefined ? { amountKind: data.amountKind } : {}),
      ...(data.cadence !== undefined ? { cadence: data.cadence } : {}),
      ...(data.dayOfMonth !== undefined ? { dayOfMonth: data.dayOfMonth } : {}),
      ...(data.dayOfWeek !== undefined ? { dayOfWeek: data.dayOfWeek } : {}),
      ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
      ...(data.endDate !== undefined ? { endDate: data.endDate } : {}),
      ...(data.totalInstallments !== undefined
        ? { totalInstallments: data.totalInstallments }
        : {}),
      ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
      ...(data.autoLog !== undefined ? { autoLog: data.autoLog } : {}),
      ...(data.remindDaysBefore !== undefined
        ? { remindDaysBefore: data.remindDaysBefore }
        : {}),
      ...(data.visibility !== undefined ? { visibility: data.visibility } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(schema.commitments.id, id));

  const commitment = await db
    .select()
    .from(schema.commitments)
    .where(eq(schema.commitments.id, id))
    .get();
  return c.json({ commitment });
});

financeRoutes.delete("/commitments/:id", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "not_found" }, 404);
  const db = getDb(c.env);

  const row = await db.select().from(schema.commitments).where(eq(schema.commitments.id, id)).get();
  if (!row) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, row.familyId);
  if (membership instanceof Response) return membership;
  if (row.visibility === "private" && row.ownerUserId !== userId) {
    return c.json({ error: "not_found" }, 404);
  }
  if (row.ownerUserId !== userId) return c.json({ error: "forbidden" }, 403);

  await db.delete(schema.commitments).where(eq(schema.commitments.id, id));
  return c.json({ ok: true });
});

/** Mark one period of a commitment as paid, optionally recording the expense. */
const paySchema = z.object({
  periodKey: z.string().min(4).max(16),
  dueDate: isoDate,
  amountMinor: amount,
  logExpense: z.boolean().default(false),
});

financeRoutes.post("/commitments/:id/pay", requireSession, zv(paySchema), async (c) => {
  const userId = c.get("userId")!;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "not_found" }, 404);
  const data = c.req.valid("json");
  const db = getDb(c.env);

  const row = await db.select().from(schema.commitments).where(eq(schema.commitments.id, id)).get();
  if (!row) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, row.familyId);
  if (membership instanceof Response) return membership;
  if (row.ownerUserId !== userId) {
    return c.json({ error: row.visibility === "private" ? "not_found" : "forbidden" }, row.visibility === "private" ? 404 : 403);
  }

  const existing = await db
    .select()
    .from(schema.commitmentPayments)
    .where(
      and(
        eq(schema.commitmentPayments.commitmentId, id),
        eq(schema.commitmentPayments.periodKey, data.periodKey),
      ),
    )
    .get();
  if (existing?.paid) return c.json({ payment: existing });

  let expenseId: string | null = existing?.expenseId ?? null;
  if (data.logExpense && !expenseId) {
    expenseId = crypto.randomUUID();
    await db.insert(schema.expenses).values({
      id: expenseId,
      familyId: row.familyId,
      paidByMemberId: membership.id,
      categoryId: row.categoryId,
      amountMinor: data.amountMinor,
      currency: row.currency,
      expenseDate: data.dueDate,
      merchant: row.name,
      description: `${row.kind} commitment`,
      visibility: row.visibility,
      createdByUserId: userId,
    });
  }

  const now = Math.floor(Date.now() / 1000);
  if (existing) {
    await db
      .update(schema.commitmentPayments)
      .set({ paid: true, paidAt: now, expenseId })
      .where(eq(schema.commitmentPayments.id, existing.id));
  } else {
    await db.insert(schema.commitmentPayments).values({
      id: crypto.randomUUID(),
      commitmentId: id,
      periodKey: data.periodKey,
      dueDate: data.dueDate,
      amountMinor: data.amountMinor,
      currency: row.currency,
      paid: true,
      paidAt: now,
      expenseId,
    });
  }

  const payment = await db
    .select()
    .from(schema.commitmentPayments)
    .where(
      and(
        eq(schema.commitmentPayments.commitmentId, id),
        eq(schema.commitmentPayments.periodKey, data.periodKey),
      ),
    )
    .get();
  return c.json({ payment }, 201);
});

// ── Overview ─────────────────────────────────────────────────────────────────

financeRoutes.get("/overview", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const familyId = c.req.query("familyId");
  if (!familyId) return invalid(c, ["familyId"], "familyId is required");

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const dateParam = c.req.query("date");
  if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return invalid(c, ["date"], "Must be yyyy-mm-dd");
  }
  const today = dateParam ?? new Date().toISOString().slice(0, 10);

  const monthsParam = Number(c.req.query("months") ?? 6);
  const months = Number.isFinite(monthsParam)
    ? Math.min(Math.max(Math.trunc(monthsParam), 1), 24)
    : 6;

  const db = getDb(c.env);
  const settings = await loadSettings(db, userId, familyId);
  const currency = await familyCurrency(db, familyId);
  const cycle = cycleFor(today, settings.paydayDayOfMonth);

  const incomeRows = await db
    .select()
    .from(schema.incomes)
    .where(ownerVisibility(schema.incomes, familyId, userId));
  const commitmentRows = await db
    .select()
    .from(schema.commitments)
    .where(ownerVisibility(schema.commitments, familyId, userId));

  // Trend window covers every cycle we report on, so one fetch serves all.
  const cycles = recentCycles(today, months, settings.paydayDayOfMonth);
  const windowFrom = cycles[0].from;
  const windowTo = cycle.to;

  const expenseRowsRaw = await db
    .select({
      id: schema.expenses.id,
      amountMinor: schema.expenses.amountMinor,
      expenseDate: schema.expenses.expenseDate,
      categoryId: schema.expenses.categoryId,
      parentExpenseId: schema.expenses.parentExpenseId,
    })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.familyId, familyId),
        eq(schema.expenses.status, "active"),
        or(
          eq(schema.expenses.visibility, "family"),
          eq(schema.expenses.createdByUserId, userId),
        ),
        gte(schema.expenses.expenseDate, windowFrom),
        lte(schema.expenses.expenseDate, windowTo),
      ),
    );

  // Nested containers (parents with children) must not inflate spend totals.
  const expenseParentIds = new Set(
    expenseRowsRaw
      .map((r) => r.parentExpenseId)
      .filter((v): v is string => v !== null),
  );
  const expenseRows = expenseRowsRaw
    .filter((r) => !expenseParentIds.has(r.id))
    .map(({ id, amountMinor, expenseDate, categoryId }) => ({
      id,
      amountMinor,
      expenseDate,
      categoryId,
    }));

  // Expenses the cron already logged for a commitment — excluded from
  // discretionary spend so committed money is never counted twice.
  const commitmentIds = commitmentRows.map((r) => r.id);
  const linked = commitmentIds.length
    ? await db
        .select({ expenseId: schema.commitmentPayments.expenseId })
        .from(schema.commitmentPayments)
        .where(
          and(
            inArray(schema.commitmentPayments.commitmentId, commitmentIds),
            isNotNull(schema.commitmentPayments.expenseId),
          ),
        )
    : [];
  const committedExpenseIds = new Set(
    linked.map((r) => r.expenseId).filter((v): v is string => v !== null),
  );

  const incomes = incomeRows as unknown as IncomeInput[];
  const commitments = commitmentRows as unknown as CommitmentInput[];

  const plan = buildPlan({
    cycle,
    today,
    incomes,
    commitments,
    expenses: expenseRows,
    committedExpenseIds,
    settings,
  });

  // Long-run view: the same plan maths applied to each recent cycle.
  const trend = cycles.map((cy) => {
    const p = buildPlan({
      cycle: cy,
      today,
      incomes,
      commitments,
      expenses: expenseRows,
      committedExpenseIds,
      settings,
    });
    return {
      key: cy.key,
      from: cy.from,
      to: cy.to,
      incomeMinor: p.incomeMinor,
      committedMinor: p.committedMinor,
      spentMinor: p.spentMinor,
      savedMinor: p.projectedSavingsMinor,
    };
  });

  const past = trend.slice(0, -1);
  const avgSpend = past.length
    ? Math.round(past.reduce((s, t) => s + t.spentMinor, 0) / past.length)
    : null;

  return c.json({
    currency,
    settings,
    plan,
    trend,
    insights: {
      averageSpendMinor: avgSpend,
      // Positive = spending more than the recent average.
      vsAverageMinor: avgSpend === null ? null : plan.spentMinor - avgSpend,
      savingsRateBp:
        plan.incomeMinor > 0
          ? Math.round((plan.projectedSavingsMinor / plan.incomeMinor) * 10000)
          : null,
    },
  });
});
