/**
 * Albert iOS companion auth bridge:
 * - Bearer session acceptance on /auth/me, logout, and requireSession routes
 * - One-time mobile OAuth code exchange
 * - Mobile device registration stub
 */
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../worker/index";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedUser,
  seedSession,
  type TestEnv,
} from "./helpers/testEnv";
import { IOS_OAUTH_CALLBACK_SCHEME } from "../worker/routes/auth";

function sessionIdFromCookie(cookie: string): string {
  const m = /^sid=(.+)$/.exec(cookie);
  if (!m) throw new Error(`unexpected cookie: ${cookie}`);
  return m[1]!;
}

describe("Albert iOS — Bearer session", () => {
  let t: TestEnv;
  let cookie: string;
  let token: string;
  let userId: string;

  beforeEach(() => {
    t = createTestEnv();
    const owner = seedUser(t.sqlite, { email: "ios@example.com", name: "Ios User" });
    const family = seedFamily(t.sqlite, owner.id);
    const actor = seedActor(t.sqlite, family.id, "owner", {
      email: "ios-member@example.com",
      name: "Member",
    });
    cookie = actor.cookie;
    token = sessionIdFromCookie(cookie);
    userId = actor.userId;
    void userId;
  });

  it("GET /auth/me accepts Authorization Bearer", async () => {
    const res = await app.request(
      "/api/auth/me",
      { headers: { Authorization: `Bearer ${token}` } },
      t.env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { email: string } | null;
      families: unknown[];
    };
    expect(body.user?.email).toBe("ios-member@example.com");
    expect(body.families.length).toBeGreaterThan(0);
  });

  it("GET /auth/me rejects non-UUID bearer tokens", async () => {
    const res = await app.request(
      "/api/auth/me",
      { headers: { Authorization: "Bearer not-a-session" } },
      t.env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: unknown };
    expect(body.user).toBeNull();
  });

  it("protected route accepts Bearer instead of cookie", async () => {
    const familyId = (
      await app.request(
        "/api/auth/me",
        { headers: { Authorization: `Bearer ${token}` } },
        t.env,
      ).then((r) => r.json())
    ) as { families: { id: string }[] };

    const res = await app.request(
      `/api/tasks?familyId=${familyId.families[0]!.id}&view=priority`,
      { headers: { Authorization: `Bearer ${token}` } },
      t.env,
    );
    expect(res.status).toBe(200);
  });

  it("POST /auth/logout revokes Bearer session", async () => {
    const logout = await app.request(
      "/api/auth/logout",
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      t.env,
    );
    expect(logout.status).toBe(200);

    const me = await app.request(
      "/api/auth/me",
      { headers: { Authorization: `Bearer ${token}` } },
      t.env,
    );
    const body = (await me.json()) as { user: unknown };
    expect(body.user).toBeNull();
  });
});

describe("Albert iOS — mobile OAuth exchange", () => {
  let t: TestEnv;

  beforeEach(() => {
    t = createTestEnv({ GOOGLE_CLIENT_ID: "test-client-id" });
  });

  it("GET /auth/google/start?client=ios stores client=ios in OAuth state", async () => {
    const res = await app.request(
      "https://fam.connect-cloud.workers.dev/api/auth/google/start?client=ios",
      { method: "GET" },
      t.env,
    );
    expect([301, 302, 303, 307, 308]).toContain(res.status);
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith("https://accounts.google.com/")).toBe(true);
    const state = new URL(location).searchParams.get("state");
    expect(state).toBeTruthy();
    const stored = (await t.env.KV.get(`oauth:state:${state}`, "json")) as {
      client?: string;
    };
    expect(stored.client).toBe("ios");
  });

  it("POST /auth/mobile/exchange returns sessionToken for a valid one-time code", async () => {
    const user = seedUser(t.sqlite, { email: "mobile@example.com" });
    const cookie = seedSession(t.sqlite, user.id);
    const sessionId = sessionIdFromCookie(cookie);
    const code = "test-mobile-code-abcdef";
    await t.env.KV.put(
      `oauth:mobile:${code}`,
      JSON.stringify({ sessionId }),
      { expirationTtl: 60 },
    );

    const res = await app.request(
      "/api/auth/mobile/exchange",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      },
      t.env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessionToken: string;
      expiresAt: number;
      user: { email: string };
      families: unknown[];
    };
    expect(body.sessionToken).toBe(sessionId);
    expect(body.user.email).toBe("mobile@example.com");
    expect(typeof body.expiresAt).toBe("number");

    // Code is single-use
    const reuse = await app.request(
      "/api/auth/mobile/exchange",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      },
      t.env,
    );
    expect(reuse.status).toBe(401);
    expect(((await reuse.json()) as { error: string }).error).toBe("invalid_code");
  });

  it("POST /auth/mobile/exchange rejects missing code with validation_error", async () => {
    const res = await app.request(
      "/api/auth/mobile/exchange",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      t.env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("validation_error");
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it("POST /auth/mobile/exchange rejects unknown code", async () => {
    const res = await app.request(
      "/api/auth/mobile/exchange",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "no-such-code-zzzz" }),
      },
      t.env,
    );
    expect(res.status).toBe(401);
  });

  it("exports the Albert custom-scheme constant for docs/tests", () => {
    expect(IOS_OAUTH_CALLBACK_SCHEME).toBe("albert://oauth-callback");
  });
});

describe("Albert iOS — mobile device stub", () => {
  it("requires auth", async () => {
    const t = createTestEnv();
    const res = await app.request(
      "/api/auth/mobile/device",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "ios" }),
      },
      t.env,
    );
    expect(res.status).toBe(401);
  });

  it("returns ok for an authenticated iOS client", async () => {
    const t = createTestEnv();
    const user = seedUser(t.sqlite);
    const cookie = seedSession(t.sqlite, user.id);
    const token = sessionIdFromCookie(cookie);
    const res = await app.request(
      "/api/auth/mobile/device",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ platform: "ios" }),
      },
      t.env,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});
