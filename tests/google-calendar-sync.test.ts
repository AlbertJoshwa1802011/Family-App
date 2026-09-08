/**
 * Google Calendar push sync — Family Vault is the source of truth.
 *
 * Creating / updating / cancelling an event must insert / patch / delete the
 * matching Google Calendar event for the creator (+ attendees). Failures are
 * best-effort and must never break the D1 write.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "../worker/index";
import { getDb, schema } from "../worker/db/client";
import { buildGCalEventBody } from "../worker/lib/googleCalendar";
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
  t = createTestEnv({
    GOOGLE_CLIENT_ID: "test-client",
    GOOGLE_CLIENT_SECRET: "test-secret",
  });
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  owner = seedActor(t.sqlite, familyId, "owner", { name: "Olive Owner" });
  member = seedActor(t.sqlite, familyId, "member", { name: "Milo Member" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function req(method: string, path: string, cookie: string, body?: object) {
  return app.request(
    path,
    {
      method,
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    t.env,
  );
}

async function putRefresh(userId: string) {
  await t.env.KV.put(`user:refresh_token:${userId}`, `refresh-${userId}`);
}

/** Mock Google token + Calendar API. Returns call log. */
function stubGoogleCalendar() {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  let gcalSeq = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      let body: unknown;
      if (init?.body && typeof init.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      calls.push({ url, method, body });

      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "atok", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (
        url.includes("/calendar/v3/calendars/") &&
        method === "POST" &&
        url.endsWith("/events")
      ) {
        gcalSeq += 1;
        return new Response(JSON.stringify({ id: `gcal-${gcalSeq}` }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/calendar/v3/calendars/") && method === "PATCH") {
        return new Response(JSON.stringify({ id: "patched" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/calendar/v3/calendars/") && method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      return new Response(`unexpected fetch ${method} ${url}`, { status: 500 });
    }),
  );

  return calls;
}

describe("buildGCalEventBody", () => {
  it("formats timed and all-day events for the Calendar API", () => {
    const timed = buildGCalEventBody(
      {
        id: "e1",
        title: "Dentist",
        description: "Bring card",
        location: "Clinic",
        startAt: Date.UTC(2026, 8, 10, 9, 0) / 1000,
        endAt: Date.UTC(2026, 8, 10, 10, 0) / 1000,
        allDay: false,
        status: "active",
      },
      "https://app.example",
    );
    expect(timed.start.dateTime).toBe("2026-09-10T09:00:00Z");
    expect(timed.end.dateTime).toBe("2026-09-10T10:00:00Z");
    expect(timed.location).toBe("Clinic");
    expect(timed.description).toContain("Bring card");
    expect(timed.description).toContain("https://app.example/calendar/events/e1");
    expect(timed.status).toBe("confirmed");

    const allDay = buildGCalEventBody(
      {
        id: "e2",
        title: "Holiday",
        description: null,
        location: null,
        startAt: Date.UTC(2026, 8, 15) / 1000,
        endAt: null,
        allDay: true,
        status: "cancelled",
      },
      "https://app.example",
    );
    expect(allDay.start.date).toBe("2026-09-15");
    expect(allDay.end.date).toBe("2026-09-16"); // exclusive end
    expect(allDay.status).toBe("cancelled");
  });
});

describe("POST /events → Google Calendar push", () => {
  it("creates a Google Calendar event for the creator when refresh token exists", async () => {
    const calls = stubGoogleCalendar();
    await putRefresh(owner.userId);

    const startAt = Math.floor(Date.UTC(2026, 9, 1, 14, 0) / 1000);
    const res = await req("POST", "/api/events", owner.cookie, {
      familyId,
      title: "School pickup",
      startAt,
      endAt: startAt + 3600,
      type: "appointment",
    });
    expect(res.status).toBe(201);
    const { event, calendarSynced } = (await res.json()) as {
      event: { id: string };
      calendarSynced: boolean;
    };
    expect(calendarSynced).toBe(true);

    const insert = calls.find(
      (c) => c.method === "POST" && c.url.includes("/calendar/v3/"),
    );
    expect(insert).toBeTruthy();
    expect((insert!.body as { summary: string }).summary).toBe("School pickup");

    const rows = await getDb(t.env)
      .select()
      .from(schema.eventGoogleSync)
      .where(eq(schema.eventGoogleSync.eventId, event.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(owner.userId);
    expect(rows[0]!.googleEventId).toBe("gcal-1");

    const detail = await req("GET", `/api/events/${event.id}`, owner.cookie);
    expect(
      ((await detail.json()) as { calendarSynced: boolean }).calendarSynced,
    ).toBe(true);
  });

  it("pushes to creator and invited attendees with tokens", async () => {
    const calls = stubGoogleCalendar();
    await putRefresh(owner.userId);
    await putRefresh(member.userId);

    const startAt = Math.floor(Date.UTC(2026, 9, 2, 18, 0) / 1000);
    const res = await req("POST", "/api/events", owner.cookie, {
      familyId,
      title: "Dinner",
      startAt,
      attendeeMemberIds: [member.memberId],
    });
    expect(res.status).toBe(201);
    const { event } = (await res.json()) as { event: { id: string } };

    const inserts = calls.filter(
      (c) => c.method === "POST" && c.url.includes("/calendar/v3/"),
    );
    expect(inserts.length).toBe(2);

    const rows = await getDb(t.env)
      .select()
      .from(schema.eventGoogleSync)
      .where(eq(schema.eventGoogleSync.eventId, event.id));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.userId))).toEqual(
      new Set([owner.userId, member.userId]),
    );
  });

  it("still creates the D1 event when Google Calendar fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    await putRefresh(owner.userId);

    const startAt = Math.floor(Date.UTC(2026, 9, 3, 10, 0) / 1000);
    const res = await req("POST", "/api/events", owner.cookie, {
      familyId,
      title: "Still saved",
      startAt,
    });
    expect(res.status).toBe(201);
    const { event } = (await res.json()) as { event: { id: string; title: string } };
    expect(event.title).toBe("Still saved");

    const rows = await getDb(t.env)
      .select()
      .from(schema.eventGoogleSync)
      .where(eq(schema.eventGoogleSync.eventId, event.id));
    expect(rows).toHaveLength(0);
  });

  it("skips Google when the user has no refresh token", async () => {
    const calls = stubGoogleCalendar();
    // no putRefresh

    const startAt = Math.floor(Date.UTC(2026, 9, 4, 10, 0) / 1000);
    const res = await req("POST", "/api/events", owner.cookie, {
      familyId,
      title: "No token yet",
      startAt,
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { calendarSynced: boolean }).calendarSynced).toBe(
      false,
    );

    expect(calls.filter((c) => c.url.includes("/calendar/v3/"))).toHaveLength(0);
  });
});

describe("PATCH / cancel / delete → Google Calendar", () => {
  it("patches on update and deletes on trash", async () => {
    const calls = stubGoogleCalendar();
    await putRefresh(owner.userId);

    const startAt = Math.floor(Date.UTC(2026, 9, 5, 12, 0) / 1000);
    const created = await req("POST", "/api/events", owner.cookie, {
      familyId,
      title: "Original",
      startAt,
    });
    const { event } = (await created.json()) as { event: { id: string } };

    const patched = await req("PATCH", `/api/events/${event.id}`, owner.cookie, {
      title: "Renamed",
    });
    expect(patched.status).toBe(200);

    const patchCall = calls.find(
      (c) => c.method === "PATCH" && c.url.includes("/calendar/v3/"),
    );
    expect(patchCall).toBeTruthy();
    expect((patchCall!.body as { summary: string }).summary).toBe("Renamed");

    const del = await req("DELETE", `/api/events/${event.id}`, owner.cookie);
    expect(del.status).toBe(200);

    expect(
      calls.some((c) => c.method === "DELETE" && c.url.includes("/calendar/v3/")),
    ).toBe(true);

    const rows = await getDb(t.env)
      .select()
      .from(schema.eventGoogleSync)
      .where(eq(schema.eventGoogleSync.eventId, event.id));
    expect(rows).toHaveLength(0);
  });

  it("marks the Google event cancelled on cancel", async () => {
    const calls = stubGoogleCalendar();
    await putRefresh(owner.userId);

    const startAt = Math.floor(Date.UTC(2026, 9, 6, 12, 0) / 1000);
    const created = await req("POST", "/api/events", owner.cookie, {
      familyId,
      title: "Maybe",
      startAt,
    });
    const { event } = (await created.json()) as { event: { id: string } };

    expect((await req("POST", `/api/events/${event.id}/cancel`, owner.cookie)).status).toBe(
      200,
    );

    const patchCall = calls.find(
      (c) =>
        c.method === "PATCH" &&
        c.url.includes("/calendar/v3/") &&
        (c.body as { status?: string })?.status === "cancelled",
    );
    expect(patchCall).toBeTruthy();
  });
});

describe("RSVP decline removes Google copy for that attendee", () => {
  it("deletes the decliner's Google event but keeps the creator's", async () => {
    const calls = stubGoogleCalendar();
    await putRefresh(owner.userId);
    await putRefresh(member.userId);

    const startAt = Math.floor(Date.UTC(2026, 9, 7, 16, 0) / 1000);
    const created = await req("POST", "/api/events", owner.cookie, {
      familyId,
      title: "Party",
      startAt,
      attendeeMemberIds: [member.memberId],
    });
    const { event } = (await created.json()) as { event: { id: string } };

    expect(
      (
        await req("POST", `/api/events/${event.id}/rsvp`, member.cookie, {
          status: "declined",
        })
      ).status,
    ).toBe(200);

    expect(
      calls.some((c) => c.method === "DELETE" && c.url.includes("/calendar/v3/")),
    ).toBe(true);

    const rows = await getDb(t.env)
      .select()
      .from(schema.eventGoogleSync)
      .where(eq(schema.eventGoogleSync.eventId, event.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(owner.userId);
  });
});
