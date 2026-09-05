/**
 * Task create/update — subtasks + JSON null optionals (the phone form
 * used to send `notes: null` which Zod .optional() rejected).
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { createTestEnv, seedActor, seedFamily, seedUser } from "./helpers/testEnv";

const ORIGIN = "http://localhost:5173";

async function post(
  env: ReturnType<typeof createTestEnv>["env"],
  path: string,
  cookie: string,
  body: unknown,
) {
  return app.request(
    path,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: ORIGIN,
      },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe("POST /api/tasks with subtasks", () => {
  it("creates a task when empty optionals are JSON null and subtasks are present", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");

    const res = await post(env, "/api/tasks", actor.cookie, {
      familyId: family.id,
      title: "Pack for trip",
      notes: null,
      assignedToMemberId: null,
      referredTaskId: null,
      reminderDate: null,
      remindMemberId: null,
      subtasks: [
        { id: "st-1", title: "Passports", done: false },
        { id: "st-2", title: "Tickets", done: true },
      ],
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      task: { title: string; subtasks: { title: string; done: boolean }[] };
    };
    expect(body.task.title).toBe("Pack for trip");
    expect(body.task.subtasks).toHaveLength(2);
    expect(body.task.subtasks[0]?.title).toBe("Passports");
    expect(body.task.subtasks[1]?.done).toBe(true);
  });

  it("rejects a missing title with validation_error", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");

    const res = await post(env, "/api/tasks", actor.cookie, {
      familyId: family.id,
      title: "",
      subtasks: [{ id: "st-1", title: "Nope", done: false }],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("returns 401 without a session", async () => {
    const { env } = createTestEnv();
    const res = await post(env, "/api/tasks", "", { title: "x", familyId: "f" });
    expect(res.status).toBe(401);
  });
});

describe("GET/PATCH /api/tasks/:id subtasks", () => {
  it("GET returns parsed subtasks after create", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");

    const created = await post(env, "/api/tasks", actor.cookie, {
      familyId: family.id,
      title: "School run",
      dueDate: null,
      subtasks: [{ id: "a", title: "Bags", done: false }],
    });
    expect(created.status).toBe(201);
    const { task } = (await created.json()) as { task: { id: string } };

    const got = await app.request(`/api/tasks/${task.id}`, {
      headers: { Cookie: actor.cookie },
    }, env);
    expect(got.status).toBe(200);
    const body = (await got.json()) as {
      task: { subtasks: { title: string }[] };
    };
    expect(body.task.subtasks).toEqual([{ id: "a", title: "Bags", done: false }]);
  });

  it("PATCH accepts JSON null optionals and replaces subtasks", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const created = await post(env, "/api/tasks", actor.cookie, {
      familyId: family.id,
      title: "Pack",
      subtasks: [{ id: "a", title: "Bags", done: false }],
    });
    const { task } = (await created.json()) as { task: { id: string } };

    const res = await app.request(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: {
        Cookie: actor.cookie,
        "Content-Type": "application/json",
        Origin: ORIGIN,
      },
      body: JSON.stringify({
        notes: null,
        dueDate: null,
        reminderDate: null,
        subtasks: [
          { id: "a", title: "Bags", done: true },
          { id: "b", title: "Lunch", done: false },
        ],
      }),
    }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      task: { subtasks: { title: string; done: boolean }[] };
    };
    expect(body.task.subtasks).toHaveLength(2);
    expect(body.task.subtasks[0]?.done).toBe(true);
    expect(body.task.subtasks[1]?.title).toBe("Lunch");
  });
});

describe("nested tasks + views", () => {
  async function mutate(
    env: ReturnType<typeof createTestEnv>["env"],
    method: string,
    path: string,
    cookie: string,
    body?: unknown,
  ) {
    return app.request(
      path,
      {
        method,
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          Origin: ORIGIN,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
  }

  interface ApiTask {
    id: string;
    title: string;
    status: string;
    priority: string;
    parentTaskId: string | null;
    completedAt: number | null;
    childCount: number;
    doneChildCount: number;
    assignedToMemberId: string | null;
  }

  it("creates a nested child, counts it on the parent, and returns ancestors/depth", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");

    const parentRes = await post(env, "/api/tasks", actor.cookie, {
      familyId: family.id,
      title: "Travel prep",
    });
    expect(parentRes.status).toBe(201);
    const { task: parent } = (await parentRes.json()) as { task: ApiTask };

    const childRes = await post(env, "/api/tasks", actor.cookie, {
      familyId: family.id,
      title: "Renew passport",
      parentTaskId: parent.id,
      priority: "high",
    });
    expect(childRes.status).toBe(201);
    const { task: child } = (await childRes.json()) as { task: ApiTask };
    expect(child.parentTaskId).toBe(parent.id);
    expect(child.priority).toBe("high");

    const list = await app.request(
      `/api/tasks?familyId=${family.id}`,
      { headers: { Cookie: actor.cookie } },
      env,
    );
    expect(list.status).toBe(200);
    const { tasks } = (await list.json()) as { tasks: ApiTask[] };
    expect(tasks.find((t) => t.id === parent.id)?.childCount).toBe(1);

    const got = await app.request(
      `/api/tasks/${child.id}`,
      { headers: { Cookie: actor.cookie } },
      env,
    );
    expect(got.status).toBe(200);
    const body = (await got.json()) as {
      task: ApiTask;
      ancestors: ApiTask[];
      children: ApiTask[];
      depth: number;
    };
    expect(body.ancestors.map((a) => a.id)).toEqual([parent.id]);
    expect(body.depth).toBe(1);
    expect(body.children).toEqual([]);
  });

  it("rejects a parent from another family", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");

    const strangerUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, strangerUser.id);
    const stranger = seedActor(sqlite, otherFamily.id, "owner");
    const foreignRes = await post(env, "/api/tasks", stranger.cookie, {
      familyId: otherFamily.id,
      title: "Foreign parent",
    });
    const { task: foreign } = (await foreignRes.json()) as { task: ApiTask };

    const res = await post(env, "/api/tasks", actor.cookie, {
      familyId: family.id,
      title: "Sneaky child",
      parentTaskId: foreign.id,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_parent_id");
  });

  it("caps nesting at 5 layers below the root", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");

    let parentId: string | undefined;
    for (let i = 0; i <= 5; i++) {
      const created = await post(env, "/api/tasks", actor.cookie, {
        familyId: family.id,
        title: `L${i}`,
        parentTaskId: parentId,
      });
      expect(created.status).toBe(201);
      parentId = ((await created.json()) as { task: ApiTask }).task.id;
    }
    const res = await post(env, "/api/tasks", actor.cookie, {
      familyId: family.id,
      title: "too deep",
      parentTaskId: parentId,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("max_task_depth");
  });

  it("rejects reparenting a task under its own descendant", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const root = ((await (
      await post(env, "/api/tasks", actor.cookie, {
        familyId: family.id,
        title: "Root",
      })
    ).json()) as { task: ApiTask }).task;
    const child = ((await (
      await post(env, "/api/tasks", actor.cookie, {
        familyId: family.id,
        title: "Child",
        parentTaskId: root.id,
      })
    ).json()) as { task: ApiTask }).task;

    const res = await mutate(env, "PATCH", `/api/tasks/${root.id}`, actor.cookie, {
      parentTaskId: child.id,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("task_cycle");
  });

  it("marking done sets completedAt, drops it from view=todo, and lists it under view=completed", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const created = await post(env, "/api/tasks", actor.cookie, {
      familyId: family.id,
      title: "File taxes",
    });
    const { task } = (await created.json()) as { task: ApiTask };

    const done = await mutate(env, "PATCH", `/api/tasks/${task.id}`, actor.cookie, {
      status: "done",
    });
    expect(done.status).toBe(200);
    const { task: updated } = (await done.json()) as { task: ApiTask };
    expect(updated.status).toBe("done");
    expect(updated.completedAt).toBeGreaterThan(0);

    const todo = await app.request(
      `/api/tasks?familyId=${family.id}&view=todo`,
      { headers: { Cookie: actor.cookie } },
      env,
    );
    const todoBody = (await todo.json()) as { tasks: ApiTask[] };
    expect(todoBody.tasks.map((x) => x.id)).not.toContain(task.id);

    const completed = await app.request(
      `/api/tasks?familyId=${family.id}&view=completed`,
      { headers: { Cookie: actor.cookie } },
      env,
    );
    expect(
      ((await completed.json()) as { tasks: ApiTask[] }).tasks.map((x) => x.id),
    ).toContain(task.id);

    const reopen = await mutate(env, "PATCH", `/api/tasks/${task.id}`, actor.cookie, {
      status: "open",
    });
    const { task: opened } = (await reopen.json()) as { task: ApiTask };
    expect(opened.status).toBe("open");
    expect(opened.completedAt).toBeNull();
  });

  it("DELETE cascades to descendants", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const root = ((await (
      await post(env, "/api/tasks", actor.cookie, {
        familyId: family.id,
        title: "Root",
      })
    ).json()) as { task: ApiTask }).task;
    const mid = ((await (
      await post(env, "/api/tasks", actor.cookie, {
        familyId: family.id,
        title: "Mid",
        parentTaskId: root.id,
      })
    ).json()) as { task: ApiTask }).task;
    const leaf = ((await (
      await post(env, "/api/tasks", actor.cookie, {
        familyId: family.id,
        title: "Leaf",
        parentTaskId: mid.id,
      })
    ).json()) as { task: ApiTask }).task;
    const sibling = ((await (
      await post(env, "/api/tasks", actor.cookie, {
        familyId: family.id,
        title: "Keep me",
      })
    ).json()) as { task: ApiTask }).task;

    const del = await mutate(env, "DELETE", `/api/tasks/${root.id}`, actor.cookie);
    expect(del.status).toBe(200);
    expect(((await del.json()) as { deleted: number }).deleted).toBe(3);

    expect(
      (await app.request(`/api/tasks/${leaf.id}`, { headers: { Cookie: actor.cookie } }, env))
        .status,
    ).toBe(404);
    expect(
      (await app.request(`/api/tasks/${sibling.id}`, { headers: { Cookie: actor.cookie } }, env))
        .status,
    ).toBe(200);
  });

  it("view=priority returns open tasks with high first; view=mine is the caller's assignments", async () => {
    const { env, sqlite } = createTestEnv();
    const ownerUser = seedUser(sqlite);
    const family = seedFamily(sqlite, ownerUser.id);
    const owner = seedActor(sqlite, family.id, "owner");
    const member = seedActor(sqlite, family.id, "member");

    await post(env, "/api/tasks", owner.cookie, {
      familyId: family.id,
      title: "Low job",
      priority: "low",
    });
    const high = await post(env, "/api/tasks", owner.cookie, {
      familyId: family.id,
      title: "Urgent",
      priority: "high",
    });
    expect(high.status).toBe(201);
    await post(env, "/api/tasks", owner.cookie, {
      familyId: family.id,
      title: "Mid job",
      priority: "medium",
    });
    await post(env, "/api/tasks", owner.cookie, {
      familyId: family.id,
      title: "For member",
      assignedToMemberId: member.memberId,
    });

    const pri = await app.request(
      `/api/tasks?familyId=${family.id}&view=priority`,
      { headers: { Cookie: owner.cookie } },
      env,
    );
    const { tasks } = (await pri.json()) as { tasks: ApiTask[] };
    expect(tasks[0]?.title).toBe("Urgent");
    const titles = tasks.map((x) => x.title);
    expect(titles.indexOf("Urgent")).toBeLessThan(titles.indexOf("Mid job"));
    expect(titles.indexOf("Mid job")).toBeLessThan(titles.indexOf("Low job"));

    const mine = await app.request(
      `/api/tasks?familyId=${family.id}&view=mine`,
      { headers: { Cookie: member.cookie } },
      env,
    );
    const mineTasks = ((await mine.json()) as { tasks: ApiTask[] }).tasks;
    expect(mineTasks).toHaveLength(1);
    expect(mineTasks[0]?.title).toBe("For member");
  });

  it("rejects an unknown view with validation_error", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const res = await app.request(
      `/api/tasks?familyId=${family.id}&view=nope`,
      { headers: { Cookie: actor.cookie } },
      env,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("validation_error");
  });

  it("still creates a JSON-checklist task (subtasks array) alongside nested rows", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const actor = seedActor(sqlite, family.id, "owner");
    const res = await post(env, "/api/tasks", actor.cookie, {
      familyId: family.id,
      title: "Pack",
      subtasks: [{ id: "st-1", title: "Passports", done: false }],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      task: { subtasks: { title: string }[]; parentTaskId: string | null };
    };
    expect(body.task.subtasks).toHaveLength(1);
    expect(body.task.parentTaskId).toBeNull();
  });
});
