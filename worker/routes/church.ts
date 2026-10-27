/**
 * Church fund snapshot + settlements.
 *
 * Live collected / spent numbers come from the contributions Pages app.
 * This Worker stores who the money was handed to (e.g. Mom), exactly when,
 * and when that person passed it on to church. "Still with you" is always
 * computed live — see worker/lib/churchLedger.ts.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AppContext, Env, HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { isPlatformAdmin } from "../middleware/requirePlatformAdmin";
import { insertAuditEvent } from "../lib/audit";
import { computeChurchLedger } from "../lib/churchLedger";
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

type Db = ReturnType<typeof getDb>;

async function loadRecipients(db: Db, familyId: string) {
  return db
    .select()
    .from(schema.settlementDestinations)
    .where(eq(schema.settlementDestinations.familyId, familyId))
    .orderBy(
      asc(schema.settlementDestinations.sortOrder),
      asc(schema.settlementDestinations.name),
    );
}

async function loadSettlements(db: Db, familyId: string) {
  return db
    .select({
      id: schema.churchSettlements.id,
      familyId: schema.churchSettlements.familyId,
      fundSlug: schema.churchSettlements.fundSlug,
      periodKey: schema.churchSettlements.periodKey,
      collectedMinor: schema.churchSettlements.collectedMinor,
      spentMinor: schema.churchSettlements.spentMinor,
      dueMinor: schema.churchSettlements.dueMinor,
      paidMinor: schema.churchSettlements.paidMinor,
      remainingMinor: schema.churchSettlements.remainingMinor,
      settledAt: schema.churchSettlements.settledAt,
      settledByUserId: schema.churchSettlements.settledByUserId,
      recipientId: schema.churchSettlements.recipientId,
      handedOverAt: schema.churchSettlements.handedOverAt,
      note: schema.churchSettlements.note,
      createdAt: schema.churchSettlements.createdAt,
      settledByName: sql<string | null>`${schema.users.name}`.as("settled_by_name"),
    })
    .from(schema.churchSettlements)
    .leftJoin(schema.users, eq(schema.churchSettlements.settledByUserId, schema.users.id))
    .where(eq(schema.churchSettlements.familyId, familyId))
    .orderBy(
      desc(schema.churchSettlements.settledAt),
      desc(schema.churchSettlements.createdAt),
    );
}

/**
 * Slugs hidden from non super-admins. Uses the live fund list when reachable
 * (name-based matches), else falls back to the slug heuristic alone.
 */
async function restrictedSlugMatcher(env: Env) {
  const res = contributionsConfigured(env) ? await fetchChurchFunds(env) : null;
  const names = new Map(res?.ok ? res.funds.map((f) => [f.slug, f.name]) : []);
  return (slug: string) =>
    isSuperAdminOnlyChurchFund({ slug, name: names.get(slug) ?? null });
}

/** Load a settlement the caller may change (creator or admin/owner). */
async function loadEditableSettlement(c: AppContext, id: string) {
  const db = getDb(c.env);
  const row = await db
    .select()
    .from(schema.churchSettlements)
    .where(eq(schema.churchSettlements.id, id))
    .get();
  if (!row) return c.json({ error: "not_found" }, 404);
  const membership = await requireFamilyMember(c, row.familyId, "member", "expenses");
  if (membership instanceof Response) return membership;
  const userId = c.get("userId")!;
  const isRestricted = await restrictedSlugMatcher(c.env);
  if (isRestricted(row.fundSlug) && !(await isPlatformAdmin(db, c.env, userId))) {
    return c.json({ error: "not_found" }, 404);
  }
  if (row.settledByUserId !== userId && membership.role === "member") {
    return c.json({ error: "forbidden" }, 403);
  }
  return row;
}

async function assertRecipient(db: Db, familyId: string, recipientId: string) {
  const dest = await db
    .select()
    .from(schema.settlementDestinations)
    .where(eq(schema.settlementDestinations.id, recipientId))
    .get();
  if (!dest || dest.familyId !== familyId) return "invalid_recipient_id" as const;
  if (dest.archivedAt !== null) return "recipient_archived" as const;
  return dest;
}

function periodOf(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 7);
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** A real instant: after 2020, and not more than 5 min in the future (clock skew). */
const instantSchema = z
  .number()
  .int()
  .min(1_577_836_800)
  .refine((v) => v <= nowSec() + 300, { message: "Cannot be in the future" });

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

  const [settlements, recipients] = await Promise.all([
    loadSettlements(db, familyId),
    loadRecipients(db, familyId),
  ]);

  const visibleSettlements = canSeeRestricted
    ? settlements
    : settlements.filter(
        (s) =>
          !restrictedSlugs.has(s.fundSlug) &&
          !isSuperAdminOnlyChurchFund({ slug: s.fundSlug }),
      );

  const ledger = computeChurchLedger(
    visibleUpstreamFunds.map((f) => ({
      slug: f.slug,
      name: f.name,
      collectedMinor: rupeesToMinor(f.totalCollected),
    })),
    visibleSettlements,
    recipients,
  );

  const funds = visibleUpstreamFunds.map((f) => {
    const pos = ledger.funds.get(f.slug)!;
    return {
      ...f,
      collectedMinor: pos.collectedMinor,
      purchasesMinor: rupeesToMinor(f.spentOnProducts),
      settledMinor: pos.settledMinor,
      withYouMinor: pos.withYouMinor,
      overSettledMinor: pos.overSettledMinor,
      lastSettledAt: pos.lastSettledAt,
      // Back-compat aliases for older clients: both are the live figure now.
      outstandingMinor: pos.withYouMinor,
      suggestedDueMinor: pos.withYouMinor,
    };
  });

  const visiblePurchases = canSeeRestricted
    ? purchases
    : purchases.filter(
        (p) =>
          !restrictedSlugs.has(p.fund) &&
          !isSuperAdminOnlyChurchFund({ slug: p.fund }),
      );

  const fundName = new Map(fundsRes.funds.map((f) => [f.slug, f.name]));
  const recipientName = new Map(recipients.map((r) => [r.id, r.name]));

  return c.json({
    configured: true,
    currency: fundsRes.currency,
    fetchedAt: nowSec(),
    totals: ledger.totals,
    funds,
    holders: ledger.holders,
    recipients: recipients
      .filter((r) => r.archivedAt === null)
      .map((r) => ({ id: r.id, name: r.name, kind: r.kind })),
    purchases: visiblePurchases,
    settlements: visibleSettlements.map((s) => ({
      ...s,
      fundName: fundName.get(s.fundSlug) ?? s.fundSlug,
      recipientName: s.recipientId ? (recipientName.get(s.recipientId) ?? null) : null,
    })),
  });
});

const settleSchema = z.object({
  familyId: z.string().min(1),
  fundSlug: z.string().min(1).max(80),
  /** Amount handed over now, minor units (paise). */
  paidMinor: z.number().int().positive().max(1_000_000_000_000),
  /** Who received it (settlement destination id, e.g. Mom). */
  recipientId: z.string().min(1),
  /** Exact instant handed over; defaults to now. */
  settledAt: instantSchema.optional(),
  note: z.string().max(2000).optional().nullable(),
  // Legacy client fields — accepted and ignored; the server computes the due
  // from live data so a stale client can never freeze a wrong carry.
  periodKey: z.string().regex(/^\d{4}-\d{2}$/, "Must be yyyy-mm").optional(),
  dueMinor: z.number().int().positive().optional(),
});

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

  const recipient = await assertRecipient(db, data.familyId, data.recipientId);
  if (typeof recipient === "string") return c.json({ error: recipient }, 400);

  const collectedMinor = rupeesToMinor(fund.totalCollected);
  const spentMinor = rupeesToMinor(fund.spentOnProducts);
  const prior = await db
    .select({ paid: sql<number>`coalesce(sum(${schema.churchSettlements.paidMinor}), 0)` })
    .from(schema.churchSettlements)
    .where(
      and(
        eq(schema.churchSettlements.familyId, data.familyId),
        eq(schema.churchSettlements.fundSlug, data.fundSlug),
      ),
    )
    .get();
  // Snapshot of what was with you just before this payment (audit only).
  const dueMinor = Math.max(collectedMinor - Number(prior?.paid ?? 0), 0);
  const paidMinor = data.paidMinor;
  const remainingMinor = Math.max(dueMinor - paidMinor, 0);
  const id = crypto.randomUUID();
  const settledAt = data.settledAt ?? nowSec();

  await db.insert(schema.churchSettlements).values({
    id,
    familyId: data.familyId,
    fundSlug: data.fundSlug,
    periodKey: periodOf(settledAt),
    collectedMinor,
    spentMinor,
    dueMinor,
    paidMinor,
    remainingMinor,
    settledAt,
    settledByUserId: userId,
    recipientId: recipient.id,
    note: data.note?.trim() || null,
  });

  await insertAuditEvent(db, {
    familyId: data.familyId,
    actorUserId: userId,
    action: "church.settled",
    targetType: "church_settlement",
    targetId: id,
    meta: {
      fundSlug: data.fundSlug,
      recipientId: recipient.id,
      recipientName: recipient.name,
      dueMinor,
      paidMinor,
      settledAt,
    },
  });

  const settlement = await db
    .select()
    .from(schema.churchSettlements)
    .where(eq(schema.churchSettlements.id, id))
    .get();

  return c.json(
    {
      settlement,
      withYouBeforeMinor: dueMinor,
      withYouAfterMinor: remainingMinor,
      overSettledMinor: Math.max(paidMinor - dueMinor, 0),
    },
    201,
  );
});

// Defaults stay off so .partial() never refills absent keys (see CLAUDE.md §6).
const settlementPatchSchema = z
  .object({
    paidMinor: z.number().int().positive().max(1_000_000_000_000),
    recipientId: z.string().min(1),
    settledAt: instantSchema,
    note: z.string().max(2000).nullable(),
    /** true = recipient gave it to church (now); false = undo. */
    handedOver: z.boolean(),
    handedOverAt: instantSchema,
  })
  .partial();

// PATCH /church/settlements/:id — fix amount / recipient / time, mark handed over.
churchRoutes.patch(
  "/settlements/:id",
  requireSession,
  zv(settlementPatchSchema),
  async (c) => {
    const { id } = c.req.param();
    const updates = c.req.valid("json");
    const row = await loadEditableSettlement(c, id);
    if (row instanceof Response) return row;
    const db = getDb(c.env);

    const set: Partial<typeof schema.churchSettlements.$inferInsert> = {};
    if (updates.recipientId !== undefined) {
      const recipient = await assertRecipient(db, row.familyId, updates.recipientId);
      if (typeof recipient === "string") return c.json({ error: recipient }, 400);
      set.recipientId = recipient.id;
    }
    if (updates.paidMinor !== undefined) set.paidMinor = updates.paidMinor;
    if (updates.settledAt !== undefined) {
      set.settledAt = updates.settledAt;
      set.periodKey = periodOf(updates.settledAt);
    }
    if (updates.note !== undefined) set.note = updates.note?.trim() || null;
    if (updates.handedOver === false) set.handedOverAt = null;
    else if (updates.handedOverAt !== undefined) set.handedOverAt = updates.handedOverAt;
    else if (updates.handedOver === true) set.handedOverAt = row.handedOverAt ?? nowSec();

    // Validate the merged state, not just the patch.
    const nextRecipient = set.recipientId ?? row.recipientId;
    const nextHanded = set.handedOverAt !== undefined ? set.handedOverAt : row.handedOverAt;
    const nextSettled = set.settledAt ?? row.settledAt;
    if (nextHanded != null && nextRecipient == null) {
      return c.json({ error: "recipient_required" }, 400);
    }
    if (nextHanded != null && nextHanded < nextSettled) {
      return c.json(
        {
          error: "validation_error",
          issues: [
            {
              code: "custom",
              message: "Handed over before it was settled",
              path: ["handedOverAt"],
            },
          ],
        },
        400,
      );
    }

    if (Object.keys(set).length > 0) {
      await db
        .update(schema.churchSettlements)
        .set(set)
        .where(eq(schema.churchSettlements.id, id));
      await insertAuditEvent(db, {
        familyId: row.familyId,
        actorUserId: c.get("userId")!,
        action: "church.settlement_updated",
        targetType: "church_settlement",
        targetId: id,
        meta: { before: row, changes: set },
      });
    }

    const settlement = await db
      .select()
      .from(schema.churchSettlements)
      .where(eq(schema.churchSettlements.id, id))
      .get();
    return c.json({ settlement });
  },
);

// DELETE /church/settlements/:id — remove a mistaken entry.
churchRoutes.delete("/settlements/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const row = await loadEditableSettlement(c, id);
  if (row instanceof Response) return row;
  const db = getDb(c.env);
  await db.delete(schema.churchSettlements).where(eq(schema.churchSettlements.id, id));
  await insertAuditEvent(db, {
    familyId: row.familyId,
    actorUserId: c.get("userId")!,
    action: "church.settlement_deleted",
    targetType: "church_settlement",
    targetId: id,
    meta: { before: row },
  });
  return c.json({ ok: true });
});

const handoverSchema = z.object({
  familyId: z.string().min(1),
  recipientId: z.string().min(1),
  /** Only these settlements; omit to hand over everything they hold. */
  settlementIds: z.array(z.string().min(1)).min(1).max(500).optional(),
  handedOverAt: instantSchema.optional(),
});

// POST /church/handover — "Mom gave it to church": closes what they hold.
churchRoutes.post("/handover", requireSession, zv(handoverSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");
  const membership = await requireFamilyMember(c, data.familyId, "member", "expenses");
  if (membership instanceof Response) return membership;
  const db = getDb(c.env);

  const recipient = await db
    .select()
    .from(schema.settlementDestinations)
    .where(eq(schema.settlementDestinations.id, data.recipientId))
    .get();
  if (!recipient || recipient.familyId !== data.familyId) {
    return c.json({ error: "invalid_recipient_id" }, 400);
  }

  const canSeeRestricted = await isPlatformAdmin(db, c.env, userId);
  const isRestricted = await restrictedSlugMatcher(c.env);
  const wanted = data.settlementIds ? new Set(data.settlementIds) : null;
  const handedOverAt = data.handedOverAt ?? nowSec();

  const open = (
    await db
      .select()
      .from(schema.churchSettlements)
      .where(
        and(
          eq(schema.churchSettlements.familyId, data.familyId),
          eq(schema.churchSettlements.recipientId, recipient.id),
          isNull(schema.churchSettlements.handedOverAt),
        ),
      )
  ).filter(
    (s) =>
      (canSeeRestricted || !isRestricted(s.fundSlug)) &&
      (!wanted || wanted.has(s.id)) &&
      s.settledAt <= handedOverAt,
  );

  if (open.length === 0) return c.json({ error: "nothing_to_hand_over" }, 400);

  const ids = open.map((s) => s.id);
  await db
    .update(schema.churchSettlements)
    .set({ handedOverAt })
    .where(inArray(schema.churchSettlements.id, ids));

  const amountMinor = open.reduce((sum, s) => sum + s.paidMinor, 0);
  await insertAuditEvent(db, {
    familyId: data.familyId,
    actorUserId: userId,
    action: "church.handed_over",
    targetType: "settlement_destination",
    targetId: recipient.id,
    meta: { recipientName: recipient.name, settlementIds: ids, amountMinor, handedOverAt },
  });

  return c.json({ ok: true, count: ids.length, amountMinor, handedOverAt });
});
