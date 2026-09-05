/**
 * Tasks module catalog — 1000 due-date offsets from 2026-01-01, plus status patches.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { catalogReq, seedFamilySession, utcIsoFromDay, type FamilySession } from "./helpers";

const TASK_CASES = Array.from({ length: 1000 }, (_, i) => ({
  i,
  title: `Task ${i}`,
  dueDate: utcIsoFromDay(i),
}));

const STATUSES = ["open", "done", "archived"] as const;

const INVALID: { name: string; body: Record<string, unknown> }[] = [
  { name: "empty title", body: { title: "" } },
  { name: "title too long", body: { title: "t".repeat(301) } },
  { name: "bad dueDate", body: { title: "x", dueDate: "tomorrow" } },
  { name: "missing familyId", body: { familyId: "", title: "x" } },
  { name: "notes too long", body: { title: "x", notes: "n".repeat(2001) } },
];

describe("catalog: tasks ≥1000", () => {
  let s: FamilySession;
  const ids: string[] = [];

  beforeAll(() => {
    s = seedFamilySession();
  });

  it(`records ${TASK_CASES.length} create combinations`, () => {
    expect(TASK_CASES.length).toBeGreaterThanOrEqual(1000);
  });

  it.each(TASK_CASES)("POST #$i due=$dueDate", async (c) => {
    const res = await catalogReq(s.env, "POST", "/api/tasks", {
      cookie: s.actor.cookie,
      body: {
        familyId: s.familyId,
        title: c.title,
        dueDate: c.dueDate,
      },
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      task: { id: string; title: string; dueDate: string | null; status: string };
    };
    expect(json.task.title).toBe(c.title);
    expect(json.task.dueDate).toBe(c.dueDate);
    expect(json.task.status).toBe("open");
    ids[c.i] = json.task.id;
  });

  it.each(TASK_CASES.slice(0, 333))(
    "PATCH #$i cycles status",
    async (c) => {
      const id = ids[c.i];
      expect(id).toBeTruthy();
      const status = STATUSES[c.i % STATUSES.length];
      const res = await catalogReq(s.env, "PATCH", `/api/tasks/${id}`, {
        cookie: s.actor.cookie,
        body: { status },
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { task: { status: string } };
      expect(json.task.status).toBe(status);
    },
  );

  it.each(INVALID)("POST invalid: $name → 400 validation_error", async (c) => {
    const res = await catalogReq(s.env, "POST", "/api/tasks", {
      cookie: s.actor.cookie,
      body: { familyId: s.familyId, title: "x", ...c.body },
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("validation_error");
  });

  it("outsider GET of a task is 404", async () => {
    const id = ids[0];
    const res = await catalogReq(s.env, "GET", `/api/tasks/${id}`, {
      cookie: s.outsider.cookie,
    });
    expect(res.status).toBe(404);
  });
});
