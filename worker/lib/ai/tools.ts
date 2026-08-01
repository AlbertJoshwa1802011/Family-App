/**
 * Controlled, read-only tools the model can call to answer questions with real
 * app data — instead of being given raw DB access or inventing an answer
 * (CLAUDE.md security posture + master-plan §15/§16).
 *
 * Every executor is scoped to the (familyId, userId, role) the route already
 * authenticated and authorized — none of them accept a family/user id as a
 * tool argument, so the model has no way to ask for another family's data.
 *
 * Expense data isn't wired up here: the Expense Tracker module is being built
 * on a separate, not-yet-merged branch. `getFamilyOverview`'s member/role data
 * and the documents/events/tasks tools below are real, already-existing
 * app data — this is the seam future expense tools (getExpenseSummary, etc.)
 * plug into the same way once that module lands.
 */
import { and, asc, eq, gte, isNotNull, lte } from "drizzle-orm";
import type { Db } from "../../db/client";
import { schema } from "../../db/client";
import { visibilityWhere } from "../../routes/documents";
import type { AIToolDef } from "./client";

export interface ToolScope {
  db: Db;
  familyId: string;
  userId: string;
  role: string;
}

const DAYS_SCHEMA = {
  type: "object" as const,
  properties: {
    days: {
      type: "number",
      description: "How many days ahead to look (default 30, max 90).",
    },
  },
};

export const AI_TOOLS: AIToolDef[] = [
  {
    name: "get_family_overview",
    description:
      "Get this family's name and its members (name, role). Use for questions like " +
      "'who is in our family' or 'what's our family called'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_upcoming_events",
    description:
      "Get upcoming calendar events (gatherings, appointments, milestones) for this family, " +
      "soonest first. Use for questions about what's coming up / scheduled.",
    input_schema: DAYS_SCHEMA,
  },
  {
    name: "get_expiring_documents",
    description:
      "Get documents (passports, insurance, licenses, warranties, etc.) whose expiry date " +
      "falls within the given window, soonest first. Use for questions about what's expiring " +
      "or needs renewal.",
    input_schema: DAYS_SCHEMA,
  },
  {
    name: "get_open_tasks",
    description:
      "Get this family's open (not-yet-done) to-do tasks, soonest due date first. Use for " +
      "questions about pending to-dos or what needs to get done.",
    input_schema: { type: "object", properties: {} },
  },
];

function clampDays(input: Record<string, unknown>): number {
  const raw = typeof input.days === "number" ? input.days : 30;
  if (!Number.isFinite(raw)) return 30;
  return Math.min(Math.max(Math.round(raw), 1), 90);
}

async function getFamilyOverview(scope: ToolScope) {
  const family = await scope.db
    .select({ name: schema.families.name })
    .from(schema.families)
    .where(eq(schema.families.id, scope.familyId))
    .get();

  const members = await scope.db
    .select({
      displayName: schema.familyMembers.displayName,
      memberType: schema.familyMembers.memberType,
      role: schema.familyMembers.role,
      userName: schema.users.name,
      userEmail: schema.users.email,
    })
    .from(schema.familyMembers)
    .leftJoin(schema.users, eq(schema.familyMembers.userId, schema.users.id))
    .where(
      and(
        eq(schema.familyMembers.familyId, scope.familyId),
        eq(schema.familyMembers.status, "active"),
      ),
    );

  return {
    familyName: family?.name ?? null,
    members: members.map((m) => ({
      name: m.displayName ?? m.userName ?? m.userEmail ?? "Member",
      role: m.role,
      type: m.memberType,
    })),
  };
}

async function getUpcomingEvents(scope: ToolScope, input: Record<string, unknown>) {
  const days = clampDays(input);
  const now = Math.floor(Date.now() / 1000);
  const until = now + days * 86_400;

  const rows = await scope.db
    .select({
      title: schema.events.title,
      startAt: schema.events.startAt,
      type: schema.events.type,
      location: schema.events.location,
    })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.familyId, scope.familyId),
        eq(schema.events.status, "active"),
        gte(schema.events.startAt, now),
        lte(schema.events.startAt, until),
      ),
    )
    .orderBy(asc(schema.events.startAt))
    .limit(20);

  return {
    windowDays: days,
    events: rows.map((r) => ({
      title: r.title,
      startAt: new Date(r.startAt * 1000).toISOString(),
      type: r.type,
      location: r.location,
    })),
  };
}

async function getExpiringDocuments(scope: ToolScope, input: Record<string, unknown>) {
  const days = clampDays(input);
  const today = new Date();
  const untilDate = new Date(today.getTime() + days * 86_400_000);
  const todayIso = today.toISOString().slice(0, 10);
  const untilIso = untilDate.toISOString().slice(0, 10);

  const rows = await scope.db
    .select({
      title: schema.documents.title,
      category: schema.documents.category,
      expiryDate: schema.documents.expiryDate,
    })
    .from(schema.documents)
    .where(
      and(
        visibilityWhere(scope.familyId, scope.userId, scope.role),
        isNotNull(schema.documents.expiryDate),
        gte(schema.documents.expiryDate, todayIso),
        lte(schema.documents.expiryDate, untilIso),
      ),
    )
    .orderBy(asc(schema.documents.expiryDate))
    .limit(20);

  return { windowDays: days, documents: rows };
}

async function getOpenTasks(scope: ToolScope) {
  const rows = await scope.db
    .select({
      title: schema.tasks.title,
      dueDate: schema.tasks.dueDate,
      assigneeDisplayName: schema.familyMembers.displayName,
      assigneeUserName: schema.users.name,
    })
    .from(schema.tasks)
    .leftJoin(
      schema.familyMembers,
      eq(schema.tasks.assignedToMemberId, schema.familyMembers.id),
    )
    .leftJoin(schema.users, eq(schema.familyMembers.userId, schema.users.id))
    .where(
      and(eq(schema.tasks.familyId, scope.familyId), eq(schema.tasks.status, "open")),
    )
    .orderBy(asc(schema.tasks.dueDate))
    .limit(20);

  return {
    tasks: rows.map((r) => ({
      title: r.title,
      dueDate: r.dueDate,
      assignedTo: r.assigneeDisplayName ?? r.assigneeUserName ?? null,
    })),
  };
}

/**
 * Executes a tool the model asked for. Unknown tool names return an error
 * object (fed back to the model as the tool result) rather than throwing —
 * a model hallucinating a tool name shouldn't 500 the whole request.
 */
export async function executeTool(
  scope: ToolScope,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "get_family_overview":
      return getFamilyOverview(scope);
    case "get_upcoming_events":
      return getUpcomingEvents(scope, input);
    case "get_expiring_documents":
      return getExpiringDocuments(scope, input);
    case "get_open_tasks":
      return getOpenTasks(scope);
    default:
      return { error: `unknown tool: ${name}` };
  }
}
