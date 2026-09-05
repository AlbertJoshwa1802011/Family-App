/**
 * Regression catalog for the expenses / events / church / calendar work.
 *
 * These cases are the contracts that must stay green so the bugs we just
 * fixed (empty event edit, categories blocking add, church totals, missing
 * event email, calendar not on the phone, bubble rubber-banding) cannot
 * silently return. Run:
 *
 *   npm run test:regression
 *   npm run test:gate
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../worker/index";
import {
  createTestEnv,
  seedActor,
  seedDocument,
  seedFamily,
  seedUser,
} from "./helpers/testEnv";
import type { Env } from "../worker/types";

const ORIGIN = "http://localhost:5173";

function authed(
  env: Env,
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
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

function churchFundsResponse(slug = "tech-fund") {
  return new Response(
    JSON.stringify({
      success: true,
      funds: [
        {
          slug,
          name: "Tech fund",
          totalCollected: 1000,
          spentOnProducts: 250,
          availableBalance: 750,
          status: "active",
        },
      ],
    }),
    { status: 200 },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OAuth scopes (Google Calendar)", () => {
  it("google/start asks for calendar.events and keeps granted Drive scopes", async () => {
    const { env } = createTestEnv({ GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com" });
    const res = await app.request("/api/auth/google/start", {}, env);
    expect([301, 302, 303, 307, 308]).toContain(res.status);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("accounts.google.com");
    expect(decodeURIComponent(loc)).toContain(
      "https://www.googleapis.com/auth/calendar.events",
    );
    expect(decodeURIComponent(loc)).toContain(
      "https://www.googleapis.com/auth/drive.file",
    );
    expect(loc).toContain("include_granted_scopes=true");
  });
});

describe("Event edit hydration + notify", () => {
  it("PATCH keeps the fields the edit form reads and notifies the actor", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner", { name: "Alice" });
    const startAt = 1_800_000_000;

    const create = await authed(env, "POST", "/api/events", alice.cookie, {
      familyId: family.id,
      title: "School play",
      type: "milestone",
      startAt,
      endAt: startAt + 3600,
      location: "Town Hall",
      description: "Bring flowers",
    });
    const created = (await create.json()) as { event: { id: string } };

    const patch = await authed(
      env,
      "PATCH",
      `/api/events/${created.event.id}`,
      alice.cookie,
      { title: "School play (final)", location: "Main Hall" },
    );
    expect(patch.status).toBe(200);

    const get = await authed(env, "GET", `/api/events/${created.event.id}`, alice.cookie);
    const body = (await get.json()) as {
      event: {
        title: string;
        type: string;
        startAt: number;
        endAt: number | null;
        location: string | null;
        description: string | null;
        attendees: unknown[];
      };
      attendees: unknown[];
    };
    expect(body.event.title).toBe("School play (final)");
    expect(body.event.type).toBe("milestone");
    expect(body.event.startAt).toBe(startAt);
    expect(body.event.endAt).toBe(startAt + 3600);
    expect(body.event.location).toBe("Main Hall");
    expect(body.event.description).toBe("Bring flowers");
    expect(Array.isArray(body.event.attendees)).toBe(true);

    const notes = await authed(env, "GET", "/api/notifications", alice.cookie);
    const nbody = (await notes.json()) as { notifications: { type: string }[] };
    expect(nbody.notifications.some((n) => n.type === "event_updated")).toBe(true);
  });

  it("notifies tagged attendees and still writes in-app mail when email is off", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner", { name: "Alice" });
    const bob = seedActor(sqlite, family.id, "member", { name: "Bob" });
    sqlite
      .prepare(
        `INSERT INTO reminder_prefs (user_id, email_enabled, push_enabled, windows_json, digest_enabled)
         VALUES (?, 0, 0, '[7,1]', 0)`,
      )
      .run(bob.userId);

    const create = await authed(env, "POST", "/api/events", alice.cookie, {
      familyId: family.id,
      title: "Choir practice",
      startAt: Math.floor(Date.now() / 1000) + 86400,
      attendeeMemberIds: [bob.memberId],
    });
    expect(create.status).toBe(201);

    const bobNotes = await authed(env, "GET", "/api/notifications", bob.cookie);
    const body = (await bobNotes.json()) as {
      notifications: { type: string; title: string }[];
    };
    expect(body.notifications.some((n) => n.type === "event_created")).toBe(true);
    expect(body.notifications.some((n) => n.title.includes("Choir practice"))).toBe(true);
  });

  it("cancel writes event_cancelled and event CRUD survives Google 403", async () => {
    const { env, sqlite } = createTestEnv({
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "sec",
    });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner", { name: "Alice" });
    await env.KV.put(`user:refresh_token:${alice.userId}`, "refresh-token");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }));
      }
      if (url.includes("calendar/v3")) {
        return new Response("no calendar scope", { status: 403 });
      }
      return new Response("nope", { status: 404 });
    });

    const create = await authed(env, "POST", "/api/events", alice.cookie, {
      familyId: family.id,
      title: "Picnic",
      startAt: Math.floor(Date.now() / 1000) + 86400,
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as {
      event: { id: string };
      calendar: { status: string };
    };
    expect(created.calendar.status).toBe("needs_reconnect");

    const cancel = await authed(
      env,
      "POST",
      `/api/events/${created.event.id}/cancel`,
      alice.cookie,
    );
    expect(cancel.status).toBe(200);

    const notes = await authed(env, "GET", "/api/notifications", alice.cookie);
    const body = (await notes.json()) as { notifications: { type: string }[] };
    expect(body.notifications.some((n) => n.type === "event_cancelled")).toBe(true);
  });

  it("Calendar API disabled (403 ACCESS_NOT_CONFIGURED) is needs_api_enabled", async () => {
    const { env, sqlite } = createTestEnv({
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "sec",
    });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner", { name: "Alice" });
    await env.KV.put(`user:refresh_token:${alice.userId}`, "refresh-token");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }));
      }
      if (url.includes("calendar/v3")) {
        return new Response(
          "Google Calendar API has not been used in project 1 before or it is disabled.",
          { status: 403 },
        );
      }
      return new Response("nope", { status: 404 });
    });

    const create = await authed(env, "POST", "/api/events", alice.cookie, {
      familyId: family.id,
      title: "Disabled API",
      startAt: Math.floor(Date.now() / 1000) + 86400,
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as {
      calendar: { status: string; message: string };
    };
    expect(created.calendar.status).toBe("needs_api_enabled");
    expect(created.calendar.message).toMatch(/Calendar API/i);
  });

  it("POST /events/:id/sync-calendar retries a Google write", async () => {
    const { env, sqlite } = createTestEnv({
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "sec",
    });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner", { name: "Alice" });
    await env.KV.put(`user:refresh_token:${alice.userId}`, "refresh-token");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }));
      }
      if (url.includes("calendar/v3") && (init as RequestInit | undefined)?.method === "POST") {
        return new Response(JSON.stringify({ id: "gcal-retry" }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    });

    const create = await authed(env, "POST", "/api/events", alice.cookie, {
      familyId: family.id,
      title: "Later sync",
      startAt: Math.floor(Date.now() / 1000) + 86400,
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { event: { id: string } };

    const retry = await authed(
      env,
      "POST",
      `/api/events/${created.event.id}/sync-calendar`,
      alice.cookie,
    );
    expect(retry.status).toBe(200);
    const body = (await retry.json()) as {
      calendar: { status: string; googleCalendarEventId: string | null };
    };
    expect(body.calendar.status).toBe("synced");
    expect(body.calendar.googleCalendarEventId).toBe("gcal-retry");
  });

  it("stores the Google Calendar id when upsert succeeds", async () => {
    const { env, sqlite } = createTestEnv({
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "sec",
    });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner", { name: "Alice" });
    await env.KV.put(`user:refresh_token:${alice.userId}`, "refresh-token");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }));
      }
      if (url.includes("calendar/v3") && (init as RequestInit | undefined)?.method === "POST") {
        return new Response(JSON.stringify({ id: "gcal-abc" }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    });

    const create = await authed(env, "POST", "/api/events", alice.cookie, {
      familyId: family.id,
      title: "Synced",
      startAt: Math.floor(Date.now() / 1000) + 86400,
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as {
      calendar: { status: string; googleCalendarEventId: string | null };
    };
    expect(created.calendar.status).toBe("synced");
    expect(created.calendar.googleCalendarEventId).toBe("gcal-abc");
  });

  it("POST with empty title → 400 validation_error", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");
    const res = await authed(env, "POST", "/api/events", alice.cookie, {
      familyId: family.id,
      title: "",
      startAt: Math.floor(Date.now() / 1000) + 86400,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("validation_error");
  });
});

describe("ICS feed isolation", () => {
  it("GET /feed-token is 401 without a session and null before mint", async () => {
    const unauth = await app.request("/api/calendar/feed-token");
    expect(unauth.status).toBe(401);

    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");
    const empty = await authed(env, "GET", "/api/calendar/feed-token", alice.cookie);
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { url: string | null }).url).toBeNull();
  });

  it("rotating the feed invalidates the previous URL", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");

    const first = await authed(env, "POST", "/api/calendar/feed-token", alice.cookie);
    const { url: url1 } = (await first.json()) as { url: string };
    const second = await authed(env, "POST", "/api/calendar/feed-token", alice.cookie);
    const { url: url2 } = (await second.json()) as { url: string };
    expect(url1).not.toBe(url2);

    const oldFile = url1.split("/").pop()!;
    const oldRes = await app.request(`/api/calendar/feed/${oldFile}`, {}, env);
    expect(oldRes.status).toBe(404);

    const newFile = url2.split("/").pop()!;
    const newRes = await app.request(`/api/calendar/feed/${newFile}`, {}, env);
    expect(newRes.status).toBe(200);
  });

  it("feed does not leak another family's events or private document expiries", async () => {
    const { env, sqlite } = createTestEnv();
    const ownerA = seedUser(sqlite);
    const famA = seedFamily(sqlite, ownerA.id);
    const alice = seedActor(sqlite, famA.id, "owner", { name: "Alice" });
    const bob = seedActor(sqlite, famA.id, "member", { name: "Bob" });

    const ownerB = seedUser(sqlite);
    const famB = seedFamily(sqlite, ownerB.id);
    const cara = seedActor(sqlite, famB.id, "owner", { name: "Cara" });

    await authed(env, "POST", "/api/events", alice.cookie, {
      familyId: famA.id,
      title: "Alice picnic",
      startAt: Math.floor(Date.now() / 1000) + 86400,
    });
    await authed(env, "POST", "/api/events", cara.cookie, {
      familyId: famB.id,
      title: "Cara secret",
      startAt: Math.floor(Date.now() / 1000) + 86400,
    });
    seedDocument(sqlite, {
      familyId: famA.id,
      ownerUserId: alice.userId,
      title: "Alice passport",
      visibility: "private",
      expiryDate: "2027-01-01",
    });

    const minted = await authed(env, "POST", "/api/calendar/feed-token", bob.cookie);
    const { url } = (await minted.json()) as { url: string };
    const text = await (
      await app.request(`/api/calendar/feed/${url.split("/").pop()}`, {}, env)
    ).text();
    expect(text).toContain("SUMMARY:Alice picnic");
    expect(text).not.toContain("Cara secret");
    expect(text).not.toContain("Alice passport");
  });

  it("per-event ICS is 401 without a session and 404 for another family", async () => {
    const { env, sqlite } = createTestEnv();
    const ownerA = seedUser(sqlite);
    const famA = seedFamily(sqlite, ownerA.id);
    const alice = seedActor(sqlite, famA.id, "owner");
    const ownerB = seedUser(sqlite);
    const famB = seedFamily(sqlite, ownerB.id);
    const cara = seedActor(sqlite, famB.id, "owner");

    const create = await authed(env, "POST", "/api/events", alice.cookie, {
      familyId: famA.id,
      title: "Choir",
      startAt: Math.floor(Date.now() / 1000) + 86400,
    });
    const { event } = (await create.json()) as { event: { id: string } };

    const unauth = await app.request(`/api/calendar/events/${event.id}/ics`);
    expect(unauth.status).toBe(401);

    const other = await authed(
      env,
      "GET",
      `/api/calendar/events/${event.id}/ics`,
      cara.cookie,
    );
    expect(other.status).toBe(404);

    const missing = await authed(
      env,
      "GET",
      "/api/calendar/events/not-a-real-id/ics",
      alice.cookie,
    );
    expect(missing.status).toBe(404);
  });
});

describe("Church snapshot + settle", () => {
  it("POST /settle without session → 401", async () => {
    const res = await app.request("/api/church/settle", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("POST /settle without machine token → 503", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");
    const res = await authed(env, "POST", "/api/church/settle", alice.cookie, {
      familyId: family.id,
      fundSlug: "tech-fund",
      periodKey: "2026-08",
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("church_not_configured");
  });

  it("POST /settle unknown fund → 404", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => churchFundsResponse("other"));
    const { env, sqlite } = createTestEnv({ CONTRIBUTIONS_API_TOKEN: "tok" });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");
    const res = await authed(env, "POST", "/api/church/settle", alice.cookie, {
      familyId: family.id,
      fundSlug: "tech-fund",
      periodKey: "2026-08",
    });
    expect(res.status).toBe(404);
  });

  it("snapshot and settle are family-scoped (other family → 404)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => churchFundsResponse());
    const { env, sqlite } = createTestEnv({ CONTRIBUTIONS_API_TOKEN: "tok" });
    const ownerA = seedUser(sqlite);
    const famA = seedFamily(sqlite, ownerA.id);
    seedActor(sqlite, famA.id, "owner");
    const ownerB = seedUser(sqlite);
    const famB = seedFamily(sqlite, ownerB.id);
    const cara = seedActor(sqlite, famB.id, "owner");

    const snap = await authed(
      env,
      "GET",
      `/api/church/snapshot?familyId=${famA.id}`,
      cara.cookie,
    );
    expect(snap.status).toBe(404);

    const settle = await authed(env, "POST", "/api/church/settle", cara.cookie, {
      familyId: famA.id,
      fundSlug: "tech-fund",
      periodKey: "2026-08",
    });
    expect(settle.status).toBe(404);
  });

  it("snapshot surfaces upstream failure as 502", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    const { env, sqlite } = createTestEnv({ CONTRIBUTIONS_API_TOKEN: "tok" });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");
    const res = await authed(
      env,
      "GET",
      `/api/church/snapshot?familyId=${family.id}`,
      alice.cookie,
    );
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe("church_upstream_error");
  });

  it("snapshot lists the settlement after a successful settle", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/funds")) return churchFundsResponse();
      if (url.includes("/api/purchases")) {
        return new Response(JSON.stringify({ purchases: [] }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    });
    const { env, sqlite } = createTestEnv({ CONTRIBUTIONS_API_TOKEN: "tok" });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");

    const settle = await authed(env, "POST", "/api/church/settle", alice.cookie, {
      familyId: family.id,
      fundSlug: "tech-fund",
      periodKey: "2026-09",
    });
    expect(settle.status).toBe(201);

    const snap = await authed(
      env,
      "GET",
      `/api/church/snapshot?familyId=${family.id}`,
      alice.cookie,
    );
    expect(snap.status).toBe(200);
    const body = (await snap.json()) as {
      settlements: { periodKey: string; collectedMinor: number }[];
    };
    expect(body.settlements[0]?.periodKey).toBe("2026-09");
    expect(body.settlements[0]?.collectedMinor).toBe(100_000);
  });
});

describe("Expense add without a category", () => {
  it("POST /expenses succeeds with categoryId null", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "member");
    const res = await authed(env, "POST", "/api/expenses", alice.cookie, {
      familyId: family.id,
      paidByMemberId: alice.memberId,
      amountMinor: 500,
      currency: "USD",
      expenseDate: "2026-09-01",
      categoryId: null,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { expense: { categoryId: string | null } };
    expect(body.expense.categoryId).toBeNull();
  });

  it("GET /categories without familyId → 400", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "member");
    const res = await authed(env, "GET", "/api/expenses/categories", alice.cookie);
    expect(res.status).toBe(400);
  });
});
