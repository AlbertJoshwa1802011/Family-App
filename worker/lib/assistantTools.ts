/**
 * Assistant tool definitions + server-side executors (Gemini or Claude).
 * Every write is family-scoped and goes through the same D1 tables as the
 * REST API. The model never talks to Drive, email, or other families.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../db/client";
import { schema } from "../db/client";
import type { Env } from "../types";
import { insertAuditEvent } from "./audit";
import { syncEventToGoogleCalendars } from "./eventCalendarSync";
import {
  EXPENSE_CATEGORIES,
  formatMoney,
  isExpenseCategory,
  toCents,
} from "./expenses";

export interface ToolContext {
  db: Db;
  env: Env;
  familyId: string;
  userId: string;
  role: string;
  nowMs: number;
}

export interface ToolAction {
  tool: string;
  summary: string;
  id?: string;
  href?: string;
}

export interface ToolResult {
  ok: boolean;
  error?: string;
  action?: ToolAction;
  data?: unknown;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "add_expense",
    description:
      "Record a family expense. Use when the user spent money (snacks, groceries, fuel, fees). Amount is in major currency units (100 means 100 rupees / dollars, not cents).",
    input_schema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Amount in major units, e.g. 100" },
        currency: {
          type: "string",
          description: "ISO 4217 code. Default INR.",
        },
        category: {
          type: "string",
          enum: [...EXPENSE_CATEGORIES],
        },
        note: { type: "string", description: "What it was for, e.g. outside snacks" },
        spentOn: {
          type: "string",
          description: "ISO yyyy-mm-dd. Default today.",
        },
      },
      required: ["amount"],
    },
  },
  {
    name: "add_task",
    description:
      "Create a family to-do. Use for reminders the user wants tracked (renew passport, call dentist). Set dueDate so the daily email scheduler can remind them 7, 2, and 1 days before. When converting a meeting into tasks, pass relatedEventId.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        notes: { type: "string" },
        dueDate: { type: "string", description: "ISO yyyy-mm-dd" },
        assignedToMemberId: {
          type: "string",
          description: "family_members.id of the assignee, if known from context",
        },
        relatedEventId: {
          type: "string",
          description: "events.id when this task comes from a meeting",
        },
        relatedDocumentId: {
          type: "string",
          description: "documents.id when this task is about a vault document",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "create_tasks_from_event",
    description:
      "Create one or more action-item tasks linked to an existing calendar event (meeting follow-ups).",
    input_schema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        titles: {
          type: "array",
          items: { type: "string" },
          description: "Action item titles",
        },
        dueDate: { type: "string", description: "ISO yyyy-mm-dd for all items" },
      },
      required: ["eventId", "titles"],
    },
  },
  {
    name: "complete_task",
    description: "Mark an existing open task as done. Pass the task id from context.",
    input_schema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "add_event",
    description:
      "Add a calendar event (appointment, gathering, milestone). Dates are ISO yyyy-mm-dd; time is 24h HH:MM in UTC if provided, otherwise all-day.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        date: { type: "string", description: "ISO yyyy-mm-dd" },
        time: { type: "string", description: "HH:MM 24h UTC, optional" },
        type: {
          type: "string",
          enum: ["gathering", "appointment", "milestone", "other"],
        },
        location: { type: "string" },
        description: { type: "string" },
      },
      required: ["title", "date"],
    },
  },
  {
    name: "add_contact",
    description: "Save an emergency or useful contact (doctor, school, plumber).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        relationship: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        notes: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_expenses",
    description: "List recent family expenses, optionally filtered by category.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: [...EXPENSE_CATEGORIES] },
        limit: { type: "number" },
      },
    },
  },
];

const addExpenseInput = z.object({
  amount: z.number().finite().positive().max(10_000_000),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional()
    .default("INR"),
  category: z.string().optional(),
  note: z.string().max(500).optional(),
  spentOn: isoDate.optional(),
});

const addTaskInput = z.object({
  title: z.string().min(1).max(300),
  notes: z.string().max(2000).optional(),
  dueDate: isoDate.optional(),
  assignedToMemberId: z.string().optional(),
  relatedEventId: z.string().optional(),
  relatedDocumentId: z.string().optional(),
});

const createTasksFromEventInput = z.object({
  eventId: z.string().min(1),
  titles: z.array(z.string().min(1).max(300)).min(1).max(20),
  dueDate: isoDate.optional(),
});

const completeTaskInput = z.object({ taskId: z.string().min(1) });

const addEventInput = z.object({
  title: z.string().min(1).max(200),
  date: isoDate,
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  type: z.enum(["gathering", "appointment", "milestone", "other"]).optional(),
  location: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
});

const addContactInput = z.object({
  name: z.string().min(1).max(200),
  relationship: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal("")),
  notes: z.string().max(1000).optional(),
});

const listExpensesInput = z.object({
  category: z.string().optional(),
  limit: z.number().int().positive().max(50).optional(),
});

function todayIso(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export async function executeAssistantTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "add_expense":
        return await addExpense(rawInput, ctx);
      case "add_task":
        return await addTask(rawInput, ctx);
      case "create_tasks_from_event":
        return await createTasksFromEvent(rawInput, ctx);
      case "complete_task":
        return await completeTask(rawInput, ctx);
      case "add_event":
        return await addEvent(rawInput, ctx);
      case "add_contact":
        return await addContact(rawInput, ctx);
      case "list_expenses":
        return await listExpenses(rawInput, ctx);
      default:
        return { ok: false, error: `unknown_tool:${name}` };
    }
  } catch (err) {
    console.error(`[assistant] tool ${name} failed:`, err);
    return { ok: false, error: "tool_failed" };
  }
}

async function addExpense(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = addExpenseInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const data = parsed.data;
  const expenseDate = data.spentOn ?? todayIso(ctx.nowMs);
  const amountMinor = toCents(data.amount);
  const id = crypto.randomUUID();
  const now = Math.floor(ctx.nowMs / 1000);

  const me = await ctx.db
    .select({ id: schema.familyMembers.id })
    .from(schema.familyMembers)
    .where(
      and(
        eq(schema.familyMembers.familyId, ctx.familyId),
        eq(schema.familyMembers.userId, ctx.userId),
        eq(schema.familyMembers.status, "active"),
      ),
    )
    .get();
  if (!me) return { ok: false, error: "not_a_member" };

  await ctx.db.insert(schema.expenses).values({
    id,
    familyId: ctx.familyId,
    paidByMemberId: me.id,
    amountMinor,
    currency: data.currency,
    expenseDate,
    description: data.note ?? data.category ?? null,
    merchant: null,
    visibility: "family",
    status: "active",
    nestDepth: 0,
    splitType: "none",
    createdByUserId: ctx.userId,
    updatedAt: now,
    createdAt: now,
  });
  await insertAuditEvent(ctx.db, {
    familyId: ctx.familyId,
    actorUserId: ctx.userId,
    action: "expense_created",
    targetType: "expense",
    targetId: id,
    meta: { via: "assistant", amountMinor, category: data.category },
  });

  const money = formatMoney(amountMinor, data.currency);
  const label = data.note?.trim() || data.category || "expense";
  return {
    ok: true,
    data: { id, amount: data.amount, currency: data.currency, spentOn: expenseDate },
    action: {
      tool: "add_expense",
      summary: `Added ${money} for ${label}`,
      id,
      href: "/money/expenses",
    },
  };
}

async function addTask(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = addTaskInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const data = parsed.data;

  if (data.assignedToMemberId) {
    const member = await ctx.db
      .select({ id: schema.familyMembers.id })
      .from(schema.familyMembers)
      .where(
        and(
          eq(schema.familyMembers.id, data.assignedToMemberId),
          eq(schema.familyMembers.familyId, ctx.familyId),
        ),
      )
      .get();
    if (!member) return { ok: false, error: "invalid_member_ids" };
  }

  if (data.relatedEventId) {
    const ev = await ctx.db
      .select({ id: schema.events.id, familyId: schema.events.familyId })
      .from(schema.events)
      .where(eq(schema.events.id, data.relatedEventId))
      .get();
    if (!ev || ev.familyId !== ctx.familyId) {
      return { ok: false, error: "invalid_event_id" };
    }
  }

  if (data.relatedDocumentId) {
    const doc = await ctx.db
      .select({ id: schema.documents.id, familyId: schema.documents.familyId })
      .from(schema.documents)
      .where(eq(schema.documents.id, data.relatedDocumentId))
      .get();
    if (!doc || doc.familyId !== ctx.familyId) {
      return { ok: false, error: "invalid_document_id" };
    }
  }

  const id = crypto.randomUUID();
  const now = Math.floor(ctx.nowMs / 1000);
  await ctx.db.insert(schema.tasks).values({
    id,
    familyId: ctx.familyId,
    title: data.title,
    notes: data.notes,
    dueDate: data.dueDate,
    assignedToMemberId: data.assignedToMemberId,
    relatedEventId: data.relatedEventId,
    relatedDocumentId: data.relatedDocumentId,
    status: "open",
    createdBy: ctx.userId,
    updatedAt: now,
  });
  await insertAuditEvent(ctx.db, {
    familyId: ctx.familyId,
    actorUserId: ctx.userId,
    action: "task_created",
    targetType: "task",
    targetId: id,
    meta: { via: "assistant", title: data.title },
  });

  const due = data.dueDate ? ` (due ${data.dueDate})` : "";
  return {
    ok: true,
    data: { id, title: data.title, dueDate: data.dueDate ?? null },
    action: {
      tool: "add_task",
      summary: `Added task “${data.title}”${due}`,
      id,
      href: "/tasks",
    },
  };
}

async function createTasksFromEvent(
  raw: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const parsed = createTasksFromEventInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const data = parsed.data;

  const ev = await ctx.db
    .select({
      id: schema.events.id,
      familyId: schema.events.familyId,
      title: schema.events.title,
      status: schema.events.status,
    })
    .from(schema.events)
    .where(eq(schema.events.id, data.eventId))
    .get();
  if (!ev || ev.familyId !== ctx.familyId || ev.status === "trashed") {
    return { ok: false, error: "invalid_event_id" };
  }

  const now = Math.floor(ctx.nowMs / 1000);
  const created: { id: string; title: string }[] = [];
  for (const title of data.titles) {
    const id = crypto.randomUUID();
    await ctx.db.insert(schema.tasks).values({
      id,
      familyId: ctx.familyId,
      title: title.trim(),
      dueDate: data.dueDate,
      relatedEventId: data.eventId,
      status: "open",
      priority: "medium",
      createdBy: ctx.userId,
      updatedAt: now,
    });
    created.push({ id, title: title.trim() });
    await insertAuditEvent(ctx.db, {
      familyId: ctx.familyId,
      actorUserId: ctx.userId,
      action: "task_created",
      targetType: "task",
      targetId: id,
      meta: { via: "assistant", eventId: data.eventId },
    });
  }

  return {
    ok: true,
    data: { eventId: data.eventId, tasks: created },
    action: {
      tool: "create_tasks_from_event",
      summary: `Created ${created.length} action item(s) for “${ev.title}”`,
      href: `/calendar/events/${data.eventId}`,
    },
  };
}

async function completeTask(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = completeTaskInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const task = await ctx.db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, parsed.data.taskId))
    .get();
  if (!task || task.familyId !== ctx.familyId) {
    return { ok: false, error: "not_found" };
  }

  await ctx.db
    .update(schema.tasks)
    .set({
      status: "done",
      completedAt: task.completedAt ?? Math.floor(ctx.nowMs / 1000),
      updatedAt: Math.floor(ctx.nowMs / 1000),
    })
    .where(eq(schema.tasks.id, task.id));

  return {
    ok: true,
    data: { id: task.id, title: task.title, status: "done" },
    action: {
      tool: "complete_task",
      summary: `Marked “${task.title}” done`,
      id: task.id,
      href: "/tasks",
    },
  };
}

async function addEvent(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = addEventInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const data = parsed.data;
  const [y, m, d] = data.date.split("-").map(Number);
  let startAt: number;
  let allDay = true;
  if (data.time) {
    const [hh, mm] = data.time.split(":").map(Number);
    startAt = Math.floor(Date.UTC(y, m - 1, d, hh, mm) / 1000);
    allDay = false;
  } else {
    startAt = Math.floor(Date.UTC(y, m - 1, d) / 1000);
  }

  const id = crypto.randomUUID();
  const now = Math.floor(ctx.nowMs / 1000);
  await ctx.db.insert(schema.events).values({
    id,
    familyId: ctx.familyId,
    title: data.title,
    description: data.description,
    startAt,
    allDay,
    location: data.location,
    type: data.type ?? "other",
    status: "active",
    createdBy: ctx.userId,
    updatedAt: now,
  });
  await insertAuditEvent(ctx.db, {
    familyId: ctx.familyId,
    actorUserId: ctx.userId,
    action: "event_created",
    targetType: "event",
    targetId: id,
    meta: { via: "assistant", title: data.title },
  });

  await syncEventToGoogleCalendars(ctx.db, ctx.env, id);

  return {
    ok: true,
    data: { id, title: data.title, startAt, allDay },
    action: {
      tool: "add_event",
      summary: `Added event “${data.title}” on ${data.date}`,
      id,
      href: `/calendar/events/${id}`,
    },
  };
}

async function addContact(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = addContactInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const data = parsed.data;
  const id = crypto.randomUUID();
  const now = Math.floor(ctx.nowMs / 1000);
  await ctx.db.insert(schema.contacts).values({
    id,
    familyId: ctx.familyId,
    name: data.name,
    relationship: data.relationship,
    phone: data.phone,
    email: data.email,
    notes: data.notes,
    createdBy: ctx.userId,
    updatedAt: now,
  });

  return {
    ok: true,
    data: { id, name: data.name },
    action: {
      tool: "add_contact",
      summary: `Saved contact ${data.name}`,
      id,
      href: "/contacts",
    },
  };
}

async function listExpenses(raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = listExpensesInput.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const limit = parsed.data.limit ?? 20;
  const rows = await ctx.db
    .select()
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.familyId, ctx.familyId),
        eq(schema.expenses.status, "active"),
      ),
    )
    .orderBy(desc(schema.expenses.expenseDate), desc(sql`"expenses".rowid`))
    .limit(limit);

  const category = parsed.data.category;
  const filtered =
    category && isExpenseCategory(category)
      ? rows.filter((r) =>
          (r.description ?? "").toLowerCase().includes(category.toLowerCase()),
        )
      : rows;

  return {
    ok: true,
    data: {
      expenses: filtered.map((r) => ({
        id: r.id,
        amount: r.amountMinor / 100,
        currency: r.currency,
        note: r.description,
        spentOn: r.expenseDate,
      })),
    },
  };
}
