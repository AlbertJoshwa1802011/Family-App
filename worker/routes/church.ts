/**
 * Church fund snapshot + settlements.
 *
 * Live collected / spent numbers come from the contributions Pages app.
 * This Worker stores settlement payments the family records here, including
 * partial payments with carry-forward (due − paid).
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, gt } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { isPlatformAdmin } from "../middleware/requirePlatformAdmin";
import { insertAuditEvent } from "../lib/audit";
import {
  contributionsConfigured,
  fetchChurchFunds,
  fetchChurchPurchases,
  isSuperAdminOnlyChurchFund,
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

/** Sum of unpaid carry (remainingMinor > 0) per fund slug. */
function outstandingByFund(
  settlements: { fundSlug: string; remainingMinor: number }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of settlements) {
    if (s.remainingMinor <= 0) continue;
    map.set(s.fundSlug, (map.get(s.fundSlug) ?? 0) + s.remainingMinor);
  }
  return map;
}

churchRoutes.get("/snapshot", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);
  const membership = await requireFamilyMember(c, familyId, "member", "expenses");
  if (membership instanceof Response) return membership;

  if (!contributionsConfigured(c.env)) {
    return c.json(
      {
        error: "church_not_configured",
        message:
          "Church funds URL is not set on this Worker. Production uses CONTRIBUTIONS_API_URL in wrangler.jsonc; after deploy, reload Money → Funds.",
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
    const message =
      fundsRes.error === "church_auth_failed"
        ? "The contributions site rejected the Worker token. Re-set CONTRIBUTIONS_API_TOKEN on Worker fam to match ADMIN_API_TOKEN."
        : fundsRes.error === "church_unreachable"
          ? "Could not reach the contributions site. Check CONTRIBUTIONS_API_URL."
          : "Church contributions returned an error. Try again in a minute.";
    return c.json({ error: fundsRes.error, message, configured: true }, status);
  }
  const purchasesRes = await fetchChurchPurchases(c.env);
  const purchases = purchasesRes.ok ? purchasesRes.purchases : [];

  const db = getDb(c.env);
  const userId = c.get("userId")!;
  const canSeeRestricted = await isPlatformAdmin(db, c.env, userId);

  const visibleUpstreamFunds = canSeeRestricted
    ? fundsRes.funds
    : fundsRes.funds.filter((f) => !isSuperAdminOnlyChurchFund(f));
  const restrictedSlugs = new Set(
    fundsRes.funds
      .filter((f) => isSuperAdminOnlyChurchFund(f))
      .map((f) => f.slug),
  );

  const settlements = await db
    .select()
    .from(schema.churchSettlements)
    .where(eq(schema.churchSettlements.familyId, familyId))
    .orderBy(desc(schema.churchSettlements.settledAt));

  const visibleSettlements = canSeeRestricted
    ? settlements
    : settlements.filter((s) => !restrictedSlugs.has(s.fundSlug));

  const outstanding = outstandingByFund(visibleSettlements);
  const funds = visibleUpstreamFunds.map((f) => {
    const outstandingMinor = outstanding.get(f.slug) ?? 0;
    const availableMinor = rupeesToMinor(f.availableBalance);
    // Prefer unpaid carry when present; otherwise suggest live available.
    const suggestedDueMinor =
      outstandingMinor > 0 ? outstandingMinor : availableMinor;
    return {
      ...f,
      outstandingMinor,
      suggestedDueMinor,
    };
  });

  const visiblePurchases = canSeeRestricted
    ? purchases
    : purchases.filter(
        (p) =>
          !restrictedSlugs.has(p.fund) &&
          !isSuperAdminOnlyChurchFund({ slug: p.fund }),
      );

  return c.json({
    configured: true,
    currency: fundsRes.currency,
    funds,
    purchases: visiblePurchases,
    settlements: visibleSettlements,
  });
});

const settleFieldsSchema = z.object({
  familyId: z.string().min(1),
  fundSlug: z.string().min(1).max(80),
  periodKey: z.string().regex(/^\d{4}-\d{2}$/, "Must be yyyy-mm"),
  /** Total due for this payment in minor units (paise). */
  dueMinor: z.number().int().positive().max(1_000_000_000_000),
  /** Amount paid now in minor units. Must be ≤ dueMinor. */
  paidMinor: z.number().int().positive().max(1_000_000_000_000),
  note: z.string().max(2000).optional().nullable(),
});

const settleSchema = settleFieldsSchema.refine(
  (d) => d.paidMinor <= d.dueMinor,
  { message: "paidMinor must be ≤ dueMinor", path: ["paidMinor"] },
);

churchRoutes.post("/settle", requireSession, zv(settleSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");
  const membership = await requireFamilyMember(c, data.familyId, "member", "expenses");
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
  if (isSuperAdminOnlyChurchFund(fund)) {
    if (!(await isPlatformAdmin(db, c.env, userId))) {
      // Same shape as unknown fund — do not reveal restricted pots exist.
      return c.json({ error: "not_found" }, 404);
    }
  }
  const collectedMinor = rupeesToMinor(fund.totalCollected);
  const spentMinor = rupeesToMinor(fund.spentOnProducts);
  const dueMinor = data.dueMinor;
  const paidMinor = data.paidMinor;
  const remainingMinor = dueMinor - paidMinor;
  const id = crypto.randomUUID();
  const settledAt = Math.floor(Date.now() / 1000);

  // Roll prior carry into this payment: only the newest row keeps an open
  // remaining balance so "still to settle" does not double-count history.
  await db
    .update(schema.churchSettlements)
    .set({ remainingMinor: 0 })
    .where(
      and(
        eq(schema.churchSettlements.familyId, data.familyId),
        eq(schema.churchSettlements.fundSlug, data.fundSlug),
        gt(schema.churchSettlements.remainingMinor, 0),
      ),
    );

  await db.insert(schema.churchSettlements).values({
    id,
    familyId: data.familyId,
    fundSlug: data.fundSlug,
    periodKey: data.periodKey,
    collectedMinor,
    spentMinor,
    dueMinor,
    paidMinor,
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
    meta: {
      fundSlug: data.fundSlug,
      periodKey: data.periodKey,
      dueMinor,
      paidMinor,
      remainingMinor,
    },
  });

  const settlement = await db
    .select()
    .from(schema.churchSettlements)
    .where(eq(schema.churchSettlements.id, id))
    .get();

  return c.json({ settlement }, 201);
});
