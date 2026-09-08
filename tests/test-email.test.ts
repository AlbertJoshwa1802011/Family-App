/**
 * Settings / Money "Send test email" — success path, not just the 503 gate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../worker/index";
import { PRODUCTION_APP_ORIGIN } from "../worker/lib/publicUrl";
import { GOOGLE_SCOPES } from "../worker/lib/google";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

const ORIGIN = "http://localhost:5173";

async function postTestEmail(env: TestEnv, cookie: string) {
  return app.request(
    "/api/notifications/test-email",
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: ORIGIN,
      },
    },
    env.env,
  );
}

describe("POST /api/notifications/test-email success", () => {
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  let t: TestEnv;

  beforeEach(() => {
    sent.length = 0;
    t = createTestEnv({
      RESEND_API_KEY: "re_test",
      APP_URL: "https://fam.connect-cloud.workers.dev",
    });
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends to the signed-in address via Resend with a working CTA", async () => {
    const owner = seedUser(t.sqlite, { email: "alice@example.com" });
    const family = seedFamily(t.sqlite, owner.id);
    const alice = seedActor(t.sqlite, family.id, "owner", {
      email: "alice.member@example.com",
    });

    const res = await postTestEmail(t, alice.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      to: string;
      via: string;
    };
    expect(body.ok).toBe(true);
    expect(body.to).toBe("alice.member@example.com");
    expect(body.via).toBe("resend");

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("alice.member@example.com");
    expect(sent[0].subject).toBe("[Family Vault reminder] Test reminder");
    expect(sent[0].html).toContain("Family Vault test reminder");
    expect(sent[0].html).toContain("https://fam.connect-cloud.workers.dev");
    expect(sent[0].html).not.toContain("https://familyvault.app");
  });

  it("uses reminderEmail override when set", async () => {
    const owner = seedUser(t.sqlite, { email: "alice@example.com" });
    const family = seedFamily(t.sqlite, owner.id);
    const alice = seedActor(t.sqlite, family.id, "owner", {
      email: "alice.member@example.com",
    });
    t.sqlite
      .prepare(
        "INSERT INTO reminder_prefs (user_id, reminder_email) VALUES (?, ?)",
      )
      .run(alice.userId, "alerts@example.com");

    const res = await postTestEmail(t, alice.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { to: string };
    expect(body.to).toBe("alerts@example.com");
    expect(sent[0].to).toBe("alerts@example.com");
  });

  it("falls back to the production origin when APP_URL is empty", async () => {
    t = createTestEnv({
      RESEND_API_KEY: "re_test",
      APP_URL: "",
    });
    const owner = seedUser(t.sqlite);
    const family = seedFamily(t.sqlite, owner.id);
    const alice = seedActor(t.sqlite, family.id, "owner", {
      email: "alice@example.com",
    });

    const res = await postTestEmail(t, alice.cookie);
    expect(res.status).toBe(200);
    expect(sent[0].html).toContain(PRODUCTION_APP_ORIGIN);
    expect(sent[0].html).not.toContain("https://familyvault.app");
  });
});

describe("POST /api/notifications/test-email via Gmail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends via the user's Gmail when Resend is not configured", async () => {
    const t = createTestEnv({
      APP_URL: "https://fam.connect-cloud.workers.dev",
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "csecret",
    });
    const owner = seedUser(t.sqlite);
    const family = seedFamily(t.sqlite, owner.id);
    const alice = seedActor(t.sqlite, family.id, "owner", {
      email: "alice@example.com",
    });
    await t.env.KV.put(`user:refresh_token:${alice.userId}`, "refresh-token");
    await t.env.KV.put(
      `user:google_scopes:${alice.userId}`,
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

    const res = await postTestEmail(t, alice.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; via: string; to: string };
    expect(body.ok).toBe(true);
    expect(body.via).toBe("gmail");
    expect(body.to).toBe("alice@example.com");
    expect(gmailHit).toBe(true);
  });
});
