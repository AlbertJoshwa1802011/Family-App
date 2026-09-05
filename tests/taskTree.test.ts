import { describe, expect, it } from "vitest";
import {
  MAX_TASK_DEPTH,
  ancestorPath,
  applyTaskView,
  attachChildCounts,
  buildForest,
  childDepthOf,
  descendantIds,
  depthOf,
  dueStatus,
  flattenForest,
  formatTaskPath,
  isTreeView,
  searchTasks,
  wouldCreateCycle,
  type TaskRecord,
} from "../src/lib/taskTree";

function task(
  partial: Partial<TaskRecord> & Pick<TaskRecord, "id" | "title">,
): TaskRecord {
  return {
    notes: null,
    assignedToMemberId: null,
    assignedToName: null,
    dueDate: null,
    status: "open",
    priority: "medium",
    parentTaskId: null,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
    completedAt: null,
    childCount: 0,
    doneChildCount: 0,
    ...partial,
  };
}

describe("task tree graph", () => {
  const root = task({ id: "r", title: "Travel" });
  const a = task({ id: "a", title: "Passport", parentTaskId: "r" });
  const a1 = task({ id: "a1", title: "Photo", parentTaskId: "a" });
  const a2 = task({ id: "a2", title: "Form", parentTaskId: "a", status: "done" });
  const b = task({ id: "b", title: "Flights", parentTaskId: "r" });
  const all = [root, a, a1, a2, b];

  it("computes depth from the root (0) down through nested subtasks", () => {
    expect(depthOf(all, "r")).toBe(0);
    expect(depthOf(all, "a")).toBe(1);
    expect(depthOf(all, "a1")).toBe(2);
    expect(childDepthOf(all, "a1")).toBe(3);
    expect(childDepthOf(all, null)).toBe(0);
  });

  it("lists descendants in breadth-first order and ancestor paths for breadcrumbs", () => {
    expect(descendantIds(all, "r").sort()).toEqual(["a", "a1", "a2", "b"].sort());
    expect(descendantIds(all, "a").sort()).toEqual(["a1", "a2"].sort());
    expect(descendantIds(all, "a1")).toEqual([]);
    expect(ancestorPath(all, "a1").map((t) => t.id)).toEqual(["r", "a"]);
    expect(formatTaskPath(ancestorPath(all, "a1"))).toBe("Travel › Passport");
  });

  it("detects reparent cycles (cannot nest a task under its own descendant)", () => {
    expect(wouldCreateCycle(all, "r", "a1")).toBe(true);
    expect(wouldCreateCycle(all, "a", "a")).toBe(true);
    expect(wouldCreateCycle(all, "b", "a")).toBe(false);
  });

  it("attaches child / done-child counts from the unfiltered family list", () => {
    const counted = attachChildCounts(all);
    const byId = Object.fromEntries(counted.map((t) => [t.id, t]));
    expect(byId.r.childCount).toBe(2);
    expect(byId.r.doneChildCount).toBe(0);
    expect(byId.a.childCount).toBe(2);
    expect(byId.a.doneChildCount).toBe(1);
    expect(byId.a1.childCount).toBe(0);
  });

  it("builds a nested forest and flattens it in display order", () => {
    const forest = buildForest(attachChildCounts(all));
    expect(forest).toHaveLength(1);
    expect(forest[0].id).toBe("r");
    expect(forest[0].children.map((c) => c.id)).toEqual(["a", "b"]);
    expect(forest[0].children[0].children.map((c) => c.id)).toEqual(["a1", "a2"]);
    expect(flattenForest(forest).map((n) => n.id)).toEqual(["r", "a", "a1", "a2", "b"]);
    expect(flattenForest(forest).map((n) => n.depth)).toEqual([0, 1, 2, 2, 1]);
  });

  it("promotes orphaned subtasks to roots when the parent is missing from the filtered set", () => {
    // To-do view dropped the completed parent `a2` and also `a` — leftover `a1` must stay visible.
    const openOnly = attachChildCounts(all).filter((t) => t.status === "open" && t.id !== "a" && t.id !== "r");
    const forest = buildForest(openOnly);
    expect(forest.map((n) => n.id).sort()).toEqual(["a1", "b"].sort());
    expect(forest.every((n) => n.depth === 0)).toBe(true);
  });
});

describe("task views", () => {
  const nowSecs = 1_800_000_000;
  const todayIso = "2026-09-05";
  const tasks = attachChildCounts([
    task({
      id: "open-high",
      title: "Call insurer",
      priority: "high",
      dueDate: "2026-09-06",
      createdAt: nowSecs - 100,
    }),
    task({
      id: "open-low",
      title: "Buy stamps",
      priority: "low",
      createdAt: nowSecs - 50,
    }),
    task({
      id: "overdue",
      title: "Renew passport",
      priority: "medium",
      dueDate: "2026-09-01",
      assignedToMemberId: "me",
      createdAt: nowSecs - 200,
    }),
    task({
      id: "later",
      title: "Plan reunion",
      dueDate: "2026-12-01",
      createdAt: nowSecs - 10,
    }),
    task({
      id: "done",
      title: "Book dentist",
      status: "done",
      completedAt: nowSecs - 20,
      createdAt: nowSecs - 400,
    }),
    task({
      id: "old-done",
      title: "Ancient",
      status: "done",
      completedAt: nowSecs - RECENT_TOO_OLD(),
      createdAt: nowSecs - RECENT_TOO_OLD(),
    }),
    task({
      id: "archived",
      title: "Hidden",
      status: "archived",
      createdAt: nowSecs - 5,
    }),
    task({
      id: "fresh",
      title: "Just added",
      createdAt: nowSecs - 60,
      parentTaskId: "open-high",
    }),
  ]);

  function RECENT_TOO_OLD() {
    return 15 * 86_400;
  }

  const opts = { nowSecs, todayIso, myMemberId: "me" as string | null };

  it("todo hides completed and archived, keeping only open work", () => {
    const ids = applyTaskView(tasks, { ...opts, view: "todo" }).map((t) => t.id);
    expect(ids).toContain("open-high");
    expect(ids).toContain("fresh");
    expect(ids).not.toContain("done");
    expect(ids).not.toContain("archived");
  });

  it("completed is newest-finished first and excludes open work", () => {
    const ids = applyTaskView(tasks, { ...opts, view: "completed" }).map((t) => t.id);
    expect(ids[0]).toBe("done");
    expect(ids).toContain("old-done");
    expect(ids).not.toContain("open-high");
  });

  it("recent is last-14-days, newest first, and skips archived", () => {
    const ids = applyTaskView(tasks, { ...opts, view: "recent" }).map((t) => t.id);
    expect(ids[0]).toBe("later"); // createdAt = nowSecs - 10, newest
    expect(ids).toContain("fresh");
    expect(ids).not.toContain("old-done");
    expect(ids).not.toContain("archived");
  });

  it("priority lists open work high → low", () => {
    const ids = applyTaskView(tasks, { ...opts, view: "priority" }).map((t) => t.id);
    expect(ids[0]).toBe("open-high");
    expect(ids.indexOf("open-high")).toBeLessThan(ids.indexOf("overdue"));
    expect(ids.indexOf("overdue")).toBeLessThan(ids.indexOf("open-low"));
    expect(ids).not.toContain("done");
  });

  it("due soon includes overdue and the next 14 days, not far-future", () => {
    const ids = applyTaskView(tasks, { ...opts, view: "due" }).map((t) => t.id);
    expect(ids).toContain("overdue");
    expect(ids).toContain("open-high");
    expect(ids).not.toContain("later");
    expect(ids[0]).toBe("overdue"); // earlier due date first
  });

  it("mine is open tasks assigned to the current member", () => {
    const ids = applyTaskView(tasks, { ...opts, view: "mine" }).map((t) => t.id);
    expect(ids).toEqual(["overdue"]);
  });

  it("search keeps ancestor rows so a deep hit still has a path", () => {
    const family = attachChildCounts([
      task({ id: "r", title: "House" }),
      task({ id: "k", title: "Kitchen", parentTaskId: "r" }),
      task({ id: "t", title: "Replace tap washer", parentTaskId: "k" }),
    ]);
    const hits = searchTasks(family, "washer");
    expect(hits.map((t) => t.id).sort()).toEqual(["k", "r", "t"].sort());
  });
});

describe("dueStatus + view metadata", () => {
  it("classifies overdue / today / soon at UTC midnight", () => {
    expect(dueStatus("2026-09-04", "2026-09-05")?.label).toBe("Overdue");
    expect(dueStatus("2026-09-05", "2026-09-05")?.label).toBe("Due today");
    expect(dueStatus("2026-09-08", "2026-09-05")?.label).toBe("Due in 3d");
    expect(dueStatus(null)).toBeNull();
  });

  it("todo and mine render as trees; other views are work queues", () => {
    expect(isTreeView("todo")).toBe(true);
    expect(isTreeView("mine")).toBe(true);
    expect(isTreeView("completed")).toBe(false);
    expect(isTreeView("priority")).toBe(false);
  });

  it("caps nesting at MAX_TASK_DEPTH", () => {
    expect(MAX_TASK_DEPTH).toBe(5);
    const chain: TaskRecord[] = [];
    for (let i = 0; i <= 6; i++) {
      chain.push(
        task({
          id: `n${i}`,
          title: `L${i}`,
          parentTaskId: i === 0 ? null : `n${i - 1}`,
        }),
      );
    }
    expect(depthOf(chain, "n5")).toBe(5);
    expect(childDepthOf(chain, "n5")).toBe(6);
    expect(childDepthOf(chain, "n5") > MAX_TASK_DEPTH).toBe(true);
  });
});
