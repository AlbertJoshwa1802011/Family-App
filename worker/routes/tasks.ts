import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { audit, ACTIONS } from "../lib/audit";

export const taskRoutes = new Hono<HonoEnv>();

// ── Validation schemas ────────────────────────────────────────────────────────

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-mm-dd")
  .nullish();

const subtaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(300),
  done: z.boolean().default(false),
});

const optionalText = z.string().max(2000).nullish();
const optionalId = z.string().min(1).nullish();

const createTaskSchema = z.object({
  familyId: z.string().min(1),
  title: z.string().min(1).max(300),
  notes: optionalText,
  assignedToMemberId: optionalId,
  dueDate: isoDate,
  relatedDocumentId: optionalId,
  relatedEventId: optionalId,
  referredTaskId: optionalId,
  subtasks: z.array(subtaskSchema).max(20).nullish(),
  reminderDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-mm-dd")
    .nullish(),
  remindMemberId: optionalId,
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  notes: optionalText,
  assignedToMemberId: optionalId,
  dueDate: isoDate,
  status: z.enum(["open", "done", "archived"]).optional(),
  relatedDocumentId: optionalId,
  relatedEventId: optionalId,
  referredTaskId: optionalId,
  subtasks: z.array(subtaskSchema).max(20).nullish(),
  reminderDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-mm-dd")
    .nullish(),
  remindMemberId: optionalId,
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

type Subtask = { id: string; title: string; done: boolean };

function parseSubtasks(json: string | null | undefined): Subtask[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as Subtask[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function decorateTask<T extends { subtasksJson?: string | null }>(row: T) {
  return { ...row, subtasks: parseSubtasks(row.subtasksJson) };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /tasks?familyId=:id&status=open|done|archived&assignee=:memberId
taskRoutes.get("/", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const db = getDb(c.env);
  let familyId = c.req.query("familyId");

  if (!familyId) {
    // Resolve user's first active family
    const membership = await db
      .select({ familyId: schema.familyMembers.familyId })
      .from(schema.familyMembers)
      .where(
        and(
          eq(schema.familyMembers.userId, userId),
          eq(schema.familyMembers.status, "active"),
        ),
      )
      .get();
    if (!membership) return c.json({ tasks: [] });
    familyId = membership.familyId;
  }

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const statusFilter = c.req.query("status");
  const assigneeFilter = c.req.query("assignee");

  const conditions = [eq(schema.tasks.familyId, familyId)];
  if (statusFilter) {
    conditions.push(eq(schema.tasks.status, statusFilter as "open" | "done" | "archived"));
  }
  if (assigneeFilter) {
    conditions.push(eq(schema.tasks.assignedToMemberId, assigneeFilter));
  }

  const tasks = await db
    .select()
    .from(schema.tasks)
    .where(and(...(conditions as [typeof conditions[0], ...typeof conditions])))
    .orderBy(asc(schema.tasks.dueDate), desc(schema.tasks.createdAt));

  return c.json({ tasks: tasks.map(decorateTask) });
});

// POST /tasks — create a task.
taskRoutes.post("/", requireSession, zv(createTaskSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const taskId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(schema.tasks).values({
    id: taskId,
    familyId: data.familyId,
    title: data.title,
    notes: data.notes ?? undefined,
    assignedToMemberId: data.assignedToMemberId ?? undefined,
    dueDate: data.dueDate,
    status: "open",
    createdBy: userId,
    relatedDocumentId: data.relatedDocumentId ?? undefined,
    relatedEventId: data.relatedEventId ?? undefined,
    referredTaskId: data.referredTaskId ?? undefined,
    subtasksJson: data.subtasks ? JSON.stringify(data.subtasks) : undefined,
    reminderDate: data.reminderDate ?? undefined,
    remindMemberId: data.remindMemberId ?? undefined,
    updatedAt: now,
  });

  await audit(c, {
    familyId: data.familyId,
    action: ACTIONS.TASK_CREATED,
    targetType: "task",
    targetId: taskId,
    meta: { title: data.title },
  });

  const task = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .get();

  if (!task) return c.json({ error: "internal_error" }, 500);
  return c.json({ task: decorateTask(task) }, 201);
});

// GET /tasks/:id
taskRoutes.get("/:id", requireSession, async (c) => {
  const { id: taskId } = c.req.param();
  const db = getDb(c.env);

  const task = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .get();

  if (!task) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, task.familyId);
  if (membership instanceof Response) return membership;

  return c.json({ task: decorateTask(task) });
});

// PATCH /tasks/:id — update task fields or toggle status.
taskRoutes.patch("/:id", requireSession, zv(updateTaskSchema), async (c) => {
  const { id: taskId } = c.req.param();
  const userId = c.get("userId")!;
  const updates = c.req.valid("json");
  const db = getDb(c.env);

  const task = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .get();

  if (!task) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, task.familyId);
  if (membership instanceof Response) return membership;

  // Members can only update tasks they created or are assigned to
  const canEdit =
    task.createdBy === userId ||
    task.assignedToMemberId === membership.id ||
    membership.role === "admin" ||
    membership.role === "owner";

  if (!canEdit) return c.json({ error: "forbidden" }, 403);

  const set: Partial<typeof schema.tasks.$inferInsert> = {
    updatedAt: Math.floor(Date.now() / 1000),
  };
  if (updates.title !== undefined) set.title = updates.title;
  if (updates.notes !== undefined) set.notes = updates.notes ?? undefined;
  if (updates.assignedToMemberId !== undefined) set.assignedToMemberId = updates.assignedToMemberId ?? undefined;
  if (updates.dueDate !== undefined) set.dueDate = updates.dueDate;
  if (updates.status !== undefined) set.status = updates.status;
  if (updates.relatedDocumentId !== undefined) set.relatedDocumentId = updates.relatedDocumentId ?? undefined;
  if (updates.relatedEventId !== undefined) set.relatedEventId = updates.relatedEventId ?? undefined;
  if (updates.referredTaskId !== undefined) set.referredTaskId = updates.referredTaskId ?? undefined;
  if (updates.subtasks !== undefined) set.subtasksJson = updates.subtasks ? JSON.stringify(updates.subtasks) : undefined;
  if (updates.reminderDate !== undefined) set.reminderDate = updates.reminderDate ?? undefined;
  if (updates.remindMemberId !== undefined) set.remindMemberId = updates.remindMemberId ?? undefined;

  await db.update(schema.tasks).set(set).where(eq(schema.tasks.id, taskId));

  await audit(c, {
    familyId: task.familyId,
    action:
      updates.status === "done" ? ACTIONS.TASK_COMPLETED : ACTIONS.TASK_UPDATED,
    targetType: "task",
    targetId: taskId,
  });

  const updatedTask = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .get();

  return c.json({ task: updatedTask ? decorateTask(updatedTask) : updatedTask });
});

// DELETE /tasks/:id — hard delete.
taskRoutes.delete("/:id", requireSession, async (c) => {
  const { id: taskId } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const task = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .get();

  if (!task) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, task.familyId);
  if (membership instanceof Response) return membership;

  if (task.createdBy !== userId && membership.role === "member") {
    return c.json({ error: "forbidden" }, 403);
  }

  await db.delete(schema.tasks).where(eq(schema.tasks.id, taskId));

  await audit(c, {
    familyId: task.familyId,
    action: ACTIONS.TASK_DELETED,
    targetType: "task",
    targetId: taskId,
    meta: { title: task.title },
  });

  return c.json({ ok: true });
});
