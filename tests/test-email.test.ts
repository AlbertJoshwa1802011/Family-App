/**
 * Settings / Money "Send test email" — success via Resend and via user Gmail.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../worker/index";
import { GOOGLE_SCOPES, scopesKey } from "../worker/lib/googleAuth";
import {
  createTestEnv,
  seedSession,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

async function postTestEmail(
  env: TestEnv["env"],
  cookie: string,
  body?: object,
) {
  // Omit Origin — CSRF allows non-browser clients with no Origin/Referer.
  return app.request(
    "/api/notifications/test-email",
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    env,
  );
}

describe("POST /api/notifications/test-email", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("401 without a session", async () => {
    const t = createTestEnv({ RESEND_API_KEY: "re_test" });
    const res = await app.request(
      "/api/notifications/test-email",
      { method: "POST" },
      t.env,
    );
    expect(res.status).toBe(401);
  });

  it("503 when neither Resend nor Gmail is available", async () => {
    const t = createTestEnv();
    const user = seedUser(t.sqlite, { email: "alice@example.com" });
    const cookie = seedSession(t.sqlite, user.id);
    const res = await postTestEmail(t.env, cookie);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("email_not_configured");
  });

  it("sends to the signed-in user via Resend", async () => {
    const t = createTestEnv({
      RESEND_API_KEY: "re_test",
      APP_URL: "https://vault.example",
    });
    const user = seedUser(t.sqlite, { email: "alice@example.com" });
    const cookie = seedSession(t.sqlite, user.id);

    const sent: Array<{ to: string; subject: string; html: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          to: string;
          subject: string;
          html: string;
        };
        if (body.to) sent.push(body);
        return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
      }),
    );

    const res = await postTestEmail(t.env, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      to: string;
      via: string;
    };
    expect(body.ok).toBe(true);
    expect(body.to).toBe("alice@example.com");
    expect(body.via).toBe("resend");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("alice@example.com");
    expect(sent[0].html).toContain("https://vault.example");
  });

  it("allows albertjoshrock101@gmail.com as an explicit recipient", async () => {
    const t = createTestEnv({ RESEND_API_KEY: "re_test" });
    const user = seedUser(t.sqlite, { email: "alice@example.com" });
    const cookie = seedSession(t.sqlite, user.id);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { to: string };
        expect(body.to).toBe("albertjoshrock101@gmail.com");
        return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
      }),
    );

    const res = await postTestEmail(t.env, cookie, {
      to: "albertjoshrock101@gmail.com",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { to: string };
    expect(body.to).toBe("albertjoshrock101@gmail.com");
  });

  it("sends via the user's Gmail when Resend is not configured", async () => {
    const t = createTestEnv({
      APP_URL: "https://vault.example",
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "csecret",
    });
    const user = seedUser(t.sqlite, {
      email: "alice@example.com",
      name: "Alice",
    });
    const cookie = seedSession(t.sqlite, user.id);
    await t.env.KV.put(`user:refresh_token:${user.id}`, "refresh-token");
    await t.env.KV.put(
      scopesKey(user.id),
      JSON.stringify([GOOGLE_SCOPES.gmailSend]),
    );

    let gmailHit = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("oauth2.googleapis.com/token")) {
          return new Response(
            JSON.stringify({
              access_token: "ya29.test",
              expires_in: 3600,
              scope: GOOGLE_SCOPES.gmailSend,
            }),
            { status: 200 },
          );
        }
        if (u.includes("gmail.googleapis.com")) {
          gmailHit = true;
          return new Response("{}", { status: 200 });
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    const res = await postTestEmail(t.env, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; via: string; to: string };
    expect(body.ok).toBe(true);
    expect(body.via).toBe("gmail");
    expect(body.to).toBe("alice@example.com");
    expect(gmailHit).toBe(true);
  });
});
