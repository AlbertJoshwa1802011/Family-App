import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { audit, ACTIONS } from "../lib/audit";
import {
  MAX_TASK_DEPTH,
  TASK_VIEWS,
  ancestorChain,
  applyTaskView,
  attachChildCounts,
  descendantIds,
  depthOf,
  loadFamilyTasks,
  searchTasks,
  utcTodayIso,
  wouldCreateCycle,
  type TaskView,
} from "../lib/taskTree";

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
  parentTaskId: optionalId,
  priority: z.enum(["low", "medium", "high"]).optional(),
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
  parentTaskId: optionalId,
  priority: z.enum(["low", "medium", "high"]).optional(),
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

function presentFamilyTasks<T extends { id: string; parentTaskId?: string | null; status: string; subtasksJson?: string | null }>(
  familyTasks: T[],
  subset: T[],
) {
  const counted = attachChildCounts(familyTasks);
  const byId = new Map(counted.map((t) => [t.id, t]));
  return subset.map((t) => {
    const c = byId.get(t.id);
    return decorateTask({
      ...t,
      childCount: c?.childCount ?? 0,
      doneChildCount: c?.doneChildCount ?? 0,
    });
  });
}

function descendantMaxRelDepth(
  tasks: Array<{ id: string; parentTaskId?: string | null }>,
  rootId: string,
): number {
  const kids = descendantIds(tasks, rootId);
  if (kids.length === 0) return 0;
  const rootDepth = depthOf(tasks, rootId);
  let max = 0;
  for (const id of kids) {
    max = Math.max(max, depthOf(tasks, id) - rootDepth);
  }
  return max;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /tasks?familyId=:id&status=&assignee=&view=&q=
taskRoutes.get("/", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const db = getDb(c.env);
  let familyId = c.req.query("familyId");

  if (!familyId) {
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

  const viewRaw = c.req.query("view");
  if (viewRaw && !(TASK_VIEWS as readonly string[]).includes(viewRaw)) {
    return c.json(
      { error: "validation_error", issues: [{ path: ["view"], message: "invalid view" }] },
      400,
    );
  }
  const view = viewRaw as TaskView | undefined;
  const statusFilter = c.req.query("status");
  const assigneeFilter = c.req.query("assignee");
  const q = c.req.query("q") ?? "";

  const familyTasks = await loadFamilyTasks(db, familyId);
  let subset = familyTasks;
  if (statusFilter) {
    if (statusFilter !== "open" && statusFilter !== "done" && statusFilter !== "archived") {
      return c.json(
        { error: "validation_error", issues: [{ path: ["status"], message: "invalid status" }] },
        400,
      );
    }
    subset = subset.filter((t) => t.status === statusFilter);
  }
  if (assigneeFilter) {
    subset = subset.filter((t) => t.assignedToMemberId === assigneeFilter);
  }
  if (view) {
    subset = applyTaskView(subset, {
      view,
      myMemberId: membership.id,
      nowSecs: Math.floor(Date.now() / 1000),
      todayIso: utcTodayIso(),
    });
  } else if (!statusFilter) {
    subset = subset.filter((t) => t.status !== "archived");
  }
  if (q.trim()) {
    const hits = searchTasks(subset, q);
    const keep = new Set(hits.map((t) => t.id));
    for (const t of hits) {
      for (const a of ancestorChain(familyTasks, t.id)) keep.add(a.id);
    }
    subset = familyTasks.filter((t) => keep.has(t.id));
  }

  return c.json({ tasks: presentFamilyTasks(familyTasks, subset), view: view ?? null });
});

// POST /tasks — create a task.
taskRoutes.post("/", requireSession, zv(createTaskSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const familyTasks = await loadFamilyTasks(db, data.familyId);

  if (data.parentTaskId) {
    const parent = familyTasks.find((t) => t.id === data.parentTaskId);
    if (!parent) return c.json({ error: "invalid_parent_id" }, 400);
    if (depthOf(familyTasks, data.parentTaskId) + 1 > MAX_TASK_DEPTH) {
      return c.json({ error: "max_task_depth" }, 400);
    }
  }

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
    parentTaskId: data.parentTaskId ?? undefined,
    priority: data.priority ?? "medium",
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
  const all = [...familyTasks, task];
  const [presented] = presentFamilyTasks(all, [task]);
  return c.json({ task: presented }, 201);
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

  const familyTasks = await loadFamilyTasks(db, task.familyId);
  const ancestors = ancestorChain(familyTasks, task.id);
  const children = familyTasks.filter((t) => t.parentTaskId === task.id);
  const [presented] = presentFamilyTasks(familyTasks, [task]);

  return c.json({
    task: presented,
    ancestors: presentFamilyTasks(familyTasks, ancestors),
    children: presentFamilyTasks(familyTasks, children),
    depth: depthOf(familyTasks, task.id),
  });
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

  const familyTasks = await loadFamilyTasks(db, task.familyId);

  if (updates.parentTaskId !== undefined && updates.parentTaskId) {
    const parent = familyTasks.find((t) => t.id === updates.parentTaskId);
    if (!parent) return c.json({ error: "invalid_parent_id" }, 400);
    if (wouldCreateCycle(familyTasks, task.id, updates.parentTaskId)) {
      return c.json({ error: "task_cycle" }, 400);
    }
    const newDepth = depthOf(familyTasks, updates.parentTaskId) + 1;
    if (newDepth + descendantMaxRelDepth(familyTasks, task.id) > MAX_TASK_DEPTH) {
      return c.json({ error: "max_task_depth" }, 400);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const set: Partial<typeof schema.tasks.$inferInsert> = {
    updatedAt: now,
  };
  if (updates.title !== undefined) set.title = updates.title;
  if (updates.notes !== undefined) set.notes = updates.notes ?? undefined;
  if (updates.assignedToMemberId !== undefined) set.assignedToMemberId = updates.assignedToMemberId ?? undefined;
  if (updates.dueDate !== undefined) set.dueDate = updates.dueDate;
  if (updates.relatedDocumentId !== undefined) set.relatedDocumentId = updates.relatedDocumentId ?? undefined;
  if (updates.relatedEventId !== undefined) set.relatedEventId = updates.relatedEventId ?? undefined;
  if (updates.referredTaskId !== undefined) set.referredTaskId = updates.referredTaskId ?? undefined;
  if (updates.subtasks !== undefined) set.subtasksJson = updates.subtasks ? JSON.stringify(updates.subtasks) : undefined;
  if (updates.reminderDate !== undefined) set.reminderDate = updates.reminderDate ?? undefined;
  if (updates.remindMemberId !== undefined) set.remindMemberId = updates.remindMemberId ?? undefined;
  if (updates.priority !== undefined) set.priority = updates.priority;
  if (updates.parentTaskId !== undefined) set.parentTaskId = updates.parentTaskId;
  if (updates.status !== undefined) {
    set.status = updates.status;
    if (updates.status === "done") {
      set.completedAt = task.completedAt ?? now;
    } else if (updates.status === "open") {
      set.completedAt = null;
    }
  }

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

  return c.json({
    task: updatedTask
      ? presentFamilyTasks(
          familyTasks.map((t) => (t.id === taskId ? updatedTask : t)),
          [updatedTask],
        )[0]
      : updatedTask,
  });
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

  const familyTasks = await loadFamilyTasks(db, task.familyId);
  const descendants = descendantIds(familyTasks, task.id);
  const ids = [...descendants, task.id];
  await db.delete(schema.tasks).where(inArray(schema.tasks.id, ids));

  await audit(c, {
    familyId: task.familyId,
    action: ACTIONS.TASK_DELETED,
    targetType: "task",
    targetId: taskId,
    meta: { title: task.title },
  });

  return c.json({ ok: true, deleted: ids.length });
});
