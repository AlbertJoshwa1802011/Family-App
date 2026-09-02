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
