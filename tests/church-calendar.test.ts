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

function mockChurchUpstream(opts: {
  authOk?: boolean;
  funds?: unknown[];
  purchases?: unknown[];
  onRequest?: (url: string, auth: string | null) => void;
}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("Authorization");
    opts.onRequest?.(url, auth);
    if (url.includes("/api/auth")) {
      if (opts.authOk === false) {
        return new Response(
          JSON.stringify({ success: false, isAdmin: false, message: "Missing or invalid credentials" }),
          { status: 401 },
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          isAdmin: true,
          email: "api-token",
          permissions: ["*"],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/api/funds")) {
      return new Response(
        JSON.stringify({
          success: true,
          funds:
            opts.funds ??
            [
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
          purchases:
            opts.purchases ??
            [
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
}

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

  it("GET /snapshot reads public totals with URL only (no machine token)", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    mockChurchUpstream({
      funds: [
        {
          slug: "tech-contributions",
          name: "Tech Fund",
          totalCollected: 38419,
          spentOnProducts: 28999,
          availableBalance: 9420,
          status: "active",
        },
      ],
      purchases: [
        {
          id: "P1",
          name: "Monitor",
          cost: 2500,
          date: "2026-07-07",
          fund: "tech-contributions",
          status: "Active",
        },
      ],
      onRequest: (url, auth) => seen.push({ url, auth }),
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
      auth: { mode: string; tokenOk: boolean | null };
      funds: { slug: string; availableBalance: number }[];
      purchases: { name: string; amount: number }[];
    };
    expect(body.configured).toBe(true);
    expect(body.auth).toEqual({ mode: "public", tokenOk: null });
    expect(body.funds[0].slug).toBe("tech-contributions");
    expect(body.funds[0].availableBalance).toBe(9420);
    expect(body.purchases[0].name).toBe("Monitor");
    expect(body.purchases[0].amount).toBe(2500);
    expect(seen.some((s) => s.url.includes("/api/auth"))).toBe(false);
    expect(seen.some((s) => s.url === "https://church.example/api/funds")).toBe(true);
    expect(seen.every((s) => s.auth === null)).toBe(true);
  });

  it("GET /snapshot returns live funds and purchases when token is verified", async () => {
    mockChurchUpstream({});

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
      auth: { mode: string; tokenOk: boolean; actor?: string };
      funds: { slug: string; availableBalance: number }[];
      purchases: { name: string }[];
    };
    expect(body.auth).toEqual({
      mode: "token",
      tokenOk: true,
      actor: "api-token",
    });
    expect(body.funds[0].slug).toBe("tech-fund");
    expect(body.funds[0].availableBalance).toBe(750);
    expect(body.purchases[0].name).toBe("Mic");
  });

  it("GET /snapshot sends Bearer token when CONTRIBUTIONS_API_TOKEN is set", async () => {
    const auths: (string | null)[] = [];
    mockChurchUpstream({
      funds: [],
      purchases: [],
      onRequest: (_url, auth) => auths.push(auth),
    });

    const { env, sqlite } = createTestEnv({
      CONTRIBUTIONS_API_URL: "https://church.example",
      CONTRIBUTIONS_API_TOKEN: "tok",
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
    expect(auths.length).toBeGreaterThan(0);
    expect(auths.every((h) => h === "Bearer tok")).toBe(true);
  });

  it("GET /snapshot with mismatched token → 502 church_token_invalid", async () => {
    mockChurchUpstream({ authOk: false });
    const { env, sqlite } = createTestEnv({
      CONTRIBUTIONS_API_URL: "https://church.example",
      CONTRIBUTIONS_API_TOKEN: "wrong",
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
    const body = (await res.json()) as { error: string; auth: { tokenOk: boolean } };
    expect(body.error).toBe("church_token_invalid");
    expect(body.auth.tokenOk).toBe(false);
  });

  it("POST /settle snapshots live totals for the month", async () => {
    mockChurchUpstream({});

    const { env, sqlite } = createTestEnv({
      CONTRIBUTIONS_API_URL: "https://church.example",
    });
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "owner");

    const res = await authed(env, "POST", "/api/church/settle", alice.cookie, {
      familyId: family.id,
      fundSlug: "tech-fund",
      periodKey: "2026-08",
      note: "Bank transfer done",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      settlement: { collectedMinor: number; remainingMinor: number; periodKey: string };
    };
    expect(body.settlement.periodKey).toBe("2026-08");
    expect(body.settlement.collectedMinor).toBe(100_000);
    expect(body.settlement.remainingMinor).toBe(75_000);

    const again = await authed(env, "POST", "/api/church/settle", alice.cookie, {
      familyId: family.id,
      fundSlug: "tech-fund",
      periodKey: "2026-08",
    });
    expect(again.status).toBe(409);
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
