/**
 * Church fund snapshot + settlements.
 *
 * Live collected / spent numbers come from the contributions Pages app.
 * This Worker only stores monthly settlement records the family adds here.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { insertAuditEvent } from "../lib/audit";
import {
  contributionsConfigured,
  fetchChurchFunds,
  fetchChurchPurchases,
  rupeesToMinor,
} from "../lib/contributions";

export const churchRoutes = new Hono<HonoEnv>();

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "validation_error", issues: result.error.issues },
        400,
      );
    }
  });
}

churchRoutes.get("/snapshot", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);
  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  if (!contributionsConfigured(c.env)) {
    return c.json(
      {
        error: "church_not_configured",
        configured: false,
        funds: [],
        purchases: [],
        settlements: [],
      },
      503,
    );
  }

  const fundsRes = await fetchChurchFunds(c.env);
  if (!fundsRes.ok) {
    const status = fundsRes.status === 503 ? 503 : 502;
    return c.json({ error: fundsRes.error, configured: true }, status);
  }
  const purchasesRes = await fetchChurchPurchases(c.env);
  const purchases = purchasesRes.ok ? purchasesRes.purchases : [];

  const db = getDb(c.env);
  const settlements = await db
    .select()
    .from(schema.churchSettlements)
    .where(eq(schema.churchSettlements.familyId, familyId))
    .orderBy(desc(schema.churchSettlements.settledAt));

  return c.json({
    configured: true,
    currency: fundsRes.currency,
    funds: fundsRes.funds,
    purchases,
    settlements,
  });
});

const settleSchema = z.object({
  familyId: z.string().min(1),
  fundSlug: z.string().min(1).max(80),
  periodKey: z.string().regex(/^\d{4}-\d{2}$/, "Must be yyyy-mm"),
  note: z.string().max(2000).optional().nullable(),
});

churchRoutes.post("/settle", requireSession, zv(settleSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");
  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  if (!contributionsConfigured(c.env)) {
    return c.json({ error: "church_not_configured" }, 503);
  }

  const fundsRes = await fetchChurchFunds(c.env);
  if (!fundsRes.ok) {
    const status = fundsRes.status === 503 ? 503 : 502;
    return c.json({ error: fundsRes.error }, status);
  }
  const fund = fundsRes.funds.find((f) => f.slug === data.fundSlug);
  if (!fund) return c.json({ error: "not_found" }, 404);

  const db = getDb(c.env);
  const existing = await db
    .select({ id: schema.churchSettlements.id })
    .from(schema.churchSettlements)
    .where(
      and(
        eq(schema.churchSettlements.familyId, data.familyId),
        eq(schema.churchSettlements.fundSlug, data.fundSlug),
        eq(schema.churchSettlements.periodKey, data.periodKey),
      ),
    )
    .get();
  if (existing) {
    return c.json({ error: "already_settled", periodKey: data.periodKey }, 409);
  }

  const collectedMinor = rupeesToMinor(fund.totalCollected);
  const spentMinor = rupeesToMinor(fund.spentOnProducts);
  const remainingMinor = rupeesToMinor(fund.availableBalance);
  const id = crypto.randomUUID();
  const settledAt = Math.floor(Date.now() / 1000);

  await db.insert(schema.churchSettlements).values({
    id,
    familyId: data.familyId,
    fundSlug: data.fundSlug,
    periodKey: data.periodKey,
    collectedMinor,
    spentMinor,
    remainingMinor,
    settledAt,
    settledByUserId: userId,
    note: data.note ?? null,
  });

  await insertAuditEvent(db, {
    familyId: data.familyId,
    actorUserId: userId,
    action: "church.settled",
    targetType: "church_settlement",
    targetId: id,
    meta: { fundSlug: data.fundSlug, periodKey: data.periodKey },
  });

  const settlement = await db
    .select()
    .from(schema.churchSettlements)
    .where(eq(schema.churchSettlements.id, id))
    .get();

  return c.json({ settlement }, 201);
});
