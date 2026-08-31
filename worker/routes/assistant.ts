/**
 * AI assistant (Gemini).
 *
 * "I ate noodles for 70" becomes an expense row, because the model is given a
 * small set of tools and we execute them.
 *
 * Security posture — the important part:
 *   - Tools run server-side under the SIGNED-IN user's id and the family they
 *     passed. The model never supplies a userId, so it cannot act as anyone else.
 *   - Family membership is checked once, before the model runs.
 *   - Reads go through the same visibility rules as the REST API: another
 *     member's private rows are invisible to the assistant too.
 *   - Prompt text is untrusted input. It can only ever reach these tools with
 *     these arguments; there is no eval, no SQL, and no HTTP passthrough.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, gte, lte, or } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema, type Db } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { checkRateLimit } from "../lib/rateLimit";
import { insertAuditEvent } from "../lib/audit";
import {
  runAssistant,
  GeminiError,
  type FunctionDeclaration,
  type GeminiContent,
} from "../lib/ai/gemini";
import { buildPlan, type CommitmentInput, type IncomeInput } from "../lib/finance/plan";
import { cycleFor } from "../lib/finance/periods";
import { ensureBuiltinCategories } from "../lib/expenses/builtinCategories";

export const assistantRoutes = new Hono<HonoEnv>();

const chatSchema = z.object({
  familyId: z.string().min(1),
  message: z.string().min(1).max(2000),
  // Prior turns, so follow-ups work. Bounded to keep the prompt small.
  history: z
    .array(z.object({ role: z.enum(["user", "model"]), text: z.string().max(4000) }))
    .max(20)
    .optional(),
});

const TOOLS: FunctionDeclaration[] = [
  {
    name: "add_expense",
    description:
      "Record a new expense for the signed-in user. Use for anything they say they bought, ate, paid for or spent money on.",
    parameters: {
      type: "object",
      properties: {
        amountMajor: {
          type: "number",
          description: "Amount in major units, e.g. 70 for ₹70 or $70. Not cents/paise.",
        },
        merchant: { type: "string", description: "Where it was spent, if mentioned." },
        description: { type: "string", description: "What it was for, e.g. 'noodles'." },
        categoryName: {
          type: "string",
          description:
            "Best-matching category name, e.g. Groceries, Dining out, Transport, Fuel, Utilities.",
        },
        expenseDate: {
          type: "string",
          description: "Date as yyyy-mm-dd. Omit for today.",
        },
        shareWithFamily: {
          type: "boolean",
          description: "True only if the user explicitly wants the family to see it. Default false.",
        },
      },
      required: ["amountMajor"],
    },
  },
  {
    name: "list_recent_expenses",
    description: "List the signed-in user's recent expenses to answer questions about spending.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "How many to return, max 50." },
        from: { type: "string", description: "Start date yyyy-mm-dd." },
        to: { type: "string", description: "End date yyyy-mm-dd." },
      },
    },
  },
  {
    name: "get_money_overview",
    description:
      "Get this pay cycle's plan: income, committed money, savings target, what is spendable, what is left, and spending so far. Use for 'how am I doing', 'what can I spend', 'how much is left'.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_commitments",
    description:
      "List recurring commitments (EMIs, insurance, investments, subscriptions, giving) for the signed-in user.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "add_wishlist_item",
    description: "Add something the user wants to buy to their wishlist.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        estimatedCostMajor: { type: "number", description: "Cost in major units." },
        priority: { type: "number", description: "1 (highest) to 5 (lowest). Default 3." },
      },
      required: ["name", "estimatedCostMajor"],
    },
  },
];

const SYSTEM_INSTRUCTION = `You are the money assistant inside Family Vault, a private family finance app.

Rules:
- Be brief and concrete. One or two sentences unless asked for detail.
- When the user reports spending, call add_expense. Infer the category yourself.
- Amounts the user speaks are in MAJOR units (70 means 70 rupees/dollars, not 70 paise/cents).
- Never invent numbers. To answer questions about money, call a tool and use what it returns.
- After recording something, confirm what you saved in one short sentence.
- You can only ever see and change the signed-in user's own data. If asked about
  another person's private spending, say you cannot see it.`;

/** Currency-aware major → minor. Every currency this app supports is 2dp. */
function toMinor(major: number): number {
  return Math.round(major * 100);
}

interface ToolContext {
  db: Db;
  familyId: string;
  userId: string;
  memberId: string;
  currency: string;
  today: string;
}

async function resolveCategory(
  ctx: ToolContext,
  name: string | undefined,
): Promise<string | null> {
  if (!name) return null;
  await ensureBuiltinCategories(ctx.db);
  const wanted = name.trim().toLowerCase();
  const cats = await ctx.db
    .select({ id: schema.expenseCategories.id, name: schema.expenseCategories.name })
    .from(schema.expenseCategories)
    .where(
      or(
        eq(schema.expenseCategories.familyId, ctx.familyId),
        // Built-ins have a NULL familyId and are shared by every family.
        eq(schema.expenseCategories.archived, false),
      ),
    );
  const exact = cats.find((c) => c.name.toLowerCase() === wanted);
  if (exact) return exact.id;
  const partial = cats.find(
    (c) => c.name.toLowerCase().includes(wanted) || wanted.includes(c.name.toLowerCase()),
  );
  return partial?.id ?? null;
}

async function executeTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "add_expense": {
      const amountMajor = Number(args.amountMajor);
      if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
        return { error: "amountMajor must be a positive number" };
      }
      const amountMinor = toMinor(amountMajor);
      const expenseDate =
        typeof args.expenseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.expenseDate)
          ? args.expenseDate
          : ctx.today;

      const id = crypto.randomUUID();
      await ctx.db.insert(schema.expenses).values({
        id,
        familyId: ctx.familyId,
        paidByMemberId: ctx.memberId,
        categoryId: await resolveCategory(ctx, args.categoryName as string | undefined),
        amountMinor,
        currency: ctx.currency,
        expenseDate,
        merchant: typeof args.merchant === "string" ? args.merchant.slice(0, 200) : null,
        description:
          typeof args.description === "string" ? args.description.slice(0, 2000) : null,
        // Private unless the user explicitly asked to share it.
        visibility: args.shareWithFamily === true ? "family" : "private",
        createdByUserId: ctx.userId,
      });

      await insertAuditEvent(ctx.db, {
        familyId: ctx.familyId,
        actorUserId: ctx.userId,
        action: "expense_created_by_assistant",
        targetType: "expense",
        targetId: id,
        meta: { amountMinor, via: "gemini" },
      });

      return { ok: true, id, amountMinor, currency: ctx.currency, expenseDate };
    }

    case "list_recent_expenses": {
      const limitRaw = Number(args.limit ?? 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 10;
      let where = and(
        eq(schema.expenses.familyId, ctx.familyId),
        eq(schema.expenses.status, "active"),
        // Only what this user may see.
        or(
          eq(schema.expenses.visibility, "family"),
          eq(schema.expenses.createdByUserId, ctx.userId),
        ),
      );
      if (typeof args.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.from)) {
        where = and(where, gte(schema.expenses.expenseDate, args.from));
      }
      if (typeof args.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.to)) {
        where = and(where, lte(schema.expenses.expenseDate, args.to));
      }

      const rows = await ctx.db
        .select({
          amountMinor: schema.expenses.amountMinor,
          expenseDate: schema.expenses.expenseDate,
          merchant: schema.expenses.merchant,
          description: schema.expenses.description,
        })
        .from(schema.expenses)
        .where(where)
        .orderBy(desc(schema.expenses.expenseDate))
        .limit(limit);

      return { currency: ctx.currency, expenses: rows };
    }

    case "get_money_overview": {
      const settings =
        (await ctx.db
          .select()
          .from(schema.financialSettings)
          .where(
            and(
              eq(schema.financialSettings.userId, ctx.userId),
              eq(schema.financialSettings.familyId, ctx.familyId),
            ),
          )
          .get()) ?? { savingsTargetKind: "none" as const, paydayDayOfMonth: 1 };

      const cycle = cycleFor(ctx.today, settings.paydayDayOfMonth ?? 1);
      const incomes = (await ctx.db
        .select()
        .from(schema.incomes)
        .where(
          and(
            eq(schema.incomes.familyId, ctx.familyId),
            eq(schema.incomes.ownerUserId, ctx.userId),
          ),
        )) as unknown as IncomeInput[];
      const commitments = (await ctx.db
        .select()
        .from(schema.commitments)
        .where(
          and(
            eq(schema.commitments.familyId, ctx.familyId),
            eq(schema.commitments.ownerUserId, ctx.userId),
          ),
        )) as unknown as CommitmentInput[];
      const expenses = await ctx.db
        .select({
          id: schema.expenses.id,
          amountMinor: schema.expenses.amountMinor,
          expenseDate: schema.expenses.expenseDate,
          categoryId: schema.expenses.categoryId,
        })
        .from(schema.expenses)
        .where(
          and(
            eq(schema.expenses.familyId, ctx.familyId),
            eq(schema.expenses.status, "active"),
            eq(schema.expenses.createdByUserId, ctx.userId),
            gte(schema.expenses.expenseDate, cycle.from),
            lte(schema.expenses.expenseDate, cycle.to),
          ),
        );

      const plan = buildPlan({
        cycle,
        today: ctx.today,
        incomes,
        commitments,
        expenses,
        settings,
      });

      return {
        currency: ctx.currency,
        cycle: { from: plan.cycle.from, to: plan.cycle.to },
        incomeMinor: plan.incomeMinor,
        committedMinor: plan.committedMinor,
        savingsTargetMinor: plan.savingsTargetMinor,
        spendableMinor: plan.spendableMinor,
        spentMinor: plan.spentMinor,
        remainingMinor: plan.remainingMinor,
        dailyAllowanceMinor: plan.dailyAllowanceMinor,
        daysLeft: plan.daysLeft,
        status: plan.status,
      };
    }

    case "list_commitments": {
      const rows = await ctx.db
        .select({
          name: schema.commitments.name,
          kind: schema.commitments.kind,
          amountMinor: schema.commitments.amountMinor,
          percentBp: schema.commitments.percentBp,
          cadence: schema.commitments.cadence,
          status: schema.commitments.status,
          totalInstallments: schema.commitments.totalInstallments,
        })
        .from(schema.commitments)
        .where(
          and(
            eq(schema.commitments.familyId, ctx.familyId),
            eq(schema.commitments.ownerUserId, ctx.userId),
          ),
        );
      return { currency: ctx.currency, commitments: rows };
    }

    case "add_wishlist_item": {
      const cost = Number(args.estimatedCostMajor);
      if (!Number.isFinite(cost) || cost <= 0) {
        return { error: "estimatedCostMajor must be a positive number" };
      }
      const priorityRaw = Number(args.priority ?? 3);
      const priority = Number.isFinite(priorityRaw)
        ? Math.min(Math.max(Math.trunc(priorityRaw), 1), 5)
        : 3;

      const id = crypto.randomUUID();
      await ctx.db.insert(schema.wishlistItems).values({
        id,
        familyId: ctx.familyId,
        ownerUserId: ctx.userId,
        name: String(args.name ?? "Item").slice(0, 160),
        estimatedCostMinor: toMinor(cost),
        currency: ctx.currency,
        priority,
      });
      return { ok: true, id };
    }

    default:
      return { error: `unknown tool ${name}` };
  }
}

assistantRoutes.post("/chat", requireSession, zValidator("json", chatSchema, (r, c) => {
  if (!r.success) {
    return c.json({ error: "validation_error", issues: r.error.issues }, 400);
  }
}), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  if (!c.env?.GEMINI_API_KEY) {
    return c.json(
      {
        error: "not_configured",
        message: "The assistant needs a GEMINI_API_KEY. Add it with `wrangler secret put GEMINI_API_KEY`.",
      },
      501,
    );
  }

  // The assistant is the most expensive endpoint here; throttle per user.
  const limited = await checkRateLimit(c, `assistant:${userId}`, {
    limit: 30,
    windowSecs: 60,
  });
  if (limited) return limited;

  const db = getDb(c.env);
  const family = await db
    .select({ currency: schema.families.defaultCurrency })
    .from(schema.families)
    .where(eq(schema.families.id, data.familyId))
    .get();

  const ctx: ToolContext = {
    db,
    familyId: data.familyId,
    userId,
    memberId: membership.id,
    currency: family?.currency ?? "USD",
    today: new Date().toISOString().slice(0, 10),
  };

  const history: GeminiContent[] = [
    ...(data.history ?? []).map((h) => ({
      role: h.role,
      parts: [{ text: h.text }],
    })),
    { role: "user" as const, parts: [{ text: data.message }] },
  ];

  try {
    const result = await runAssistant({
      apiKey: c.env.GEMINI_API_KEY,
      model: c.env.GEMINI_MODEL,
      systemInstruction: `${SYSTEM_INSTRUCTION}\n\nToday is ${ctx.today}. The currency is ${ctx.currency}.`,
      history,
      tools: TOOLS,
      execute: (name, args) => executeTool(ctx, name, args),
    });

    return c.json({
      reply: result.text,
      // Surfaced so the UI can show "added ₹70 — noodles" and refresh its queries.
      actions: result.toolCalls.map((t) => ({ name: t.name, result: t.result })),
    });
  } catch (err) {
    if (err instanceof GeminiError) {
      console.error(`[assistant] gemini ${err.status}: ${err.message}`);
      return c.json({ error: "assistant_failed", message: "The assistant is unavailable right now." }, 502);
    }
    console.error("[assistant] failed:", err);
    return c.json({ error: "assistant_failed" }, 500);
  }
});

/** Lets the UI hide the assistant entirely when no key is configured. */
assistantRoutes.get("/status", requireSession, async (c) => {
  return c.json({ configured: Boolean(c.env?.GEMINI_API_KEY) });
});
