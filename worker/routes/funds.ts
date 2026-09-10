/**
 * Church / collection funds — a manual audit ledger for sensitive shared pots.
 *
 * Typical flow: Razorpay (or cash) contributions land in a member's bank;
 * spends happen during the month; at month start they settle/reconcile.
 * Every mutation writes both fund_activity and the family audit_log.
 *
 * Authz: any family member may read and write (including settle) — church
 * treasurers are often regular members, not admins.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema, type Db } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { insertAuditEvent } from "../lib/audit";
import { MAX_AMOUNT_MINOR } from "../lib/money";

export const fundRoutes = new Hono<HonoEnv>();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-mm-dd");
const periodKey = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "Must be yyyy-mm");
const currencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, "Must be an ISO 4217 currency code");
const amount = z.number().int().positive().lt(MAX_AMOUNT_MINOR);

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

type FundRow = typeof schema.fundAccounts.$inferSelect;

async function loadFund(db: Db, id: string): Promise<FundRow | undefined> {
  return db
    .select()
    .from(schema.fundAccounts)
    .where(eq(schema.fundAccounts.id, id))
    .get();
}

async function requireFundMember(
  c: Parameters<typeof requireFamilyMember>[0],
  fundId: string,
  opts: { allowArchived?: boolean } = {},
) {
  const db = getDb(c.env);
  const fund = await loadFund(db, fundId);
  if (!fund) {
    return { error: Response.json({ error: "not_found" }, { status: 404 }) as Response };
  }
  if (!opts.allowArchived && fund.status === "archived") {
    return { error: Response.json({ error: "not_found" }, { status: 404 }) as Response };
  }
  const membership = await requireFamilyMember(c, fund.familyId);
  if (membership instanceof Response) return { error: membership };
  return { db, fund, membership };
}

async function recordFundActivity(
  db: Db,
  opts: {
    fundId: string;
    familyId: string;
    actorUserId: string;
    action: string;
    targetType?: string;
    targetId?: string;
    meta?: Record<string, unknown>;
  },
) {
  await db.insert(schema.fundActivity).values({
    id: crypto.randomUUID(),
    fundId: opts.fundId,
    familyId: opts.familyId,
    actorUserId: opts.actorUserId,
    action: opts.action,
    targetType: opts.targetType ?? null,
    targetId: opts.targetId ?? null,
    metaJson: opts.meta ? JSON.stringify(opts.meta) : null,
  });
  await insertAuditEvent(db, {
    familyId: opts.familyId,
    actorUserId: opts.actorUserId,
    action: `fund.${opts.action}`,
    targetType: opts.targetType ?? "fund",
    targetId: opts.targetId ?? opts.fundId,
    meta: opts.meta,
    visibility: "family",
  });
}

async function fundBalances(db: Db, fundId: string) {
  const contrib = await db
    .select({
      total: sql<number>`coalesce(sum(${schema.fundContributions.amountMinor}), 0)`,
    })
    .from(schema.fundContributions)
    .where(eq(schema.fundContributions.fundId, fundId))
    .get();
  const spends = await db
    .select({
      total: sql<number>`coalesce(sum(${schema.fundSpends.amountMinor}), 0)`,
    })
    .from(schema.fundSpends)
    .where(eq(schema.fundSpends.fundId, fundId))
    .get();

  const contributionsMinor = Number(contrib?.total ?? 0);
  const spendsMinor = Number(spends?.total ?? 0);

  const lastSettlement = await db
    .select({
      periodKey: schema.fundSettlements.periodKey,
      settledAt: schema.fundSettlements.settledAt,
    })
    .from(schema.fundSettlements)
    .where(eq(schema.fundSettlements.fundId, fundId))
    .orderBy(desc(schema.fundSettlements.settledAt))
    .limit(1)
    .get();

  // unsettledSince: day after last settled period end, or earliest
  // contribution/spend when never settled.
  let unsettledSince: string | null;
  if (lastSettlement) {
    const [y, m] = lastSettlement.periodKey.split("-").map(Number);
    const next = new Date(Date.UTC(y, m, 1)); // m is 1-indexed → next month
    unsettledSince = next.toISOString().slice(0, 10);
  } else {
    const earliestContrib = await db
      .select({ paidAt: schema.fundContributions.paidAt })
      .from(schema.fundContributions)
      .where(eq(schema.fundContributions.fundId, fundId))
      .orderBy(schema.fundContributions.paidAt)
      .limit(1)
      .get();
    const earliestSpend = await db
      .select({ spendDate: schema.fundSpends.spendDate })
      .from(schema.fundSpends)
      .where(eq(schema.fundSpends.fundId, fundId))
      .orderBy(schema.fundSpends.spendDate)
      .limit(1)
      .get();
    const dates: string[] = [];
    if (earliestContrib) {
      dates.push(new Date(earliestContrib.paidAt * 1000).toISOString().slice(0, 10));
    }
    if (earliestSpend) dates.push(earliestSpend.spendDate);
    dates.sort();
    unsettledSince = dates[0] ?? null;
  }

  return {
    contributionsMinor,
    spendsMinor,
    remainingMinor: contributionsMinor - spendsMinor,
    unsettledSince,
    lastSettledPeriodKey: lastSettlement?.periodKey ?? null,
  };
}

async function familyCurrency(db: Db, familyId: string): Promise<string> {
  const row = await db
    .select({ c: schema.families.defaultCurrency })
    .from(schema.families)
    .where(eq(schema.families.id, familyId))
    .get();
  return row?.c ?? "USD";
}

// ── List / create ────────────────────────────────────────────────────────────

const createFundSchema = z.object({
  familyId: z.string().min(1),
  name: z.string().min(1).max(120),
  currency: currencyCode.optional(),
  notes: z.string().max(2000).optional().nullable(),
});

fundRoutes.get("/", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const includeArchived = c.req.query("includeArchived") === "1";
  const rows = await db
    .select()
    .from(schema.fundAccounts)
    .where(
      and(
        eq(schema.fundAccounts.familyId, familyId),
        includeArchived ? undefined : eq(schema.fundAccounts.status, "active"),
      ),
    )
    .orderBy(desc(schema.fundAccounts.createdAt));

  const funds = await Promise.all(
    rows.map(async (f) => ({
      ...f,
      balances: await fundBalances(db, f.id),
    })),
  );

  return c.json({ funds });
});

fundRoutes.post("/", requireSession, zv(createFundSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const currency = data.currency ?? (await familyCurrency(db, data.familyId));
  if (data.currency) {
    const familyDefault = await familyCurrency(db, data.familyId);
    if (data.currency !== familyDefault) {
      return c.json(
        {
          error: "validation_error",
          issues: [
            {
              code: "custom",
              path: ["currency"],
              message: `currency must match family default (${familyDefault})`,
            },
          ],
        },
        400,
      );
    }
  }

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db.insert(schema.fundAccounts).values({
    id,
    familyId: data.familyId,
    name: data.name.trim(),
    currency,
    notes: data.notes ?? null,
    status: "active",
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  });

  await recordFundActivity(db, {
    fundId: id,
    familyId: data.familyId,
    actorUserId: userId,
    action: "fund_created",
    targetType: "fund",
    targetId: id,
    meta: { name: data.name.trim() },
  });

  const fund = await loadFund(db, id);
  return c.json(
    { fund: { ...fund!, balances: await fundBalances(db, id) } },
    201,
  );
});

// ── Detail ───────────────────────────────────────────────────────────────────

fundRoutes.get("/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const loaded = await requireFundMember(c, id, { allowArchived: true });
  if ("error" in loaded && loaded.error) return loaded.error;
  const { db, fund } = loaded as { db: Db; fund: FundRow };

  return c.json({
    fund: {
      ...fund,
      balances: await fundBalances(db, fund.id),
    },
  });
});

// ── Contributions ────────────────────────────────────────────────────────────

const createContributionSchema = z.object({
  payerName: z.string().min(1).max(120),
  payerMemberId: z.string().min(1).optional().nullable(),
  amountMinor: amount,
  currency: currencyCode.optional(),
  paidAt: z.number().int().positive().optional(),
  note: z.string().max(2000).optional().nullable(),
  externalRef: z.string().max(200).optional().nullable(),
});

fundRoutes.get("/:id/contributions", requireSession, async (c) => {
  const { id } = c.req.param();
  const loaded = await requireFundMember(c, id);
  if ("error" in loaded && loaded.error) return loaded.error;
  const { db, fund } = loaded as { db: Db; fund: FundRow };

  const from = c.req.query("from");
  const to = c.req.query("to");
  for (const [name, value] of [
    ["from", from],
    ["to", to],
  ] as const) {
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

  let where = eq(schema.fundContributions.fundId, fund.id);
  if (from) {
    const fromSecs = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
    where = and(where, gte(schema.fundContributions.paidAt, fromSecs))!;
  }
  if (to) {
    const toSecs = Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000);
    where = and(where, lte(schema.fundContributions.paidAt, toSecs))!;
  }

  const contributions = await db
    .select()
    .from(schema.fundContributions)
    .where(where)
    .orderBy(desc(schema.fundContributions.paidAt));

  return c.json({ contributions });
});

fundRoutes.post(
  "/:id/contributions",
  requireSession,
  zv(createContributionSchema),
  async (c) => {
    const userId = c.get("userId")!;
    const { id } = c.req.param();
    const data = c.req.valid("json");
    const loaded = await requireFundMember(c, id);
    if ("error" in loaded && loaded.error) return loaded.error;
    const { db, fund } = loaded as { db: Db; fund: FundRow };

    const currency = data.currency ?? fund.currency;
    if (currency !== fund.currency) {
      return c.json(
        {
          error: "validation_error",
          issues: [
            {
              code: "custom",
              path: ["currency"],
              message: `currency must match fund (${fund.currency})`,
            },
          ],
        },
        400,
      );
    }

    if (data.payerMemberId) {
      const member = await db
        .select({ id: schema.familyMembers.id })
        .from(schema.familyMembers)
        .where(
          and(
            eq(schema.familyMembers.id, data.payerMemberId),
            eq(schema.familyMembers.familyId, fund.familyId),
          ),
        )
        .get();
      if (!member) {
        return c.json({ error: "invalid_member_ids" }, 400);
      }
    }

    const contribId = crypto.randomUUID();
    const paidAt = data.paidAt ?? Math.floor(Date.now() / 1000);
    await db.insert(schema.fundContributions).values({
      id: contribId,
      fundId: fund.id,
      familyId: fund.familyId,
      payerName: data.payerName.trim(),
      payerMemberId: data.payerMemberId ?? null,
      amountMinor: data.amountMinor,
      currency,
      paidAt,
      note: data.note ?? null,
      externalRef: data.externalRef ?? null,
      createdByUserId: userId,
    });

    await recordFundActivity(db, {
      fundId: fund.id,
      familyId: fund.familyId,
      actorUserId: userId,
      action: "contribution_added",
      targetType: "fund_contribution",
      targetId: contribId,
      meta: {
        amountMinor: data.amountMinor,
        payerName: data.payerName.trim(),
      },
    });

    const contribution = await db
      .select()
      .from(schema.fundContributions)
      .where(eq(schema.fundContributions.id, contribId))
      .get();
    return c.json({ contribution }, 201);
  },
);

// ── Spends ───────────────────────────────────────────────────────────────────

const createSpendSchema = z.object({
  amountMinor: amount,
  currency: currencyCode.optional(),
  spendDate: isoDate,
  merchant: z.string().max(200).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
});

fundRoutes.get("/:id/spends", requireSession, async (c) => {
  const { id } = c.req.param();
  const loaded = await requireFundMember(c, id);
  if ("error" in loaded && loaded.error) return loaded.error;
  const { db, fund } = loaded as { db: Db; fund: FundRow };

  const spends = await db
    .select()
    .from(schema.fundSpends)
    .where(eq(schema.fundSpends.fundId, fund.id))
    .orderBy(desc(schema.fundSpends.spendDate), desc(sql`fund_spends.rowid`));

  return c.json({ spends });
});

fundRoutes.post("/:id/spends", requireSession, zv(createSpendSchema), async (c) => {
  const userId = c.get("userId")!;
  const { id } = c.req.param();
  const data = c.req.valid("json");
  const loaded = await requireFundMember(c, id);
  if ("error" in loaded && loaded.error) return loaded.error;
  const { db, fund } = loaded as { db: Db; fund: FundRow };

  const currency = data.currency ?? fund.currency;
  if (currency !== fund.currency) {
    return c.json(
      {
        error: "validation_error",
        issues: [
          {
            code: "custom",
            path: ["currency"],
            message: `currency must match fund (${fund.currency})`,
          },
        ],
      },
      400,
    );
  }

  const spendId = crypto.randomUUID();
  await db.insert(schema.fundSpends).values({
    id: spendId,
    fundId: fund.id,
    familyId: fund.familyId,
    amountMinor: data.amountMinor,
    currency,
    spendDate: data.spendDate,
    merchant: data.merchant ?? null,
    description: data.description ?? null,
    createdByUserId: userId,
  });

  await recordFundActivity(db, {
    fundId: fund.id,
    familyId: fund.familyId,
    actorUserId: userId,
    action: "spend_added",
    targetType: "fund_spend",
    targetId: spendId,
    meta: { amountMinor: data.amountMinor, spendDate: data.spendDate },
  });

  const spend = await db
    .select()
    .from(schema.fundSpends)
    .where(eq(schema.fundSpends.id, spendId))
    .get();
  return c.json({ spend }, 201);
});

// ── Settle ───────────────────────────────────────────────────────────────────

const settleSchema = z.object({
  periodKey: periodKey,
  note: z.string().max(2000).optional().nullable(),
});

fundRoutes.post("/:id/settle", requireSession, zv(settleSchema), async (c) => {
  const userId = c.get("userId")!;
  const { id } = c.req.param();
  const data = c.req.valid("json");
  const loaded = await requireFundMember(c, id);
  if ("error" in loaded && loaded.error) return loaded.error;
  const { db, fund } = loaded as { db: Db; fund: FundRow };

  const existing = await db
    .select({ id: schema.fundSettlements.id })
    .from(schema.fundSettlements)
    .where(
      and(
        eq(schema.fundSettlements.fundId, fund.id),
        eq(schema.fundSettlements.periodKey, data.periodKey),
      ),
    )
    .get();
  if (existing) {
    return c.json({ error: "already_settled", periodKey: data.periodKey }, 409);
  }

  // Snapshot totals for the calendar month of periodKey.
  const [y, m] = data.periodKey.split("-").map(Number);
  const monthStart = Math.floor(Date.UTC(y, m - 1, 1) / 1000);
  const monthEnd = Math.floor(Date.UTC(y, m, 0, 23, 59, 59) / 1000); // last day of month
  const fromIso = `${data.periodKey}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const toIso = `${data.periodKey}-${String(lastDay).padStart(2, "0")}`;

  const contrib = await db
    .select({
      total: sql<number>`coalesce(sum(${schema.fundContributions.amountMinor}), 0)`,
    })
    .from(schema.fundContributions)
    .where(
      and(
        eq(schema.fundContributions.fundId, fund.id),
        gte(schema.fundContributions.paidAt, monthStart),
        lte(schema.fundContributions.paidAt, monthEnd),
      ),
    )
    .get();
  const spends = await db
    .select({
      total: sql<number>`coalesce(sum(${schema.fundSpends.amountMinor}), 0)`,
    })
    .from(schema.fundSpends)
    .where(
      and(
        eq(schema.fundSpends.fundId, fund.id),
        gte(schema.fundSpends.spendDate, fromIso),
        lte(schema.fundSpends.spendDate, toIso),
      ),
    )
    .get();

  const contributionsMinor = Number(contrib?.total ?? 0);
  const spendsMinor = Number(spends?.total ?? 0);
  const remainingMinor = contributionsMinor - spendsMinor;
  const settlementId = crypto.randomUUID();
  const settledAt = Math.floor(Date.now() / 1000);

  await db.insert(schema.fundSettlements).values({
    id: settlementId,
    fundId: fund.id,
    familyId: fund.familyId,
    periodKey: data.periodKey,
    contributionsMinor,
    spendsMinor,
    remainingMinor,
    settledAt,
    settledByUserId: userId,
    note: data.note ?? null,
  });

  await recordFundActivity(db, {
    fundId: fund.id,
    familyId: fund.familyId,
    actorUserId: userId,
    action: "settled",
    targetType: "fund_settlement",
    targetId: settlementId,
    meta: {
      periodKey: data.periodKey,
      contributionsMinor,
      spendsMinor,
      remainingMinor,
    },
  });

  const settlement = await db
    .select()
    .from(schema.fundSettlements)
    .where(eq(schema.fundSettlements.id, settlementId))
    .get();
  return c.json({ settlement }, 201);
});

// ── Activity ─────────────────────────────────────────────────────────────────

fundRoutes.get("/:id/activity", requireSession, async (c) => {
  const { id } = c.req.param();
  const loaded = await requireFundMember(c, id);
  if ("error" in loaded && loaded.error) return loaded.error;
  const { db, fund } = loaded as { db: Db; fund: FundRow };

  const activity = await db
    .select()
    .from(schema.fundActivity)
    .where(eq(schema.fundActivity.fundId, fund.id))
    .orderBy(desc(schema.fundActivity.createdAt))
    .limit(100);

  return c.json({
    activity: activity.map((a) => ({
      ...a,
      meta: a.metaJson ? (JSON.parse(a.metaJson) as Record<string, unknown>) : null,
    })),
  });
});
