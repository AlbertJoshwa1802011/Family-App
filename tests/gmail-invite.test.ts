/**
 * Gmail send helper + invite email fallback (Resend → inviter Gmail).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../worker/index";
import {
  buildGmailRawMessage,
  sendEmailViaGmail,
} from "../worker/lib/gmail";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedSession,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildGmailRawMessage", () => {
  it("builds an HTML RFC2822 message with From/To/Subject", () => {
    const raw = buildGmailRawMessage({
      fromEmail: "owner@gmail.com",
      fromName: "Olive",
      to: "guest@example.com",
      subject: "You're invited",
      html: "<p>Join us</p>",
    });
    expect(raw).toContain("From: Olive <owner@gmail.com>");
    expect(raw).toContain("To: guest@example.com");
    expect(raw).toContain("Subject: You're invited");
    expect(raw).toContain("Content-Type: text/html; charset=UTF-8");
    expect(raw).toContain("<p>Join us</p>");
  });

  it("RFC2047-encodes non-ASCII subjects", () => {
    const raw = buildGmailRawMessage({
      fromEmail: "a@b.com",
      to: "c@d.com",
      subject: "Invite — family",
      html: "<p>x</p>",
    });
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
  });
});

describe("sendEmailViaGmail", () => {
  it("returns false without a refresh token and does not call Gmail", async () => {
    const t = createTestEnv({
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "sec",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const ok = await sendEmailViaGmail(t.env, {
      userId: "u1",
      fromEmail: "me@gmail.com",
      message: { to: "you@x.com", subject: "Hi", html: "<p>x</p>" },
    });
    expect(ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts raw MIME to Gmail API and returns true on 2xx", async () => {
    const t = createTestEnv({
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "sec",
    });
    await t.env.KV.put("user:refresh_token:u1", "rt-u1");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("oauth2.googleapis.com/token")) {
          return new Response(
            JSON.stringify({ access_token: "atok", expires_in: 3600 }),
            { status: 200 },
          );
        }
        if (url.includes("gmail.googleapis.com")) {
          expect(init?.method).toBe("POST");
          const body = JSON.parse(String(init?.body)) as { raw: string };
          expect(body.raw).toMatch(/^[A-Za-z0-9_-]+$/);
          const padded = body.raw.replace(/-/g, "+").replace(/_/g, "/");
          const bin = atob(padded);
          expect(bin).toContain("To: you@x.com");
          expect(bin).toContain("From: Me <me@gmail.com>");
          return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
        }
        return new Response(`unexpected ${url}`, { status: 500 });
      });

    const ok = await sendEmailViaGmail(t.env, {
      userId: "u1",
      fromEmail: "me@gmail.com",
      fromName: "Me",
      message: { to: "you@x.com", subject: "Hi", html: "<p>x</p>" },
    });
    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("returns false on insufficient gmail.send scope", async () => {
    const t = createTestEnv({
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "sec",
    });
    await t.env.KV.put("user:refresh_token:u1", "rt-u1");

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("oauth2.googleapis.com/token")) {
          return new Response(
            JSON.stringify({ access_token: "atok", expires_in: 3600 }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            error: {
              status: "PERMISSION_DENIED",
              message: "Request had insufficient authentication scopes.",
            },
          }),
          { status: 403 },
        );
      },
    );

    const ok = await sendEmailViaGmail(t.env, {
      userId: "u1",
      fromEmail: "me@gmail.com",
      message: { to: "you@x.com", subject: "Hi", html: "<p>x</p>" },
    });
    expect(ok).toBe(false);
  });
});

describe("POST /families/:id/invites Gmail fallback", () => {
  let t: TestEnv;
  let familyId: string;
  let owner: ReturnType<typeof seedActor>;

  beforeEach(() => {
    t = createTestEnv({
      GOOGLE_CLIENT_ID: "test-client",
      GOOGLE_CLIENT_SECRET: "test-secret",
      APP_URL: "https://vault.example",
    });
    const ownerUser = seedUser(t.sqlite, {
      email: "olive@gmail.com",
      name: "Olive",
    });
    familyId = seedFamily(t.sqlite, ownerUser.id, "Olive Family").id;
    // Membership + session for the named owner (Gmail From: uses this email).
    t.sqlite
      .prepare(
        "INSERT INTO family_members (id, family_id, user_id, member_type, role, status) VALUES (?, ?, ?, 'user', 'owner', 'active')",
      )
      .run(crypto.randomUUID(), familyId, ownerUser.id);
    owner = {
      userId: ownerUser.id,
      memberId: "owner-member",
      cookie: seedSession(t.sqlite, ownerUser.id),
      email: ownerUser.email,
    };
  });

  function invite(body: object) {
    // No Origin header — CSRF allows non-browser clients (same as other API tests).
    return app.request(
      `/api/families/${familyId}/invites`,
      {
        method: "POST",
        headers: {
          Cookie: owner.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      t.env,
    );
  }

  it("sends via Gmail when Resend is unset and returns emailVia=gmail", async () => {
    await t.env.KV.put(`user:refresh_token:${owner.userId}`, "rt-owner");

    const gmailCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("oauth2.googleapis.com/token")) {
          return new Response(
            JSON.stringify({ access_token: "atok", expires_in: 3600 }),
            { status: 200 },
          );
        }
        if (url.includes("gmail.googleapis.com")) {
          gmailCalls.push(String(init?.body));
          return new Response(JSON.stringify({ id: "msg1" }), { status: 200 });
        }
        return new Response(`unexpected ${url}`, { status: 500 });
      }),
    );

    const res = await invite({
      email: "joshpicsindrive@gmail.com",
      role: "member",
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      invite: { emailSent: boolean; emailVia: string | null; inviteUrl: string };
    };
    expect(json.invite.emailSent).toBe(true);
    expect(json.invite.emailVia).toBe("gmail");
    expect(json.invite.inviteUrl).toContain("https://vault.example/invite/");
    expect(gmailCalls).toHaveLength(1);
  });

  it("prefers Resend over Gmail when RESEND_API_KEY is set", async () => {
    t = createTestEnv({
      GOOGLE_CLIENT_ID: "test-client",
      GOOGLE_CLIENT_SECRET: "test-secret",
      APP_URL: "https://vault.example",
      RESEND_API_KEY: "re_test",
    });
    const ownerUser = seedUser(t.sqlite, {
      email: "olive@gmail.com",
      name: "Olive",
    });
    familyId = seedFamily(t.sqlite, ownerUser.id).id;
    owner = seedActor(t.sqlite, familyId, "owner", {
      email: "olive2@gmail.com",
      name: "Olive",
    });
    await t.env.KV.put(`user:refresh_token:${owner.userId}`, "rt-owner");

    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("api.resend.com")) {
          return new Response(JSON.stringify({ id: "e1" }), { status: 200 });
        }
        return new Response(`unexpected ${url}`, { status: 500 });
      }),
    );

    const res = await invite({ email: "guest@example.com" });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      invite: { emailSent: boolean; emailVia: string | null };
    };
    expect(json.invite.emailSent).toBe(true);
    expect(json.invite.emailVia).toBe("resend");
    expect(urls.some((u) => u.includes("gmail"))).toBe(false);
  });

  it("returns emailSent=false when neither Resend nor Gmail works", async () => {
    const res = await invite({ email: "guest@example.com" });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      invite: { emailSent: boolean; emailVia: string | null; token: string };
    };
    expect(json.invite.emailSent).toBe(false);
    expect(json.invite.emailVia).toBeNull();
    expect(json.invite.token).toBeTruthy();
  });
});
