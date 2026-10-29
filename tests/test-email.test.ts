/**
 * Settings "Send test email" and family-invite delivery.
 *
 * Production lost POST /notifications/test-email and the Gmail transport when
 * Money Manager was restored. These tests pin both: Gmail via the signed-in
 * user, Resend fallback, and invite mail using the same path.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../worker/index";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedUser,
} from "./helpers/testEnv";
import { GMAIL_SEND_SCOPE } from "../worker/lib/googleAuth";

const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const RESEND_API = "https://api.resend.com/emails";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockGmailOk() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith(TOKEN_URL)) {
      return new Response(
        JSON.stringify({
          access_token: "ya29.test",
          expires_in: 3600,
          scope: GMAIL_SEND_SCOPE,
        }),
        { status: 200 },
      );
    }
    if (url === GMAIL_SEND) {
      return new Response(JSON.stringify({ id: "gmail-1" }), { status: 200 });
    }
    if (url === RESEND_API) {
      return new Response("should not call resend", { status: 500 });
    }
    return new Response("unexpected fetch " + url, { status: 599 });
  });
}

describe("POST /api/notifications/test-email", () => {
  it("sends via the caller's Gmail when a refresh token is present", async () => {
    const t = createTestEnv({
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "sec",
      APP_URL: "https://fam.connect-cloud.workers.dev",
    });
    const owner = seedUser(t.sqlite);
    const family = seedFamily(t.sqlite, owner.id);
    const actor = seedActor(t.sqlite, family.id, "owner", {
      email: "albert@example.com",
      name: "Albert",
    });
    await t.env.KV.put(`user:refresh_token:${actor.userId}`, "refresh-token");
    await t.env.KV.put(
      `user:google_scopes:${actor.userId}`,
      JSON.stringify([GMAIL_SEND_SCOPE]),
    );

    const fetchSpy = mockGmailOk();
    const res = await app.request(
      "/api/notifications/test-email",
      { method: "POST", headers: { Cookie: actor.cookie } },
      t.env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; to: string; via: string };
    expect(body.ok).toBe(true);
    expect(body.to).toBe("albert@example.com");
    expect(body.via).toBe("gmail");
    const urls = fetchSpy.mock.calls.map(([u]) => String(u));
    expect(urls).toContain(GMAIL_SEND);
    expect(urls).not.toContain(RESEND_API);
  });

  it("falls back to Resend when Gmail is not connected", async () => {
    const t = createTestEnv({
      RESEND_API_KEY: "re_test",
      APP_URL: "https://fam.connect-cloud.workers.dev",
    });
    const owner = seedUser(t.sqlite);
    const family = seedFamily(t.sqlite, owner.id);
    const actor = seedActor(t.sqlite, family.id, "owner", {
      email: "member@example.com",
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "e1" }), { status: 200 }));

    const res = await app.request(
      "/api/notifications/test-email",
      { method: "POST", headers: { Cookie: actor.cookie } },
      t.env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; to: string; via: string };
    expect(body.ok).toBe(true);
    expect(body.to).toBe("member@example.com");
    expect(body.via).toBe("resend");
    expect(String(fetchSpy.mock.calls[0][0])).toBe(RESEND_API);
  });

  it("returns 503 when neither Gmail nor Resend can send", async () => {
    const t = createTestEnv();
    const owner = seedUser(t.sqlite);
    const family = seedFamily(t.sqlite, owner.id);
    const actor = seedActor(t.sqlite, family.id, "owner");
    const res = await app.request(
      "/api/notifications/test-email",
      { method: "POST", headers: { Cookie: actor.cookie } },
      t.env,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("email_not_configured");
  });
});

describe("POST /api/families/:id/invites email", () => {
  it("sends the invite from the inviter's Gmail", async () => {
    const t = createTestEnv({
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "sec",
      APP_URL: "https://fam.connect-cloud.workers.dev",
    });
    const owner = seedUser(t.sqlite);
    const family = seedFamily(t.sqlite, owner.id, "The Family");
    const actor = seedActor(t.sqlite, family.id, "owner", {
      email: "owner@example.com",
      name: "Owner",
    });
    await t.env.KV.put(`user:refresh_token:${actor.userId}`, "refresh-token");
    await t.env.KV.put(
      `user:google_scopes:${actor.userId}`,
      JSON.stringify([GMAIL_SEND_SCOPE]),
    );
    mockGmailOk();

    const res = await app.request(
      `/api/families/${family.id}/invites`,
      {
        method: "POST",
        headers: {
          Cookie: actor.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: "guest@example.com", role: "member" }),
      },
      t.env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      invite: { emailSent: boolean; emailVia: string | null; inviteUrl: string };
    };
    expect(body.invite.emailSent).toBe(true);
    expect(body.invite.emailVia).toBe("gmail");
    expect(body.invite.inviteUrl).toContain("/invite/");
  });
});
