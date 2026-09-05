import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import {
  allDocumentsInFamily,
  allMembersInFamily,
  eventInFamily,
  taskInFamily,
} from "../lib/familyScope";
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
  .optional();

const priorityEnum = z.enum(["low", "medium", "high"]);

const createTaskSchema = z.object({
  familyId: z.string().min(1),
  title: z.string().min(1).max(300),
  notes: z.string().max(2000).optional(),
  assignedToMemberId: z.string().optional(),
  dueDate: isoDate,
  relatedDocumentId: z.string().optional(),
  relatedEventId: z.string().optional(),
  parentTaskId: z.string().min(1).max(64).optional(),
  priority: priorityEnum.optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  notes: z.string().max(2000).nullable().optional(),
  assignedToMemberId: z.string().nullable().optional(),
  dueDate: isoDate,
  status: z.enum(["open", "done", "archived"]).optional(),
  relatedDocumentId: z.string().nullable().optional(),
  relatedEventId: z.string().nullable().optional(),
  parentTaskId: z.string().min(1).max(64).nullable().optional(),
  priority: priorityEnum.optional(),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

type TaskRow = typeof schema.tasks.$inferSelect;

interface AssigneeName {
  assignedToName: string | null;
}

async function assigneeNames(
  db: ReturnType<typeof getDb>,
  familyId: string,
  tasks: TaskRow[],
): Promise<Map<string, string | null>> {
  const ids = [
    ...new Set(
      tasks
        .map((t) => t.assignedToMemberId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const map = new Map<string, string | null>();
  if (ids.length === 0) return map;
  const members = await db
    .select({
      id: schema.familyMembers.id,
      displayName: schema.familyMembers.displayName,
      name: schema.users.name,
    })
    .from(schema.familyMembers)
    .leftJoin(schema.users, eq(schema.familyMembers.userId, schema.users.id))
    .where(eq(schema.familyMembers.familyId, familyId));
  for (const m of members) {
    map.set(m.id, m.displayName ?? m.name ?? null);
  }
  return map;
}

function present(
  task: TaskRow & { childCount: number; doneChildCount: number } & Partial<AssigneeName>,
) {
  return {
    id: task.id,
    familyId: task.familyId,
    title: task.title,
    notes: task.notes,
    assignedToMemberId: task.assignedToMemberId,
    assignedToName: task.assignedToName ?? null,
    dueDate: task.dueDate,
    status: task.status,
    priority: task.priority,
    parentTaskId: task.parentTaskId,
    createdBy: task.createdBy,
    relatedDocumentId: task.relatedDocumentId,
    relatedEventId: task.relatedEventId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    childCount: task.childCount,
    doneChildCount: task.doneChildCount,
  };
}

async function decorate(
  db: ReturnType<typeof getDb>,
  familyId: string,
  familyTasks: TaskRow[],
  subset: TaskRow[],
) {
  const counted = attachChildCounts(familyTasks);
  const countsById = new Map(counted.map((t) => [t.id, t]));
  const names = await assigneeNames(db, familyId, subset);
  return subset.map((t) => {
    const c = countsById.get(t.id);
    return present({
      ...t,
      childCount: c?.childCount ?? 0,
      doneChildCount: c?.doneChildCount ?? 0,
      assignedToName: t.assignedToMemberId
        ? (names.get(t.assignedToMemberId) ?? null)
        : null,
    });
  });
}

function canEditTask(
  task: TaskRow,
  userId: string,
  membership: { id: string; role: string },
): boolean {
  return (
    task.createdBy === userId ||
    task.assignedToMemberId === membership.id ||
    membership.role === "admin" ||
    membership.role === "owner"
  );
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /tasks?familyId=:id&status=&assignee=&view=&q=
taskRoutes.get("/", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const viewRaw = c.req.query("view");
  if (viewRaw && !(TASK_VIEWS as readonly string[]).includes(viewRaw)) {
    return c.json({ error: "validation_error", issues: [{ path: ["view"], message: "invalid view" }] }, 400);
  }
  const view = viewRaw as TaskView | undefined;
  const statusFilter = c.req.query("status");
  const assigneeFilter = c.req.query("assignee");
  const q = c.req.query("q") ?? "";

  const db = getDb(c.env);
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
    const nowSecs = Math.floor(Date.now() / 1000);
    subset = applyTaskView(subset, {
      view,
      myMemberId: membership.id,
      nowSecs,
      todayIso: utcTodayIso(),
    });
  } else if (!statusFilter) {
    // Default list hides archived so closed-for-good tasks don't clutter.
    subset = subset.filter((t) => t.status !== "archived");
  }
  if (q.trim()) {
    // Search within the current view, then pull in ancestors (even if they
    // don't match the view) so a hit 4 layers down still has a visible path.
    const hits = searchTasks(subset, q);
    const keep = new Set(hits.map((t) => t.id));
    for (const t of hits) {
      for (const a of ancestorChain(familyTasks, t.id)) keep.add(a.id);
    }
    subset = familyTasks.filter((t) => keep.has(t.id));
  }

  const tasks = await decorate(db, familyId, familyTasks, subset);
  return c.json({ tasks, view: view ?? null });
});

// POST /tasks — create a task (optionally nested under parentTaskId).
taskRoutes.post("/", requireSession, zv(createTaskSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);

  if (
    data.assignedToMemberId &&
    !(await allMembersInFamily(db, data.familyId, [data.assignedToMemberId]))
  ) {
    return c.json({ error: "invalid_member_ids" }, 400);
  }
  if (
    data.relatedDocumentId &&
    !(await allDocumentsInFamily(db, data.familyId, [data.relatedDocumentId]))
  ) {
    return c.json({ error: "invalid_document_ids" }, 400);
  }
  if (
    data.relatedEventId &&
    !(await eventInFamily(db, data.familyId, data.relatedEventId))
  ) {
    return c.json({ error: "invalid_event_id" }, 400);
  }

  const familyTasks = await loadFamilyTasks(db, data.familyId);

  if (data.parentTaskId) {
    if (!(await taskInFamily(db, data.familyId, data.parentTaskId))) {
      return c.json({ error: "invalid_parent_id" }, 400);
    }
    const parentDepth = depthOf(familyTasks, data.parentTaskId);
    if (parentDepth + 1 > MAX_TASK_DEPTH) {
      return c.json({ error: "max_task_depth" }, 400);
    }
  }

  const taskId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(schema.tasks).values({
    id: taskId,
    familyId: data.familyId,
    title: data.title,
    notes: data.notes,
    assignedToMemberId: data.assignedToMemberId,
    dueDate: data.dueDate,
    status: "open",
    parentTaskId: data.parentTaskId,
    priority: data.priority ?? "medium",
    createdBy: userId,
    relatedDocumentId: data.relatedDocumentId,
    relatedEventId: data.relatedEventId,
    updatedAt: now,
  });

  const task = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .get();

  const all = [...familyTasks, task!];
  const [presented] = await decorate(db, data.familyId, all, [task!]);
  return c.json({ task: presented }, 201);
});

// GET /tasks/:id — task + ancestor breadcrumb + direct children (all statuses).
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
  const [presented] = await decorate(db, task.familyId, familyTasks, [task]);
  const presentedAncestors = await decorate(db, task.familyId, familyTasks, ancestors);
  const presentedChildren = await decorate(db, task.familyId, familyTasks, children);

  return c.json({
    task: presented,
    ancestors: presentedAncestors,
    children: presentedChildren,
    depth: depthOf(familyTasks, task.id),
  });
});

// PATCH /tasks/:id — update fields, complete/reopen/archive, or reparent.
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

  if (!canEditTask(task, userId, membership)) {
    return c.json({ error: "forbidden" }, 403);
  }

  if (
    updates.assignedToMemberId &&
    !(await allMembersInFamily(db, task.familyId, [updates.assignedToMemberId]))
  ) {
    return c.json({ error: "invalid_member_ids" }, 400);
  }
  if (
    updates.relatedDocumentId &&
    !(await allDocumentsInFamily(db, task.familyId, [updates.relatedDocumentId]))
  ) {
    return c.json({ error: "invalid_document_ids" }, 400);
  }
  if (
    updates.relatedEventId &&
    !(await eventInFamily(db, task.familyId, updates.relatedEventId))
  ) {
    return c.json({ error: "invalid_event_id" }, 400);
  }

  const familyTasks = await loadFamilyTasks(db, task.familyId);

  if (updates.parentTaskId !== undefined) {
    if (updates.parentTaskId === null) {
      // promote to root — always allowed
    } else {
      if (!(await taskInFamily(db, task.familyId, updates.parentTaskId))) {
        return c.json({ error: "invalid_parent_id" }, 400);
      }
      if (wouldCreateCycle(familyTasks, task.id, updates.parentTaskId)) {
        return c.json({ error: "task_cycle" }, 400);
      }
      const newDepth = depthOf(familyTasks, updates.parentTaskId) + 1;
      const extra = descendantMaxRelDepth(familyTasks, task.id);
      if (newDepth + extra > MAX_TASK_DEPTH) {
        return c.json({ error: "max_task_depth" }, 400);
      }
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const set: Partial<typeof schema.tasks.$inferInsert> = {
    updatedAt: now,
  };
  if (updates.title !== undefined) set.title = updates.title;
  if (updates.notes !== undefined) set.notes = updates.notes;
  if (updates.assignedToMemberId !== undefined) set.assignedToMemberId = updates.assignedToMemberId;
  if (updates.dueDate !== undefined) set.dueDate = updates.dueDate;
  if (updates.relatedDocumentId !== undefined) set.relatedDocumentId = updates.relatedDocumentId;
  if (updates.relatedEventId !== undefined) set.relatedEventId = updates.relatedEventId;
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

  const updatedTask = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .get();

  const all = familyTasks.map((t) => (t.id === taskId ? updatedTask! : t));
  const [presented] = await decorate(db, task.familyId, all, [updatedTask!]);
  return c.json({ task: presented });
});

// DELETE /tasks/:id — hard delete this task AND its descendants.
// D1 FK cascades are advisory; we delete explicitly (deepest-first).
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

  return c.json({ ok: true, deleted: ids.length });
});

/** Deepest relative depth of the subtree rooted at `rootId` (0 if no children). */
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
