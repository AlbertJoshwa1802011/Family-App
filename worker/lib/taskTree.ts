/**
 * Server-side nested-task helpers. Graph walks run in memory over the family's
 * task rows — D1 has no recursive CTE we want to depend on, and a family-sized
 * list (even thousands) is cheap to walk once per request.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { schema } from "../db/client";

export const MAX_TASK_DEPTH = 5;

export type TaskRow = typeof schema.tasks.$inferSelect;

export async function loadFamilyTasks(db: Db, familyId: string): Promise<TaskRow[]> {
  return db.select().from(schema.tasks).where(eq(schema.tasks.familyId, familyId));
}

export function depthOf(
  tasks: Array<{ id: string; parentTaskId?: string | null }>,
  id: string,
): number {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let depth = 0;
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current?.parentTaskId) {
    if (seen.has(current.id)) return depth;
    seen.add(current.id);
    const parent = byId.get(current.parentTaskId);
    if (!parent) break;
    depth += 1;
    current = parent;
    if (depth > MAX_TASK_DEPTH + 2) break;
  }
  return depth;
}

export function wouldCreateCycle(
  tasks: Array<{ id: string; parentTaskId?: string | null }>,
  taskId: string,
  newParentId: string,
): boolean {
  if (taskId === newParentId) return true;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  let current: { id: string; parentTaskId?: string | null } | undefined =
    byId.get(newParentId);
  while (current) {
    if (current.id === taskId) return true;
    if (seen.has(current.id)) return true;
    seen.add(current.id);
    current = current.parentTaskId ? byId.get(current.parentTaskId) : undefined;
  }
  return false;
}

export function descendantIds(
  tasks: Array<{ id: string; parentTaskId?: string | null }>,
  rootId: string,
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const t of tasks) {
    if (!t.parentTaskId) continue;
    const list = childrenOf.get(t.parentTaskId);
    if (list) list.push(t.id);
    else childrenOf.set(t.parentTaskId, [t.id]);
  }
  const out: string[] = [];
  const queue = [...(childrenOf.get(rootId) ?? [])];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    const kids = childrenOf.get(id);
    if (kids) queue.push(...kids);
  }
  return out;
}

export function ancestorChain<T extends { id: string; parentTaskId?: string | null }>(
  tasks: T[],
  id: string,
): T[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const path: T[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current?.parentTaskId) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    const parent = byId.get(current.parentTaskId);
    if (!parent) break;
    path.unshift(parent);
    current = parent;
  }
  return path;
}

export function attachChildCounts<T extends { id: string; parentTaskId?: string | null; status: string }>(
  tasks: T[],
): Array<T & { childCount: number; doneChildCount: number }> {
  const childCount = new Map<string, number>();
  const doneChildCount = new Map<string, number>();
  for (const t of tasks) {
    const parent = t.parentTaskId;
    if (!parent) continue;
    childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
    if (t.status === "done") {
      doneChildCount.set(parent, (doneChildCount.get(parent) ?? 0) + 1);
    }
  }
  return tasks.map((t) => ({
    ...t,
    childCount: childCount.get(t.id) ?? 0,
    doneChildCount: doneChildCount.get(t.id) ?? 0,
  }));
}

export const TASK_VIEWS = [
  "todo",
  "priority",
  "due",
  "recent",
  "mine",
  "completed",
] as const;

export type TaskView = (typeof TASK_VIEWS)[number];

export const RECENT_WINDOW_SECS = 14 * 86_400;
export const DUE_SOON_DAYS = 14;

const PRIORITY_RANK: Record<"low" | "medium" | "high", number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function utcDayOffset(todayIso: string, days: number): string {
  const [y, m, d] = todayIso.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function sortByDueThenCreated<
  T extends { dueDate?: string | null; createdAt: number },
>(a: T, b: T): number {
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;
  return b.createdAt - a.createdAt;
}

export function utcTodayIso(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function applyTaskView<
  T extends {
    status: string;
    priority: "low" | "medium" | "high";
    dueDate?: string | null;
    createdAt: number;
    completedAt?: number | null;
    updatedAt: number;
    assignedToMemberId?: string | null;
  },
>(
  tasks: T[],
  opts: {
    view: TaskView;
    myMemberId?: string | null;
    nowSecs: number;
    todayIso: string;
  },
): T[] {
  const { view, myMemberId, nowSecs, todayIso } = opts;
  const dueLimit = utcDayOffset(todayIso, DUE_SOON_DAYS);

  let filtered: T[];
  switch (view) {
    case "todo":
      filtered = tasks.filter((t) => t.status === "open");
      filtered.sort(sortByDueThenCreated);
      break;
    case "completed":
      filtered = tasks.filter((t) => t.status === "done");
      filtered.sort(
        (a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt),
      );
      break;
    case "recent":
      filtered = tasks.filter(
        (t) => t.status !== "archived" && t.createdAt >= nowSecs - RECENT_WINDOW_SECS,
      );
      filtered.sort((a, b) => b.createdAt - a.createdAt);
      break;
    case "priority":
      filtered = tasks.filter((t) => t.status === "open");
      filtered.sort((a, b) => {
        const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (pr !== 0) return pr;
        return sortByDueThenCreated(a, b);
      });
      break;
    case "due":
      filtered = tasks.filter(
        (t) =>
          t.status === "open" &&
          Boolean(t.dueDate) &&
          (t.dueDate as string) <= dueLimit,
      );
      filtered.sort(sortByDueThenCreated);
      break;
    case "mine":
      filtered = tasks.filter(
        (t) => t.status === "open" && t.assignedToMemberId === myMemberId,
      );
      filtered.sort(sortByDueThenCreated);
      break;
    default:
      filtered = tasks.filter((t) => t.status !== "archived");
      filtered.sort(sortByDueThenCreated);
  }
  return filtered;
}

export function searchTasks<
  T extends { id: string; title: string; notes?: string | null; parentTaskId?: string | null },
>(tasks: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return tasks;
  const keep = new Set<string>();
  for (const t of tasks) {
    const hay = `${t.title} ${t.notes ?? ""}`.toLowerCase();
    if (!hay.includes(q)) continue;
    keep.add(t.id);
    for (const a of ancestorChain(tasks, t.id)) keep.add(a.id);
  }
  return tasks.filter((t) => keep.has(t.id));
}
