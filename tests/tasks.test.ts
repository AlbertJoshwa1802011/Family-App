/**
 * Nested tasks: create/list/complete/archive, views, depth cap, cascade delete.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../worker/index";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

let t: TestEnv;
let familyId: string;
let owner: ReturnType<typeof seedActor>;
let member: ReturnType<typeof seedActor>;

beforeEach(() => {
  t = createTestEnv();
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  owner = seedActor(t.sqlite, familyId, "owner", { name: "Olive Owner" });
  member = seedActor(t.sqlite, familyId, "member", { name: "Milo Member" });
});

function req(method: string, path: string, cookie: string, body?: object) {
  return app.request(
    path,
    {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
    t.env,
  );
}

interface ApiTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  parentTaskId: string | null;
  assignedToMemberId: string | null;
  assignedToName: string | null;
  completedAt: number | null;
  childCount: number;
  doneChildCount: number;
  dueDate: string | null;
  createdAt: number;
}

async function createTask(
  cookie: string,
  body: Record<string, unknown>,
): Promise<ApiTask> {
  const res = await req("POST", "/api/tasks", cookie, { familyId, ...body });
  expect(res.status).toBe(201);
  return ((await res.json()) as { task: ApiTask }).task;
}

describe("task nesting", () => {
  it("creates a subtask under a parent in the same family", async () => {
    const parent = await createTask(owner.cookie, { title: "Travel prep" });
    const child = await createTask(owner.cookie, {
      title: "Renew passport",
      parentTaskId: parent.id,
      priority: "high",
    });
    expect(child.parentTaskId).toBe(parent.id);
    expect(child.priority).toBe("high");
    expect(child.status).toBe("open");

    const list = await req("GET", `/api/tasks?familyId=${familyId}`, member.cookie);
    expect(list.status).toBe(200);
    const { tasks } = (await list.json()) as { tasks: ApiTask[] };
    const listedParent = tasks.find((x) => x.id === parent.id)!;
    expect(listedParent.childCount).toBe(1);
    expect(listedParent.doneChildCount).toBe(0);
  });

  it("GET /tasks/:id returns ancestors, children, and depth", async () => {
    const root = await createTask(owner.cookie, { title: "House" });
    const mid = await createTask(owner.cookie, {
      title: "Kitchen",
      parentTaskId: root.id,
    });
    const leaf = await createTask(owner.cookie, {
      title: "Replace tap",
      parentTaskId: mid.id,
    });

    const res = await req("GET", `/api/tasks/${leaf.id}`, member.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      task: ApiTask;
      ancestors: ApiTask[];
      children: ApiTask[];
      depth: number;
    };
    expect(body.task.id).toBe(leaf.id);
    expect(body.ancestors.map((a) => a.id)).toEqual([root.id, mid.id]);
    expect(body.depth).toBe(2);
    expect(body.children).toEqual([]);

    const midRes = await req("GET", `/api/tasks/${mid.id}`, member.cookie);
    const midBody = (await midRes.json()) as { children: ApiTask[] };
    expect(midBody.children.map((c) => c.id)).toEqual([leaf.id]);
  });

  it("rejects a parent from another family (400 invalid_parent_id)", async () => {
    const strangerUser = seedUser(t.sqlite);
    const otherFamily = seedFamily(t.sqlite, strangerUser.id);
    const stranger = seedActor(t.sqlite, otherFamily.id, "owner");
    const foreign = await req("POST", "/api/tasks", stranger.cookie, {
      familyId: otherFamily.id,
      title: "Foreign parent",
    });
    const { task: foreignTask } = (await foreign.json()) as { task: ApiTask };

    const res = await req("POST", "/api/tasks", owner.cookie, {
      familyId,
      title: "Sneaky child",
      parentTaskId: foreignTask.id,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_parent_id");
  });

  it("caps nesting at 5 layers below the root", async () => {
    let parentId: string | undefined;
    for (let i = 0; i <= 5; i++) {
      const created = await createTask(owner.cookie, {
        title: `L${i}`,
        parentTaskId: parentId,
      });
      parentId = created.id;
    }
    // parentId is now depth 5; a child would be depth 6 → rejected
    const res = await req("POST", "/api/tasks", owner.cookie, {
      familyId,
      title: "too deep",
      parentTaskId: parentId,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("max_task_depth");
  });

  it("rejects reparenting a task under its own descendant (cycle)", async () => {
    const root = await createTask(owner.cookie, { title: "Root" });
    const child = await createTask(owner.cookie, {
      title: "Child",
      parentTaskId: root.id,
    });
    const res = await req("PATCH", `/api/tasks/${root.id}`, owner.cookie, {
      parentTaskId: child.id,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("task_cycle");
  });

  it("delete cascades to all descendants (explicit, not FK-only)", async () => {
    const root = await createTask(owner.cookie, { title: "Root" });
    const mid = await createTask(owner.cookie, {
      title: "Mid",
      parentTaskId: root.id,
    });
    const leaf = await createTask(owner.cookie, {
      title: "Leaf",
      parentTaskId: mid.id,
    });
    const sibling = await createTask(owner.cookie, { title: "Keep me" });

    const del = await req("DELETE", `/api/tasks/${root.id}`, owner.cookie);
    expect(del.status).toBe(200);
    expect(((await del.json()) as { deleted: number }).deleted).toBe(3);

    expect((await req("GET", `/api/tasks/${leaf.id}`, owner.cookie)).status).toBe(404);
    expect((await req("GET", `/api/tasks/${mid.id}`, owner.cookie)).status).toBe(404);
    expect((await req("GET", `/api/tasks/${root.id}`, owner.cookie)).status).toBe(404);

    const keep = await req("GET", `/api/tasks/${sibling.id}`, owner.cookie);
    expect(keep.status).toBe(200);
  });
});

describe("complete / archive / views", () => {
  it("marking done sets completedAt, drops it from view=todo, and lists it under view=completed", async () => {
    const task = await createTask(owner.cookie, { title: "File taxes" });
    const done = await req("PATCH", `/api/tasks/${task.id}`, owner.cookie, {
      status: "done",
    });
    expect(done.status).toBe(200);
    const { task: updated } = (await done.json()) as { task: ApiTask };
    expect(updated.status).toBe("done");
    expect(updated.completedAt).toBeGreaterThan(0);

    const todo = await req(
      "GET",
      `/api/tasks?familyId=${familyId}&view=todo`,
      owner.cookie,
    );
    const todoBody = (await todo.json()) as { tasks: ApiTask[] };
    expect(todoBody.tasks.map((x) => x.id)).not.toContain(task.id);

    const completed = await req(
      "GET",
      `/api/tasks?familyId=${familyId}&view=completed`,
      owner.cookie,
    );
    const completedBody = (await completed.json()) as { tasks: ApiTask[] };
    expect(completedBody.tasks.map((x) => x.id)).toContain(task.id);

    const reopen = await req("PATCH", `/api/tasks/${task.id}`, owner.cookie, {
      status: "open",
    });
    const { task: opened } = (await reopen.json()) as { task: ApiTask };
    expect(opened.status).toBe("open");
    expect(opened.completedAt).toBeNull();
  });

  it("archived tasks are hidden from the default list and from completed", async () => {
    const task = await createTask(owner.cookie, { title: "Old chore" });
    await req("PATCH", `/api/tasks/${task.id}`, owner.cookie, { status: "done" });
    await req("PATCH", `/api/tasks/${task.id}`, owner.cookie, { status: "archived" });

    const def = await req("GET", `/api/tasks?familyId=${familyId}`, owner.cookie);
    const defBody = (await def.json()) as { tasks: ApiTask[] };
    expect(defBody.tasks.map((x) => x.id)).not.toContain(task.id);

    const completed = await req(
      "GET",
      `/api/tasks?familyId=${familyId}&view=completed`,
      owner.cookie,
    );
    expect(
      ((await completed.json()) as { tasks: ApiTask[] }).tasks.map((x) => x.id),
    ).not.toContain(task.id);

    const archived = await req(
      "GET",
      `/api/tasks?familyId=${familyId}&status=archived`,
      owner.cookie,
    );
    expect(
      ((await archived.json()) as { tasks: ApiTask[] }).tasks.map((x) => x.id),
    ).toContain(task.id);
  });

  it("view=priority returns open tasks with high first", async () => {
    await createTask(owner.cookie, { title: "Low job", priority: "low" });
    const high = await createTask(owner.cookie, {
      title: "Urgent",
      priority: "high",
    });
    await createTask(owner.cookie, { title: "Mid job", priority: "medium" });

    const res = await req(
      "GET",
      `/api/tasks?familyId=${familyId}&view=priority`,
      owner.cookie,
    );
    const { tasks } = (await res.json()) as { tasks: ApiTask[] };
    expect(tasks[0].id).toBe(high.id);
    expect(tasks.map((x) => x.priority)).toEqual(["high", "medium", "low"]);
  });

  it("view=due returns overdue + due-soon open tasks, earliest first", async () => {
    const overdue = await createTask(owner.cookie, {
      title: "Overdue",
      dueDate: "2020-01-01",
    });
    const soon = await createTask(owner.cookie, {
      title: "Soon",
      dueDate: "2099-01-01",
    });
    await createTask(owner.cookie, { title: "No date" });

    const res = await req(
      "GET",
      `/api/tasks?familyId=${familyId}&view=due`,
      owner.cookie,
    );
    const { tasks } = (await res.json()) as { tasks: ApiTask[] };
    expect(tasks.map((x) => x.id)).toContain(overdue.id);
    expect(tasks.map((x) => x.id)).not.toContain(soon.id);
    expect(tasks[0].id).toBe(overdue.id);
  });

  it("view=recent returns newest first and includes a just-created task", async () => {
    const older = await createTask(owner.cookie, { title: "Older" });
    const newer = await createTask(owner.cookie, { title: "Newer" });
    const res = await req(
      "GET",
      `/api/tasks?familyId=${familyId}&view=recent`,
      owner.cookie,
    );
    const { tasks } = (await res.json()) as { tasks: ApiTask[] };
    expect(tasks.map((x) => x.id)).toEqual(expect.arrayContaining([older.id, newer.id]));
    // Same-second inserts are possible; only assert order when createdAt differs.
    if (newer.createdAt !== older.createdAt) {
      expect(tasks[0].id).toBe(newer.id);
    }
  });

  it("view=mine is scoped to the caller's membership, not someone else's", async () => {
    await createTask(owner.cookie, {
      title: "For Milo",
      assignedToMemberId: member.memberId,
    });
    await createTask(owner.cookie, {
      title: "For Olive",
      assignedToMemberId: owner.memberId,
    });
    const milo = await req(
      "GET",
      `/api/tasks?familyId=${familyId}&view=mine`,
      member.cookie,
    );
    const miloTasks = ((await milo.json()) as { tasks: ApiTask[] }).tasks;
    expect(miloTasks).toHaveLength(1);
    expect(miloTasks[0].title).toBe("For Milo");
    expect(miloTasks[0].assignedToName).toBe("Milo Member");
  });

  it("search ?q= matches a nested title and includes its ancestors", async () => {
    const root = await createTask(owner.cookie, { title: "Travel prep" });
    const mid = await createTask(owner.cookie, {
      title: "Documents",
      parentTaskId: root.id,
    });
    await createTask(owner.cookie, {
      title: "Scan passport photo",
      parentTaskId: mid.id,
    });

    const res = await req(
      "GET",
      `/api/tasks?familyId=${familyId}&q=${encodeURIComponent("passport")}`,
      owner.cookie,
    );
    const { tasks } = (await res.json()) as { tasks: ApiTask[] };
    expect(tasks.map((x) => x.title).sort()).toEqual(
      ["Documents", "Scan passport photo", "Travel prep"].sort(),
    );
  });

  it("completing a child updates the parent's doneChildCount", async () => {
    const parent = await createTask(owner.cookie, { title: "Parent" });
    const child = await createTask(owner.cookie, {
      title: "Child",
      parentTaskId: parent.id,
    });
    await req("PATCH", `/api/tasks/${child.id}`, owner.cookie, { status: "done" });
    const res = await req("GET", `/api/tasks/${parent.id}`, owner.cookie);
    const { task: p } = (await res.json()) as { task: ApiTask };
    expect(p.childCount).toBe(1);
    expect(p.doneChildCount).toBe(1);
  });
});

describe("task validation + isolation", () => {
  it("POST missing title / over-max / bad date / bad priority → 400 validation_error", async () => {
    const missing = await req("POST", "/api/tasks", owner.cookie, { familyId });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toBe("validation_error");

    const long = await req("POST", "/api/tasks", owner.cookie, {
      familyId,
      title: "x".repeat(301),
    });
    expect(long.status).toBe(400);

    const date = await req("POST", "/api/tasks", owner.cookie, {
      familyId,
      title: "Bad date",
      dueDate: "5 Sept 2026",
    });
    expect(date.status).toBe(400);

    const pri = await req("POST", "/api/tasks", owner.cookie, {
      familyId,
      title: "Bad pri",
      priority: "urgent",
    });
    expect(pri.status).toBe(400);

    const view = await req(
      "GET",
      `/api/tasks?familyId=${familyId}&view=nope`,
      owner.cookie,
    );
    expect(view.status).toBe(400);
  });

  it("PATCH status pending → 400; null assignee still clears", async () => {
    const task = await createTask(owner.cookie, {
      title: "Assigned",
      assignedToMemberId: member.memberId,
    });
    const bad = await req("PATCH", `/api/tasks/${task.id}`, owner.cookie, {
      status: "pending",
    });
    expect(bad.status).toBe(400);

    const clear = await req("PATCH", `/api/tasks/${task.id}`, owner.cookie, {
      assignedToMemberId: null,
    });
    expect(
      ((await clear.json()) as { task: ApiTask }).task.assignedToMemberId,
    ).toBeNull();
  });

  it("non-member cannot list, get, create, or complete (404)", async () => {
    const task = await createTask(owner.cookie, { title: "Secret" });
    const strangerUser = seedUser(t.sqlite);
    const otherFamily = seedFamily(t.sqlite, strangerUser.id);
    const stranger = seedActor(t.sqlite, otherFamily.id, "owner");

    expect(
      (await req("GET", `/api/tasks?familyId=${familyId}`, stranger.cookie)).status,
    ).toBe(404);
    expect((await req("GET", `/api/tasks/${task.id}`, stranger.cookie)).status).toBe(
      404,
    );
    expect(
      (
        await req("POST", "/api/tasks", stranger.cookie, {
          familyId,
          title: "Nope",
        })
      ).status,
    ).toBe(404);
    expect(
      (await req("PATCH", `/api/tasks/${task.id}`, stranger.cookie, { status: "done" }))
        .status,
    ).toBe(404);
  });

  it("unknown view / missing familyId → 400", async () => {
    expect((await req("GET", "/api/tasks", owner.cookie)).status).toBe(400);
  });
});
