/**
 * Money plan, recurring expenses, and wishlist — mounted on expenseRoutes
 * before the `/:id` catch-all.
 */

import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { insertAuditEvent } from "../lib/audit";
import { MAX_AMOUNT_MINOR } from "../lib/money";
import {
  isRecurringHiddenFrom,
  recurringVisibilityWhere,
} from "../lib/expenses/visibility";

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

const moneyPlanSchema = z.object({
  monthlyIncomeMinor: z.number().int().min(0).lt(MAX_AMOUNT_MINOR),
  currency: currencyCode.optional(),
  tithePercent: z.number().int().min(0).max(100).optional(),
  childrenGivingMinor: z.number().int().min(0).lt(MAX_AMOUNT_MINOR).optional(),
  savingsGoalMinor: z.number().int().min(0).lt(MAX_AMOUNT_MINOR).optional(),
});

const createRecurringSchema = z.object({
  familyId: z.string().min(1),
  title: z.string().min(1).max(200),
  kind: z
    .enum([
      "emi",
      "insurance",
      "investment",
      "subscription",
      "tithe",
      "children",
      "other",
    ])
    .optional()
    .default("other"),
  amountMinor: z.number().int().positive().lt(MAX_AMOUNT_MINOR),
  currency: currencyCode,
  categoryId: z.string().min(1).optional().nullable(),
  interval: z.enum(["monthly", "weekly", "yearly"]).optional().default("monthly"),
  startDate: isoDate,
  endDate: isoDate.optional().nullable(),
  dayOfMonth: z.number().int().min(1).max(28).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  active: z.boolean().optional().default(true),
  visibility: z.enum(["family", "private"]).optional().default("private"),
});

const updateRecurringSchema = createRecurringSchema
  .omit({ familyId: true })
  .partial();

const createWishlistSchema = z.object({
  familyId: z.string().min(1),
  title: z.string().min(1).max(200),
  estimatedMinor: z
    .number()
    .int()
    .positive()
    .lt(MAX_AMOUNT_MINOR)
    .optional()
    .nullable(),
  currency: currencyCode.optional(),
  priority: z.enum(["must", "should", "want"]).optional().default("want"),
  url: z.string().url().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const updateWishlistSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  estimatedMinor: z
    .number()
    .int()
    .positive()
    .lt(MAX_AMOUNT_MINOR)
    .nullable()
    .optional(),
  currency: currencyCode.optional(),
  priority: z.enum(["must", "should", "want"]).optional(),
  url: z.string().url().max(2000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(["open", "bought", "dropped"]).optional(),
});

export function registerExpenseMoneyRoutes(app: Hono<HonoEnv>): void {
  // ── Money plan ────────────────────────────────────────────────────────────

  app.get("/plan", requireSession, async (c) => {
    const userId = c.get("userId")!;
    const familyId = c.req.query("familyId");
    if (!familyId) return c.json({ error: "familyId query param required" }, 400);

    const membership = await requireFamilyMember(c, familyId);
    if (membership instanceof Response) return membership;

    const db = getDb(c.env);
    const family = await db
      .select({ defaultCurrency: schema.families.defaultCurrency })
      .from(schema.families)
      .where(eq(schema.families.id, familyId))
      .get();

    const row = await db
      .select()
      .from(schema.moneyPlans)
      .where(
        and(
          eq(schema.moneyPlans.familyId, familyId),
          eq(schema.moneyPlans.userId, userId),
        ),
      )
      .get();

    return c.json({
      plan: row ?? {
        id: null,
        familyId,
        userId,
        monthlyIncomeMinor: 0,
        currency: family?.defaultCurrency ?? "USD",
        tithePercent: 10,
        childrenGivingMinor: 0,
        savingsGoalMinor: 0,
        createdAt: null,
        updatedAt: null,
      },
    });
  });

  app.put("/plan", requireSession, zv(moneyPlanSchema), async (c) => {
    const userId = c.get("userId")!;
    const familyId = c.req.query("familyId");
    if (!familyId) return c.json({ error: "familyId query param required" }, 400);

    const membership = await requireFamilyMember(c, familyId);
    if (membership instanceof Response) return membership;

    const data = c.req.valid("json");
    const db = getDb(c.env);

    const family = await db
      .select({ defaultCurrency: schema.families.defaultCurrency })
      .from(schema.families)
      .where(eq(schema.families.id, familyId))
      .get();
    if (!family) return c.json({ error: "not_found" }, 404);

    const currency = data.currency ?? family.defaultCurrency;
    if (currency !== family.defaultCurrency) {
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

    const now = Math.floor(Date.now() / 1000);
    const existing = await db
      .select()
      .from(schema.moneyPlans)
      .where(
        and(
          eq(schema.moneyPlans.familyId, familyId),
          eq(schema.moneyPlans.userId, userId),
        ),
      )
      .get();

    if (existing) {
      await db
        .update(schema.moneyPlans)
        .set({
          monthlyIncomeMinor: data.monthlyIncomeMinor,
          currency,
          tithePercent: data.tithePercent ?? existing.tithePercent,
          childrenGivingMinor:
            data.childrenGivingMinor ?? existing.childrenGivingMinor,
          savingsGoalMinor: data.savingsGoalMinor ?? existing.savingsGoalMinor,
          updatedAt: now,
        })
        .where(eq(schema.moneyPlans.id, existing.id));
    } else {
      await db.insert(schema.moneyPlans).values({
        id: crypto.randomUUID(),
        familyId,
        userId,
        monthlyIncomeMinor: data.monthlyIncomeMinor,
        currency,
        tithePercent: data.tithePercent ?? 10,
        childrenGivingMinor: data.childrenGivingMinor ?? 0,
        savingsGoalMinor: data.savingsGoalMinor ?? 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    const plan = await db
      .select()
      .from(schema.moneyPlans)
      .where(
        and(
          eq(schema.moneyPlans.familyId, familyId),
          eq(schema.moneyPlans.userId, userId),
        ),
      )
      .get();

    return c.json({ plan });
  });

  // ── Recurring expenses ────────────────────────────────────────────────────

  app.get("/recurring", requireSession, async (c) => {
    const userId = c.get("userId")!;
    const familyId = c.req.query("familyId");
    if (!familyId) return c.json({ error: "familyId query param required" }, 400);

    const membership = await requireFamilyMember(c, familyId);
    if (membership instanceof Response) return membership;

    const db = getDb(c.env);
    const activeOnly = c.req.query("active") !== "0";
    let where = recurringVisibilityWhere(familyId, userId);
    if (activeOnly) {
      where = and(where, eq(schema.recurringExpenses.active, true));
    }

    const rows = await db
      .select()
      .from(schema.recurringExpenses)
      .where(where)
      .orderBy(desc(schema.recurringExpenses.createdAt));

    return c.json({ recurring: rows });
  });

  app.post("/recurring", requireSession, zv(createRecurringSchema), async (c) => {
    const userId = c.get("userId")!;
    const data = c.req.valid("json");

    const membership = await requireFamilyMember(c, data.familyId);
    if (membership instanceof Response) return membership;

    const db = getDb(c.env);
    const family = await db
      .select({ defaultCurrency: schema.families.defaultCurrency })
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

    if (data.interval === "monthly" && data.dayOfMonth == null) {
      const dom = Number(data.startDate.slice(8, 10));
      data.dayOfMonth = Math.min(28, Math.max(1, dom));
    }

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await db.insert(schema.recurringExpenses).values({
      id,
      familyId: data.familyId,
      createdByUserId: userId,
      title: data.title.trim(),
      kind: data.kind ?? "other",
      amountMinor: data.amountMinor,
      currency: data.currency,
      categoryId: data.categoryId ?? null,
      interval: data.interval ?? "monthly",
      startDate: data.startDate,
      endDate: data.endDate ?? null,
      dayOfMonth: data.dayOfMonth ?? null,
      notes: data.notes ?? null,
      active: data.active ?? true,
      visibility: data.visibility ?? "private",
      createdAt: now,
      updatedAt: now,
    });

    await insertAuditEvent(db, {
      familyId: data.familyId,
      actorUserId: userId,
      action: "recurring_expense_created",
      targetType: "recurring_expense",
      targetId: id,
      meta: { title: data.title, amountMinor: data.amountMinor },
      visibility: data.visibility ?? "private",
    });

    const row = await db
      .select()
      .from(schema.recurringExpenses)
      .where(eq(schema.recurringExpenses.id, id))
      .get();
    return c.json({ recurring: row }, 201);
  });

  app.get("/recurring/:id", requireSession, async (c) => {
    const userId = c.get("userId")!;
    const { id } = c.req.param();
    const db = getDb(c.env);

    const row = await db
      .select()
      .from(schema.recurringExpenses)
      .where(eq(schema.recurringExpenses.id, id))
      .get();
    if (!row) return c.json({ error: "not_found" }, 404);

    const membership = await requireFamilyMember(c, row.familyId);
    if (membership instanceof Response) return membership;

    if (isRecurringHiddenFrom(row, userId)) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ recurring: row });
  });

  app.patch(
    "/recurring/:id",
    requireSession,
    zv(updateRecurringSchema),
    async (c) => {
      const userId = c.get("userId")!;
      const { id } = c.req.param();
      const updates = c.req.valid("json");
      const db = getDb(c.env);

      const row = await db
        .select()
        .from(schema.recurringExpenses)
        .where(eq(schema.recurringExpenses.id, id))
        .get();
      if (!row) return c.json({ error: "not_found" }, 404);

      const membership = await requireFamilyMember(c, row.familyId);
      if (membership instanceof Response) return membership;

      if (isRecurringHiddenFrom(row, userId)) {
        return c.json({ error: "not_found" }, 404);
      }
      if (row.createdByUserId !== userId) {
        return c.json({ error: "forbidden" }, 403);
      }

      const now = Math.floor(Date.now() / 1000);
      const set: Partial<typeof schema.recurringExpenses.$inferInsert> = {
        updatedAt: now,
      };
      if (updates.title !== undefined) set.title = updates.title.trim();
      if (updates.kind !== undefined) set.kind = updates.kind;
      if (updates.amountMinor !== undefined) set.amountMinor = updates.amountMinor;
      if (updates.currency !== undefined) set.currency = updates.currency;
      if (updates.categoryId !== undefined) set.categoryId = updates.categoryId;
      if (updates.interval !== undefined) set.interval = updates.interval;
      if (updates.startDate !== undefined) set.startDate = updates.startDate;
      if (updates.endDate !== undefined) set.endDate = updates.endDate;
      if (updates.dayOfMonth !== undefined) set.dayOfMonth = updates.dayOfMonth;
      if (updates.notes !== undefined) set.notes = updates.notes;
      if (updates.active !== undefined) set.active = updates.active;
      if (updates.visibility !== undefined) set.visibility = updates.visibility;

      await db
        .update(schema.recurringExpenses)
        .set(set)
        .where(eq(schema.recurringExpenses.id, id));

      const updated = await db
        .select()
        .from(schema.recurringExpenses)
        .where(eq(schema.recurringExpenses.id, id))
        .get();
      return c.json({ recurring: updated });
    },
  );

  app.delete("/recurring/:id", requireSession, async (c) => {
    const userId = c.get("userId")!;
    const { id } = c.req.param();
    const db = getDb(c.env);

    const row = await db
      .select()
      .from(schema.recurringExpenses)
      .where(eq(schema.recurringExpenses.id, id))
      .get();
    if (!row) return c.json({ error: "not_found" }, 404);

    const membership = await requireFamilyMember(c, row.familyId);
    if (membership instanceof Response) return membership;

    if (isRecurringHiddenFrom(row, userId)) {
      return c.json({ error: "not_found" }, 404);
    }
    if (row.createdByUserId !== userId) {
      return c.json({ error: "forbidden" }, 403);
    }

    await db
      .delete(schema.recurringExpenses)
      .where(eq(schema.recurringExpenses.id, id));

    await insertAuditEvent(db, {
      familyId: row.familyId,
      actorUserId: userId,
      action: "recurring_expense_deleted",
      targetType: "recurring_expense",
      targetId: id,
      meta: { title: row.title },
      visibility: row.visibility,
    });

    return c.json({ ok: true });
  });

  // ── Wishlist ──────────────────────────────────────────────────────────────

  app.get("/wishlist", requireSession, async (c) => {
    const familyId = c.req.query("familyId");
    if (!familyId) return c.json({ error: "familyId query param required" }, 400);

    const membership = await requireFamilyMember(c, familyId);
    if (membership instanceof Response) return membership;

    const db = getDb(c.env);
    const status = c.req.query("status");
    let where = eq(schema.wishlistItems.familyId, familyId);
    if (status === "open" || status === "bought" || status === "dropped") {
      where = and(where, eq(schema.wishlistItems.status, status))!;
    }

    const rows = await db
      .select()
      .from(schema.wishlistItems)
      .where(where)
      .orderBy(desc(schema.wishlistItems.createdAt));

    return c.json({ items: rows });
  });

  app.post("/wishlist", requireSession, zv(createWishlistSchema), async (c) => {
    const userId = c.get("userId")!;
    const data = c.req.valid("json");

    const membership = await requireFamilyMember(c, data.familyId);
    if (membership instanceof Response) return membership;

    const db = getDb(c.env);
    const family = await db
      .select({ defaultCurrency: schema.families.defaultCurrency })
      .from(schema.families)
      .where(eq(schema.families.id, data.familyId))
      .get();
    if (!family) return c.json({ error: "not_found" }, 404);

    const currency = data.currency ?? family.defaultCurrency;
    if (currency !== family.defaultCurrency) {
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

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await db.insert(schema.wishlistItems).values({
      id,
      familyId: data.familyId,
      createdByUserId: userId,
      title: data.title.trim(),
      estimatedMinor: data.estimatedMinor ?? null,
      currency,
      priority: data.priority ?? "want",
      url: data.url ?? null,
      notes: data.notes ?? null,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });

    const item = await db
      .select()
      .from(schema.wishlistItems)
      .where(eq(schema.wishlistItems.id, id))
      .get();
    return c.json({ item }, 201);
  });

  app.patch(
    "/wishlist/:id",
    requireSession,
    zv(updateWishlistSchema),
    async (c) => {
      const userId = c.get("userId")!;
      const { id } = c.req.param();
      const updates = c.req.valid("json");
      const db = getDb(c.env);

      const row = await db
        .select()
        .from(schema.wishlistItems)
        .where(eq(schema.wishlistItems.id, id))
        .get();
      if (!row) return c.json({ error: "not_found" }, 404);

      const membership = await requireFamilyMember(c, row.familyId);
      if (membership instanceof Response) return membership;

      if (row.createdByUserId !== userId) {
        return c.json({ error: "forbidden" }, 403);
      }

      const now = Math.floor(Date.now() / 1000);
      const set: Partial<typeof schema.wishlistItems.$inferInsert> = {
        updatedAt: now,
      };
      if (updates.title !== undefined) set.title = updates.title.trim();
      if (updates.estimatedMinor !== undefined) {
        set.estimatedMinor = updates.estimatedMinor;
      }
      if (updates.currency !== undefined) set.currency = updates.currency;
      if (updates.priority !== undefined) set.priority = updates.priority;
      if (updates.url !== undefined) set.url = updates.url;
      if (updates.notes !== undefined) set.notes = updates.notes;
      if (updates.status !== undefined) set.status = updates.status;

      await db
        .update(schema.wishlistItems)
        .set(set)
        .where(eq(schema.wishlistItems.id, id));

      const item = await db
        .select()
        .from(schema.wishlistItems)
        .where(eq(schema.wishlistItems.id, id))
        .get();
      return c.json({ item });
    },
  );

  app.delete("/wishlist/:id", requireSession, async (c) => {
    const userId = c.get("userId")!;
    const { id } = c.req.param();
    const db = getDb(c.env);

    const row = await db
      .select()
      .from(schema.wishlistItems)
      .where(eq(schema.wishlistItems.id, id))
      .get();
    if (!row) return c.json({ error: "not_found" }, 404);

    const membership = await requireFamilyMember(c, row.familyId);
    if (membership instanceof Response) return membership;

    if (row.createdByUserId !== userId) {
      return c.json({ error: "forbidden" }, 403);
    }

    await db
      .delete(schema.wishlistItems)
      .where(eq(schema.wishlistItems.id, id));
    return c.json({ ok: true });
  });
}
