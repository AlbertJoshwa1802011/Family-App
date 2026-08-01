/**
 * Expense payment methods.
 *
 * Family-scoped and data-driven: a family can add "PhonePe" without a code
 * change. `kind` is the coarse, stable dimension analytics groups by — nothing
 * downstream may match on `name`.
 *
 * Like categories, payment methods are archived rather than deleted whenever an
 * expense could reference them.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { ensureUniqueSlug, slugify } from "../lib/expenses/slug";

export const expensePaymentMethodRoutes = new Hono<HonoEnv>();

// ── Validation schemas ────────────────────────────────────────────────────────

const paymentKind = z.enum(["cash", "card", "bank", "upi", "wallet", "other"]);
const sortOrder = z.number().int().min(0).max(100_000);

const createSchema = z.object({
  familyId: z.string().min(1),
  name: z.string().min(1).max(60),
  emoji: z.string().max(24).optional(),
  kind: paymentKind.optional(),
  sortOrder: sortOrder.optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  emoji: z.string().max(24).nullable().optional(),
  kind: paymentKind.optional(),
  sortOrder: sortOrder.optional(),
  status: z.enum(["active", "archived"]).optional(),
});

const reorderSchema = z.object({
  familyId: z.string().min(1),
  items: z
    .array(z.object({ id: z.string().min(1), sortOrder }))
    .min(1)
    .max(200),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

/** GET /expense-payment-methods?familyId=:id&includeArchived=1 */
expensePaymentMethodRoutes.get("/", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const includeArchived = c.req.query("includeArchived") === "1";
  const db = getDb(c.env);

  const conditions = [eq(schema.expensePaymentMethods.familyId, familyId)];
  if (!includeArchived) {
    conditions.push(eq(schema.expensePaymentMethods.status, "active"));
  }

  const paymentMethods = await db
    .select({
      id: schema.expensePaymentMethods.id,
      name: schema.expensePaymentMethods.name,
      slug: schema.expensePaymentMethods.slug,
      kind: schema.expensePaymentMethods.kind,
      emoji: schema.expensePaymentMethods.emoji,
      sortOrder: schema.expensePaymentMethods.sortOrder,
      isSystem: schema.expensePaymentMethods.isSystem,
      status: schema.expensePaymentMethods.status,
    })
    .from(schema.expensePaymentMethods)
    .where(and(...(conditions as [(typeof conditions)[0], ...typeof conditions])))
    .orderBy(
      asc(schema.expensePaymentMethods.sortOrder),
      asc(schema.expensePaymentMethods.name),
    );

  return c.json({ paymentMethods });
});

/** POST /expense-payment-methods */
expensePaymentMethodRoutes.post("/", requireSession, zv(createSchema), async (c) => {
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);

  const existing = await db
    .select({
      slug: schema.expensePaymentMethods.slug,
      sortOrder: schema.expensePaymentMethods.sortOrder,
    })
    .from(schema.expensePaymentMethods)
    .where(eq(schema.expensePaymentMethods.familyId, data.familyId));

  const slug = ensureUniqueSlug(
    slugify(data.name),
    new Set(existing.map((r) => r.slug)),
  );
  const maxSort = existing.reduce((m, r) => Math.max(m, r.sortOrder), -10);

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(schema.expensePaymentMethods).values({
    id,
    familyId: data.familyId,
    name: data.name.trim(),
    slug,
    kind: data.kind ?? "other",
    emoji: data.emoji,
    sortOrder: data.sortOrder ?? Math.min(maxSort + 10, 100_000),
    isSystem: false,
    updatedAt: now,
  });

  const paymentMethod = await db
    .select()
    .from(schema.expensePaymentMethods)
    .where(eq(schema.expensePaymentMethods.id, id))
    .get();

  return c.json({ paymentMethod }, 201);
});

/** PATCH /expense-payment-methods/:id — rename, re-emoji, re-kind, reorder, archive/restore. */
expensePaymentMethodRoutes.patch("/:id", requireSession, zv(updateSchema), async (c) => {
  const { id } = c.req.param();
  const updates = c.req.valid("json");
  const db = getDb(c.env);

  const method = await db
    .select()
    .from(schema.expensePaymentMethods)
    .where(eq(schema.expensePaymentMethods.id, id))
    .get();

  if (!method) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, method.familyId);
  if (membership instanceof Response) return membership;

  const set: Partial<typeof schema.expensePaymentMethods.$inferInsert> = {
    updatedAt: Math.floor(Date.now() / 1000),
  };
  // The slug is identity, not display — renaming leaves it alone.
  if (updates.name !== undefined) set.name = updates.name.trim();
  if (updates.emoji !== undefined) set.emoji = updates.emoji;
  if (updates.kind !== undefined) set.kind = updates.kind;
  if (updates.sortOrder !== undefined) set.sortOrder = updates.sortOrder;
  if (updates.status !== undefined) set.status = updates.status;

  await db
    .update(schema.expensePaymentMethods)
    .set(set)
    .where(eq(schema.expensePaymentMethods.id, id));

  const paymentMethod = await db
    .select()
    .from(schema.expensePaymentMethods)
    .where(eq(schema.expensePaymentMethods.id, id))
    .get();

  return c.json({ paymentMethod });
});

/** POST /expense-payment-methods/reorder */
expensePaymentMethodRoutes.post("/reorder", requireSession, zv(reorderSchema), async (c) => {
  const { familyId, items } = c.req.valid("json");

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const ids = items.map((i) => i.id);

  const owned = await db
    .select({ id: schema.expensePaymentMethods.id })
    .from(schema.expensePaymentMethods)
    .where(
      and(
        eq(schema.expensePaymentMethods.familyId, familyId),
        inArray(schema.expensePaymentMethods.id, ids),
      ),
    );

  if (owned.length !== new Set(ids).size) {
    return c.json({ error: "invalid_payment_method_ids" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  for (const item of items) {
    await db
      .update(schema.expensePaymentMethods)
      .set({ sortOrder: item.sortOrder, updatedAt: now })
      .where(eq(schema.expensePaymentMethods.id, item.id));
  }

  return c.json({ ok: true });
});

/**
 * DELETE /expense-payment-methods/:id — only for a custom method no expense has
 * ever used. Everything else archives, so historical rows keep resolving.
 */
expensePaymentMethodRoutes.delete("/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const db = getDb(c.env);

  const method = await db
    .select()
    .from(schema.expensePaymentMethods)
    .where(eq(schema.expensePaymentMethods.id, id))
    .get();

  if (!method) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, method.familyId);
  if (membership instanceof Response) return membership;

  if (method.isSystem) {
    return c.json({ error: "cannot_delete_system_payment_method" }, 403);
  }

  const used = await db
    .select({ id: schema.expenses.id })
    .from(schema.expenses)
    .where(eq(schema.expenses.paymentMethodId, id))
    .get();
  if (used) return c.json({ error: "payment_method_in_use" }, 400);

  await db
    .delete(schema.expensePaymentMethods)
    .where(eq(schema.expensePaymentMethods.id, id));

  return c.json({ ok: true });
});
