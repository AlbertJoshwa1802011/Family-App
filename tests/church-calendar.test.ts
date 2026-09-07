import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../worker/index";
import { createTestEnv, seedActor, seedFamily, seedUser } from "./helpers/testEnv";

const ORIGIN = "http://localhost:5173";

function authed(
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
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/api/church", () => {
  it("GET /snapshot without session → 401", async () => {
    const res = await app.request("/api/church/snapshot");
    expect(res.status).toBe(401);
  });

  it("GET /snapshot without URL or token → 503 church_not_configured", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");
    const res = await authed(
      env,
      "GET",
      `/api/church/snapshot?familyId=${family.id}`,
      alice.cookie,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("church_not_configured");
  });

  it("GET /snapshot works with CONTRIBUTIONS_API_URL alone (no token)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/funds")) {
        return new Response(
          JSON.stringify({
            success: true,
            funds: [
              {
                slug: "tech-fund",
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
      if (url.includes("/api/purchases")) {
        return new Response(JSON.stringify({ purchases: [] }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    });

    const { env, sqlite } = createTestEnv({
      CONTRIBUTIONS_API_URL: "https://church.example",
    });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");
    const res = await authed(
      env,
      "GET",
      `/api/church/snapshot?familyId=${family.id}`,
      alice.cookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      configured: boolean;
      funds: { slug: string }[];
    };
    expect(body.configured).toBe(true);
    expect(body.funds[0]?.slug).toBe("tech-fund");
  });

  it("GET /snapshot maps upstream 401 to church_auth_failed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("unauthorized", { status: 401 }),
    );
    const { env, sqlite } = createTestEnv({
      CONTRIBUTIONS_API_TOKEN: "bad",
      CONTRIBUTIONS_API_URL: "https://church.example",
    });
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
    expect(((await res.json()) as { error: string }).error).toBe("church_auth_failed");
  });

  it("GET /snapshot returns live funds and purchases when configured", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/funds")) {
        return new Response(
          JSON.stringify({
            success: true,
            funds: [
              {
                slug: "tech-fund",
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
      if (url.includes("/api/purchases")) {
        return new Response(
          JSON.stringify({
            purchases: [
              {
                id: "P1",
                name: "Mic",
                amount: 250,
                date: "2026-08-01",
                fund: "tech-fund",
                status: "Active",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("nope", { status: 404 });
    });

    const { env, sqlite } = createTestEnv({
      CONTRIBUTIONS_API_TOKEN: "tok",
      CONTRIBUTIONS_API_URL: "https://church.example",
    });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");

    const res = await authed(
      env,
      "GET",
      `/api/church/snapshot?familyId=${family.id}`,
      alice.cookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      funds: { slug: string; availableBalance: number }[];
      purchases: { name: string }[];
    };
    expect(body.funds[0].slug).toBe("tech-fund");
    expect(body.funds[0].availableBalance).toBe(750);
    expect(body.purchases[0].name).toBe("Mic");
  });

  it("POST /settle snapshots live totals for the month", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          success: true,
          funds: [
            {
              slug: "tech-fund",
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
    });

    const { env, sqlite } = createTestEnv({
      CONTRIBUTIONS_API_TOKEN: "tok",
    });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");

    const res = await authed(env, "POST", "/api/church/settle", alice.cookie, {
      familyId: family.id,
      fundSlug: "tech-fund",
      periodKey: "2026-08",
      dueMinor: 75_000,
      paidMinor: 75_000,
      note: "Bank transfer done",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      settlement: {
        collectedMinor: number;
        dueMinor: number;
        paidMinor: number;
        remainingMinor: number;
        periodKey: string;
      };
    };
    expect(body.settlement.periodKey).toBe("2026-08");
    expect(body.settlement.collectedMinor).toBe(100_000);
    expect(body.settlement.dueMinor).toBe(75_000);
    expect(body.settlement.paidMinor).toBe(75_000);
    expect(body.settlement.remainingMinor).toBe(0);
  });

  it("POST /settle allows partial payment and carries the rest", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          success: true,
          funds: [
            {
              slug: "tech-fund",
              name: "Tech fund",
              totalCollected: 5320,
              spentOnProducts: 0,
              availableBalance: 5320,
              status: "active",
            },
          ],
        }),
        { status: 200 },
      );
    });

    const { env, sqlite } = createTestEnv({
      CONTRIBUTIONS_API_TOKEN: "tok",
    });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");

    const partial = await authed(env, "POST", "/api/church/settle", alice.cookie, {
      familyId: family.id,
      fundSlug: "tech-fund",
      periodKey: "2026-09",
      dueMinor: 532_000,
      paidMinor: 300_000,
      note: "Partial — rest next month",
    });
    expect(partial.status).toBe(201);
    const first = (await partial.json()) as {
      settlement: { dueMinor: number; paidMinor: number; remainingMinor: number };
    };
    expect(first.settlement.dueMinor).toBe(532_000);
    expect(first.settlement.paidMinor).toBe(300_000);
    expect(first.settlement.remainingMinor).toBe(232_000);

    const snap = await authed(
      env,
      "GET",
      `/api/church/snapshot?familyId=${family.id}`,
      alice.cookie,
    );
    expect(snap.status).toBe(200);
    const snapBody = (await snap.json()) as {
      funds: { slug: string; outstandingMinor: number; suggestedDueMinor: number }[];
    };
    expect(snapBody.funds[0]?.outstandingMinor).toBe(232_000);
    expect(snapBody.funds[0]?.suggestedDueMinor).toBe(232_000);

    const payoff = await authed(env, "POST", "/api/church/settle", alice.cookie, {
      familyId: family.id,
      fundSlug: "tech-fund",
      periodKey: "2026-10",
      dueMinor: 232_000,
      paidMinor: 232_000,
    });
    expect(payoff.status).toBe(201);
    const second = (await payoff.json()) as {
      settlement: { remainingMinor: number };
    };
    expect(second.settlement.remainingMinor).toBe(0);

    const snap2 = await authed(
      env,
      "GET",
      `/api/church/snapshot?familyId=${family.id}`,
      alice.cookie,
    );
    const snapBody2 = (await snap2.json()) as {
      funds: { outstandingMinor: number }[];
      settlements: { remainingMinor: number }[];
    };
    expect(snapBody2.funds[0]?.outstandingMinor).toBe(0);
    // Prior carry row is cleared so outstanding does not stack.
    expect(snapBody2.settlements.every((s) => s.remainingMinor === 0)).toBe(true);
  });

  it("POST /settle rejects paidMinor greater than dueMinor", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          success: true,
          funds: [
            {
              slug: "tech-fund",
              name: "Tech fund",
              totalCollected: 1000,
              spentOnProducts: 0,
              availableBalance: 1000,
              status: "active",
            },
          ],
        }),
        { status: 200 },
      );
    });
    const { env, sqlite } = createTestEnv({ CONTRIBUTIONS_API_TOKEN: "tok" });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");
    const res = await authed(env, "POST", "/api/church/settle", alice.cookie, {
      familyId: family.id,
      fundSlug: "tech-fund",
      periodKey: "2026-08",
      dueMinor: 100_000,
      paidMinor: 150_000,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("validation_error");
  });

  it("GET /snapshot without familyId → 400", async () => {
    const { env, sqlite } = createTestEnv({ CONTRIBUTIONS_API_TOKEN: "tok" });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");
    const res = await authed(env, "GET", "/api/church/snapshot", alice.cookie);
    expect(res.status).toBe(400);
  });

  it("POST /settle with invalid periodKey → 400 validation_error", async () => {
    const { env, sqlite } = createTestEnv({ CONTRIBUTIONS_API_TOKEN: "tok" });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");
    const res = await authed(env, "POST", "/api/church/settle", alice.cookie, {
      familyId: family.id,
      fundSlug: "tech-fund",
      periodKey: "August",
      dueMinor: 75_000,
      paidMinor: 75_000,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("GET /api/church/nope → 404 not_found", async () => {
    const res = await app.request("/api/church/nope");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});

describe("/api/calendar", () => {
  it("POST /feed-token without session → 401", async () => {
    const res = await app.request("/api/calendar/feed-token", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("GET unknown feed → 404 JSON", async () => {
    const { env } = createTestEnv();
    const res = await app.request("/api/calendar/feed/nope.ics", {}, env);
    expect(res.status).toBe(404);
  });

  it("mints a feed and serves ICS for the family event", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");

    await authed(env, "POST", "/api/events", alice.cookie, {
      familyId: family.id,
      title: "Picnic",
      startAt: Math.floor(Date.now() / 1000) + 86400,
    });

    const minted = await authed(env, "POST", "/api/calendar/feed-token", alice.cookie);
    expect(minted.status).toBe(200);
    const { url } = (await minted.json()) as { url: string };
    const file = url.split("/").pop()!;
    const feed = await app.request(`/api/calendar/feed/${file}`, {}, env);
    expect(feed.status).toBe(200);
    expect(feed.headers.get("content-type")).toContain("text/calendar");
    const text = await feed.text();
    expect(text).toContain("SUMMARY:Picnic");
  });

  it("GET /events/:id/ics downloads the event", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");

    const create = await authed(env, "POST", "/api/events", alice.cookie, {
      familyId: family.id,
      title: "Choir",
      startAt: Math.floor(Date.now() / 1000) + 86400,
    });
    const created = (await create.json()) as { event: { id: string } };

    const ics = await authed(
      env,
      "GET",
      `/api/calendar/events/${created.event.id}/ics`,
      alice.cookie,
    );
    expect(ics.status).toBe(200);
    expect(ics.headers.get("content-type")).toContain("text/calendar");
    expect(await ics.text()).toContain("SUMMARY:Choir");
  });
});

describe("POST /api/notifications/test-email", () => {
  it("returns 503 when Resend is not configured", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");
    const res = await authed(env, "POST", "/api/notifications/test-email", alice.cookie);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("email_not_configured");
  });
});
