/**
 * Wishlist — things you want to buy, ranked, with an honest answer to
 * "when can I afford this?" derived from the current monthly surplus.
 *
 * Same privacy rule as expenses: owned by its creator, private by default,
 * no owner/admin bypass, hidden rows 404.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq, or } from "drizzle-orm";
import type { AppContext, HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { MAX_AMOUNT_MINOR } from "../lib/money";
import { monthsToAfford } from "../lib/finance/plan";
import { addMonths } from "../lib/finance/periods";

export const wishlistRoutes = new Hono<HonoEnv>();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-mm-dd");
const currencyCode = z.string().regex(/^[A-Z]{3}$/, "Must be an ISO 4217 currency code");

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

const baseSchema = z.object({
  familyId: z.string().min(1),
  name: z.string().min(1).max(160),
  notes: z.string().max(2000).nullable().optional(),
  url: z.string().url().max(2000).nullable().optional(),
  estimatedCostMinor: z.number().int().positive().lt(MAX_AMOUNT_MINOR),
  currency: currencyCode,
  // 1 = highest. A short fixed scale keeps the ordering meaningful.
  priority: z.number().int().min(1).max(5).default(3),
  targetDate: isoDate.nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  visibility: z.enum(["family", "private"]).default("private"),
});

const createSchema = baseSchema;
const updateSchema = baseSchema
  .omit({ familyId: true })
  .partial()
  .extend({ status: z.enum(["wanted", "saving", "purchased", "dropped"]).optional() });

function visibleTo(familyId: string, userId: string) {
  return and(
    eq(schema.wishlistItems.familyId, familyId),
    or(
      eq(schema.wishlistItems.visibility, "family"),
      eq(schema.wishlistItems.ownerUserId, userId),
    ),
  );
}

/**
 * GET /wishlist?familyId=…&surplusMinor=…
 *
 * `surplusMinor` (from the finance overview) turns each item into a plan:
 * months of saving needed and the date it becomes affordable. Items are
 * returned highest-priority first, cheapest first within a priority — the
 * order you'd actually buy them in.
 */
wishlistRoutes.get("/", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const familyId = c.req.query("familyId");
  if (!familyId) return invalid(c, ["familyId"], "familyId is required");

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const surplusRaw = Number(c.req.query("surplusMinor") ?? 0);
  const surplusMinor = Number.isFinite(surplusRaw) ? Math.trunc(surplusRaw) : 0;
  const today = new Date().toISOString().slice(0, 10);

  const db = getDb(c.env);
  let where = visibleTo(familyId, userId);
  const status = c.req.query("status");
  if (status === "wanted" || status === "saving" || status === "purchased" || status === "dropped") {
    where = and(where, eq(schema.wishlistItems.status, status));
  }

  const rows = await db.select().from(schema.wishlistItems).where(where);

  // Cumulative: you can't save for the second thing until the first is bought,
  // so affordability compounds down the priority order.
  const ordered = rows.sort(
    (a, b) => a.priority - b.priority || a.estimatedCostMinor - b.estimatedCostMinor,
  );

  let runningCost = 0;
  const items = ordered.map((r) => {
    const active = r.status === "wanted" || r.status === "saving";
    if (active) runningCost += r.estimatedCostMinor;
    const months = active ? monthsToAfford(runningCost, surplusMinor) : null;
    return {
      ...r,
      monthsToAfford: months,
      affordableFrom: months === null ? null : addMonths(today, months),
    };
  });

  const totalWantedMinor = ordered
    .filter((r) => r.status === "wanted" || r.status === "saving")
    .reduce((s, r) => s + r.estimatedCostMinor, 0);

  return c.json({ items, totalWantedMinor, surplusMinor });
});

wishlistRoutes.post("/", requireSession, zv(createSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const family = await db
    .select({ currency: schema.families.defaultCurrency })
    .from(schema.families)
    .where(eq(schema.families.id, data.familyId))
    .get();
  if (!family) return c.json({ error: "not_found" }, 404);
  if (data.currency !== family.currency) {
    return invalid(c, ["currency"], `must match the family currency (${family.currency})`);
  }

  const id = crypto.randomUUID();
  await db.insert(schema.wishlistItems).values({
    id,
    familyId: data.familyId,
    ownerUserId: userId,
    name: data.name.trim(),
    notes: data.notes ?? null,
    url: data.url ?? null,
    estimatedCostMinor: data.estimatedCostMinor,
    currency: data.currency,
    priority: data.priority,
    targetDate: data.targetDate ?? null,
    categoryId: data.categoryId ?? null,
    visibility: data.visibility,
  });

  const item = await db
    .select()
    .from(schema.wishlistItems)
    .where(eq(schema.wishlistItems.id, id))
    .get();
  return c.json({ item }, 201);
});

wishlistRoutes.get("/:id", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "not_found" }, 404);

  const db = getDb(c.env);
  const row = await db
    .select()
    .from(schema.wishlistItems)
    .where(eq(schema.wishlistItems.id, id))
    .get();
  if (!row) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, row.familyId);
  if (membership instanceof Response) return membership;
  if (row.visibility === "private" && row.ownerUserId !== userId) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({ item: row });
});

wishlistRoutes.patch("/:id", requireSession, zv(updateSchema), async (c) => {
  const userId = c.get("userId")!;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "not_found" }, 404);
  const data = c.req.valid("json");
  const db = getDb(c.env);

  const row = await db
    .select()
    .from(schema.wishlistItems)
    .where(eq(schema.wishlistItems.id, id))
    .get();
  if (!row) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, row.familyId);
  if (membership instanceof Response) return membership;
  if (row.visibility === "private" && row.ownerUserId !== userId) {
    return c.json({ error: "not_found" }, 404);
  }
  if (row.ownerUserId !== userId) return c.json({ error: "forbidden" }, 403);

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(schema.wishlistItems)
    .set({
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      ...(data.url !== undefined ? { url: data.url } : {}),
      ...(data.estimatedCostMinor !== undefined
        ? { estimatedCostMinor: data.estimatedCostMinor }
        : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.targetDate !== undefined ? { targetDate: data.targetDate } : {}),
      ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
      ...(data.visibility !== undefined ? { visibility: data.visibility } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.status === "purchased" ? { purchasedAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(schema.wishlistItems.id, id));

  const item = await db
    .select()
    .from(schema.wishlistItems)
    .where(eq(schema.wishlistItems.id, id))
    .get();
  return c.json({ item });
});

wishlistRoutes.delete("/:id", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "not_found" }, 404);
  const db = getDb(c.env);

  const row = await db
    .select()
    .from(schema.wishlistItems)
    .where(eq(schema.wishlistItems.id, id))
    .get();
  if (!row) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, row.familyId);
  if (membership instanceof Response) return membership;
  if (row.visibility === "private" && row.ownerUserId !== userId) {
    return c.json({ error: "not_found" }, 404);
  }
  if (row.ownerUserId !== userId) return c.json({ error: "forbidden" }, 403);

  await db.delete(schema.wishlistItems).where(eq(schema.wishlistItems.id, id));
  return c.json({ ok: true });
});
