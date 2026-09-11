/**
 * Event create must be safe to retry: Apple Calendar used to navigate the
 * browser to GET /api/events/:id/ics after POST, which could show unauthorized
 * and leave the form mounted — a second tap then created a duplicate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "../worker/index";
import { getDb, schema } from "../worker/db/client";
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

beforeEach(() => {
  t = createTestEnv();
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  owner = seedActor(t.sqlite, familyId, "owner", { name: "Olive Owner" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function req(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(
    path,
    {
      method,
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    t.env,
  );
}

describe("POST /events create idempotency", () => {
  it("returns the same event for a repeated clientRequestId (no duplicate row)", async () => {
    const clientRequestId = crypto.randomUUID();
    const startAt = Math.floor(Date.UTC(2026, 9, 12, 15, 0) / 1000);
    const payload = {
      familyId,
      title: "School pickup",
      startAt,
      endAt: startAt + 3600,
      syncGoogleCalendar: false,
      syncAppleCalendar: false,
      clientRequestId,
    };

    const first = await req("POST", "/api/events", owner.cookie, payload);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { event: { id: string; title: string } };

    const second = await req("POST", "/api/events", owner.cookie, payload);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { event: { id: string; title: string } };

    expect(secondBody.event.id).toBe(firstBody.event.id);
    expect(secondBody.event.title).toBe("School pickup");

    const db = getDb(t.env);
    const rows = await db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.familyId, familyId));
    expect(rows).toHaveLength(1);
  });

  it("creates distinct events when clientRequestId differs", async () => {
    const startAt = Math.floor(Date.UTC(2026, 9, 13, 10, 0) / 1000);
    const base = {
      familyId,
      title: "Dentist",
      startAt,
      syncGoogleCalendar: false,
      syncAppleCalendar: false,
    };

    const a = await req("POST", "/api/events", owner.cookie, {
      ...base,
      clientRequestId: crypto.randomUUID(),
    });
    const b = await req("POST", "/api/events", owner.cookie, {
      ...base,
      clientRequestId: crypto.randomUUID(),
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const idA = ((await a.json()) as { event: { id: string } }).event.id;
    const idB = ((await b.json()) as { event: { id: string } }).event.id;
    expect(idA).not.toBe(idB);
  });
});

describe("GET /events/:id/ics session gate (regression)", () => {
  it("returns unauthorized JSON without a session (not HTML)", async () => {
    const startAt = Math.floor(Date.UTC(2026, 9, 14, 9, 0) / 1000);
    const created = await req("POST", "/api/events", owner.cookie, {
      familyId,
      title: "ICS gate",
      startAt,
      syncGoogleCalendar: false,
      syncAppleCalendar: false,
    });
    const { event } = (await created.json()) as { event: { id: string } };

    const anon = await app.request(`/api/events/${event.id}/ics`, {}, t.env);
    expect(anon.status).toBe(401);
    expect(anon.headers.get("content-type")).toMatch(/json/);
    const body = (await anon.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });
});
