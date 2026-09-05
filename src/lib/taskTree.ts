/**
 * Pure helpers for nested family tasks.
 *
 * The API returns a flat list. The UI builds a forest, applies views, and
 * searches without another round-trip — important when a family has hundreds
 * or thousands of tasks with several layers of subtasks.
 */

export const MAX_TASK_DEPTH = 5; // root = 0; deepest allowed child = 5
export const RECENT_WINDOW_SECS = 14 * 86_400;
export const DUE_SOON_DAYS = 14;

export type TaskStatus = "open" | "done" | "archived";
export type TaskPriority = "low" | "medium" | "high";

export const TASK_VIEWS = [
  "todo",
  "priority",
  "due",
  "recent",
  "mine",
  "completed",
] as const;

export type TaskView = (typeof TASK_VIEWS)[number];

export interface TaskRecord {
  id: string;
  title: string;
  notes?: string | null;
  assignedToMemberId?: string | null;
  assignedToName?: string | null;
  dueDate?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  parentTaskId?: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
  childCount: number;
  doneChildCount: number;
}

export interface TaskNode extends TaskRecord {
  children: TaskNode[];
  depth: number;
}

export interface TaskViewOptions {
  view: TaskView;
  /** Family-membership id of the signed-in user — required for `mine`. */
  myMemberId?: string | null;
  /** Unix seconds. Pass a snapshot so render stays pure. */
  nowSecs: number;
  /** UTC yyyy-mm-dd of "today". Pass a snapshot so render stays pure. */
  todayIso: string;
}

const PRIORITY_RANK: Record<TaskPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** Fill childCount / doneChildCount from a flat family list (any status). */
export function attachChildCounts<T extends { id: string; parentTaskId?: string | null; status: TaskStatus }>(
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

export function depthOf(
  tasks: Array<{ id: string; parentTaskId?: string | null }>,
  id: string,
): number {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let depth = 0;
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current?.parentTaskId) {
    if (seen.has(current.id)) return depth; // cycle guard
    seen.add(current.id);
    const parent = byId.get(current.parentTaskId);
    if (!parent) break;
    depth += 1;
    current = parent;
    if (depth > MAX_TASK_DEPTH + 2) break;
  }
  return depth;
}

/** Depth a new child of `parentId` would have. Root → 0. */
export function childDepthOf(
  tasks: Array<{ id: string; parentTaskId?: string | null }>,
  parentId: string | null | undefined,
): number {
  if (!parentId) return 0;
  return depthOf(tasks, parentId) + 1;
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

export function ancestorPath<T extends { id: string; parentTaskId?: string | null }>(
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

export function formatTaskPath(ancestors: Array<{ title: string }>): string {
  return ancestors.map((a) => a.title).join(" › ");
}

function stampDepth(node: TaskNode, depth: number) {
  node.depth = depth;
  for (const child of node.children) stampDepth(child, depth + 1);
}

/**
 * Build a forest from a (possibly filtered) flat list.
 *
 * If a node's parent is not in `tasks` (e.g. the parent was completed and
 * dropped from the To-do view), the node is promoted to a root so leftover
 * subtasks stay visible and actionable.
 */
export function buildForest(tasks: TaskRecord[]): TaskNode[] {
  const ids = new Set(tasks.map((t) => t.id));
  const nodes = new Map<string, TaskNode>();
  for (const t of tasks) {
    nodes.set(t.id, { ...t, children: [], depth: 0 });
  }

  const roots: TaskNode[] = [];
  for (const t of tasks) {
    const node = nodes.get(t.id)!;
    if (t.parentTaskId && ids.has(t.parentTaskId)) {
      nodes.get(t.parentTaskId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  for (const root of roots) stampDepth(root, 0);
  return roots;
}

export function flattenForest(forest: TaskNode[]): TaskNode[] {
  const out: TaskNode[] = [];
  function walk(nodes: TaskNode[]) {
    for (const n of nodes) {
      out.push(n);
      if (n.children.length) walk(n.children);
    }
  }
  walk(forest);
  return out;
}

function utcDayOffset(todayIso: string, days: number): string {
  const [y, m, d] = todayIso.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function sortByDueThenCreated<T extends { dueDate?: string | null; createdAt: number }>(
  a: T,
  b: T,
): number {
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;
  return b.createdAt - a.createdAt;
}

/**
 * Filter + sort a flat family list into one of the planning views.
 * Child counts on each row should already reflect the unfiltered family.
 */
export function applyTaskView<T extends TaskRecord>(
  tasks: T[],
  opts: TaskViewOptions,
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

/**
 * Case-insensitive search over title + notes. Matching nodes plus every
 * ancestor are returned so a hit 4 layers down still has a visible path.
 */
export function searchTasks<T extends TaskRecord>(tasks: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return tasks;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const keep = new Set<string>();
  for (const t of tasks) {
    const hay = `${t.title} ${t.notes ?? ""}`.toLowerCase();
    if (!hay.includes(q)) continue;
    keep.add(t.id);
    for (const a of ancestorPath(tasks, t.id)) keep.add(a.id);
  }
  return tasks.filter((t) => keep.has(t.id) && byId.has(t.id));
}

export type DueTone = "danger" | "warning" | "success" | "neutral";

export interface DueStatus {
  tone: DueTone;
  label: string;
  overdue: boolean;
}

/** Task due-date badge. Compares at UTC midnight — same rule as expiry.ts. */
export function dueStatus(date?: string | null, todayIso?: string): DueStatus | null {
  if (!date) return null;
  const parts = date.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [y, m, d] = parts;
  const targetUtc = Date.UTC(y, m - 1, d);

  let todayUtc: number;
  if (todayIso) {
    const [ty, tm, td] = todayIso.split("-").map(Number);
    todayUtc = Date.UTC(ty, tm - 1, td);
  } else {
    const n = new Date();
    todayUtc = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  }
  const days = Math.round((targetUtc - todayUtc) / 86_400_000);

  if (days < 0) return { tone: "danger", label: "Overdue", overdue: true };
  if (days === 0) return { tone: "danger", label: "Due today", overdue: true };
  if (days <= 7) return { tone: "danger", label: `Due in ${days}d`, overdue: false };
  if (days <= 30) return { tone: "warning", label: `Due in ${days}d`, overdue: false };
  return { tone: "neutral", label: `Due ${date}`, overdue: false };
}

/** Views that render as a nested tree vs a flat work-queue with a path. */
export function isTreeView(view: TaskView): boolean {
  return view === "todo" || view === "mine";
}

export function priorityLabel(p: TaskPriority): string {
  if (p === "high") return "High";
  if (p === "low") return "Low";
  return "Medium";
}
