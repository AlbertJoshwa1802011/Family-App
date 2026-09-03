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
