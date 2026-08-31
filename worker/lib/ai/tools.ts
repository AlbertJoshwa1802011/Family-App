/**
 * Server-side tool implementations for the Family Vault Gemini assistant.
 * Every tool runs under the caller's auth scope (private expenses stay private).
 */

import { and, eq, gte, lte } from "drizzle-orm";
import type { Db } from "../../db/client";
import { schema } from "../../db/client";
import {
  computeBudget,
  spendAdvice,
  toMonthlyMinor,
} from "../expenses/budget";
import { expenseVisibilityWhere } from "../expenses/visibility";
import type { GeminiFunctionDeclaration } from "./gemini";

export const AI_TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  {
    name: "add_expense",
    description:
      "Record a private personal expense for the current user. Amount is in major currency units (e.g. 12.50 for $12.50). Currency defaults to the family currency.",
    parameters: {
      type: "object",
      properties: {
        amount: {
          type: "number",
          description: "Amount in major units (dollars/rupees), e.g. 12.5",
        },
        merchant: { type: "string", description: "Where it was spent" },
        description: { type: "string", description: "Optional note" },
        expenseDate: {
          type: "string",
          description: "ISO date yyyy-mm-dd; defaults to today UTC",
        },
        categoryId: { type: "string", description: "Optional category id" },
      },
      required: ["amount"],
    },
  },
  {
    name: "get_expense_summary",
    description:
      "Get the caller's personal expense summary for the current calendar month (or a from/to window).",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "yyyy-mm-dd start (optional)" },
        to: { type: "string", description: "yyyy-mm-dd end (optional)" },
      },
    },
  },
  {
    name: "list_wishlist",
    description: "List open wishlist items for the family.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["open", "bought", "dropped"],
          description: "Filter by status; default open",
        },
      },
    },
  },
  {
    name: "add_wishlist_item",
    description: "Add an item to the family wishlist.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        estimatedAmount: {
          type: "number",
          description: "Estimated cost in major units (optional)",
        },
        priority: { type: "string", enum: ["must", "should", "want"] },
        url: { type: "string" },
        notes: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "get_money_plan",
    description:
      "Get the caller's money plan (income, tithe %, children giving, savings goal).",
    parameters: { type: "object", properties: {} },
  },
];

export const SYSTEM_PROMPT = `You are the Family Vault assistant — a careful helper for household documents, expenses, budgets, and wishlists.
Rules:
- Never invent numbers, expenses, or plan values. Use tools to read or write real data.
- When the user states they spent money, call add_expense with the amount they gave.
- Amounts you pass to tools are major currency units (e.g. 12.50), not minor units.
- Keep replies concise and practical. Do not claim actions succeeded unless a tool returned success.
- You cannot see other family members' private expenses.`;

export type ToolContext = {
  db: Db;
  familyId: string;
  userId: string;
  memberId: string;
  currency: string;
};

function majorToMinor(amount: number): number | null {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const minor = Math.round(amount * 100);
  if (minor <= 0) return null;
  return minor;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthWindow(now = new Date()): { from: string; to: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

export async function executeAiTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case "add_expense":
      return addExpense(ctx, args);
    case "get_expense_summary":
      return getExpenseSummary(ctx, args);
    case "list_wishlist":
      return listWishlist(ctx, args);
    case "add_wishlist_item":
      return addWishlistItem(ctx, args);
    case "get_money_plan":
      return getMoneyPlan(ctx);
    default:
      return { error: "unknown_tool", name };
  }
}

async function addExpense(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const amountMinor = majorToMinor(Number(args.amount));
  if (amountMinor === null) {
    return { error: "invalid_amount", message: "amount must be a positive number" };
  }
  const expenseDate =
    typeof args.expenseDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(args.expenseDate)
      ? args.expenseDate
      : todayIso();
  const merchant =
    typeof args.merchant === "string" ? args.merchant.slice(0, 200) : null;
  const description =
    typeof args.description === "string"
      ? args.description.slice(0, 2000)
      : null;
  const categoryId =
    typeof args.categoryId === "string" ? args.categoryId : null;

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await ctx.db.insert(schema.expenses).values({
    id,
    familyId: ctx.familyId,
    paidByMemberId: ctx.memberId,
    subjectMemberId: null,
    categoryId,
    amountMinor,
    currency: ctx.currency,
    expenseDate,
    merchant,
    description,
    paymentMethod: null,
    splitType: "none",
    visibility: "private",
    status: "active",
    createdByUserId: ctx.userId,
    clientRequestId: null,
    createdAt: now,
    updatedAt: now,
  });

  return {
    ok: true,
    expense: {
      id,
      amountMinor,
      currency: ctx.currency,
      expenseDate,
      merchant,
      visibility: "private",
    },
  };
}

async function getExpenseSummary(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const defaults = monthWindow();
  const from =
    typeof args.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.from)
      ? args.from
      : defaults.from;
  const to =
    typeof args.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.to)
      ? args.to
      : defaults.to;

  const where = and(
    expenseVisibilityWhere(ctx.familyId, ctx.userId),
    eq(schema.expenses.createdByUserId, ctx.userId),
    gte(schema.expenses.expenseDate, from),
    lte(schema.expenses.expenseDate, to),
  );

  const rows = await ctx.db
    .select({ amountMinor: schema.expenses.amountMinor })
    .from(schema.expenses)
    .where(where);

  const totalMinor = rows.reduce((s, r) => s + r.amountMinor, 0);

  const recurringRows = await ctx.db
    .select({
      amountMinor: schema.recurringExpenses.amountMinor,
      interval: schema.recurringExpenses.interval,
    })
    .from(schema.recurringExpenses)
    .where(
      and(
        eq(schema.recurringExpenses.familyId, ctx.familyId),
        eq(schema.recurringExpenses.createdByUserId, ctx.userId),
        eq(schema.recurringExpenses.active, true),
      ),
    );

  const recurringMonthlyMinor = recurringRows.reduce(
    (s, r) =>
      s +
      toMonthlyMinor(
        r.amountMinor,
        r.interval as "monthly" | "weekly" | "yearly",
      ),
    0,
  );

  const plan = await ctx.db
    .select()
    .from(schema.moneyPlans)
    .where(
      and(
        eq(schema.moneyPlans.familyId, ctx.familyId),
        eq(schema.moneyPlans.userId, ctx.userId),
      ),
    )
    .get();

  const budget = computeBudget({
    monthlyIncomeMinor: plan?.monthlyIncomeMinor ?? 0,
    tithePercent: plan?.tithePercent ?? 10,
    childrenGivingMinor: plan?.childrenGivingMinor ?? 0,
    savingsGoalMinor: plan?.savingsGoalMinor ?? 0,
    spentMinor: totalMinor,
    recurringMonthlyMinor,
  });

  return {
    from,
    to,
    currency: ctx.currency,
    totalMinor,
    count: rows.length,
    recurringMonthlyMinor,
    budget: {
      incomeMinor: budget.incomeMinor,
      titheDueMinor: budget.titheDueMinor,
      leftoverMinor: budget.leftoverMinor,
    },
    spendAdvice: spendAdvice(budget, ctx.currency),
  };
}

async function listWishlist(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const status =
    args.status === "bought" || args.status === "dropped" ? args.status : "open";

  const items = await ctx.db
    .select({
      id: schema.wishlistItems.id,
      title: schema.wishlistItems.title,
      estimatedMinor: schema.wishlistItems.estimatedMinor,
      currency: schema.wishlistItems.currency,
      priority: schema.wishlistItems.priority,
      status: schema.wishlistItems.status,
    })
    .from(schema.wishlistItems)
    .where(
      and(
        eq(schema.wishlistItems.familyId, ctx.familyId),
        eq(schema.wishlistItems.status, status),
      ),
    );

  return { items };
}

async function addWishlistItem(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const title =
    typeof args.title === "string" ? args.title.trim().slice(0, 200) : "";
  if (!title) return { error: "title_required" };

  const estimatedMinor =
    args.estimatedAmount !== undefined
      ? majorToMinor(Number(args.estimatedAmount))
      : null;
  if (args.estimatedAmount !== undefined && estimatedMinor === null) {
    return { error: "invalid_estimated_amount" };
  }

  const priority =
    args.priority === "must" || args.priority === "should"
      ? args.priority
      : "want";
  const url = typeof args.url === "string" ? args.url.slice(0, 2000) : null;
  const notes =
    typeof args.notes === "string" ? args.notes.slice(0, 2000) : null;

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await ctx.db.insert(schema.wishlistItems).values({
    id,
    familyId: ctx.familyId,
    createdByUserId: ctx.userId,
    title,
    estimatedMinor,
    currency: ctx.currency,
    priority,
    url,
    notes,
    status: "open",
    createdAt: now,
    updatedAt: now,
  });

  return {
    ok: true,
    item: { id, title, estimatedMinor, priority, currency: ctx.currency },
  };
}

async function getMoneyPlan(
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const plan = await ctx.db
    .select()
    .from(schema.moneyPlans)
    .where(
      and(
        eq(schema.moneyPlans.familyId, ctx.familyId),
        eq(schema.moneyPlans.userId, ctx.userId),
      ),
    )
    .get();

  return {
    plan: plan ?? {
      monthlyIncomeMinor: 0,
      currency: ctx.currency,
      tithePercent: 10,
      childrenGivingMinor: 0,
      savingsGoalMinor: 0,
    },
  };
}
