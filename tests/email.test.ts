/**
 * Tests for the Resend email helper (worker/lib/email.ts).
 *
 * `fetch` is mocked so no real network call is made. Verifies the
 * not-configured no-op, the success path, and graceful failure handling
 * (the cron relies on a boolean return, never an exception).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isEmailConfigured,
  reminderEmailHtml,
  sendEmail,
  sendEmailDetailed,
} from "../worker/lib/email";
import type { Env } from "../worker/types";
import { createTestEnv, seedUser } from "./helpers/testEnv";
import { GMAIL_SEND_SCOPE } from "../worker/lib/googleAuth";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: {} as Fetcher,
    DB: {} as D1Database,
    KV: {} as KVNamespace,
    APP_URL: "https://vault.example",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isEmailConfigured", () => {
  it("false without RESEND_API_KEY", () => {
    expect(isEmailConfigured(makeEnv())).toBe(false);
  });
  it("true with RESEND_API_KEY", () => {
    expect(isEmailConfigured(makeEnv({ RESEND_API_KEY: "re_test" }))).toBe(true);
  });
});

describe("sendEmail", () => {
  it("returns false and does not fetch when not configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const ok = await sendEmail(makeEnv(), {
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });
    expect(ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to Resend with auth header and returns true on 2xx", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "e1" }), { status: 200 }));

    const ok = await sendEmail(makeEnv({ RESEND_API_KEY: "re_test" }), {
      to: "a@b.com",
      subject: "Expiring soon",
      html: "<p>x</p>",
    });

    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.to).toBe("a@b.com");
    expect(body.subject).toBe("Expiring soon");
  });

  it("returns false on a non-2xx Resend response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );
    const ok = await sendEmail(makeEnv({ RESEND_API_KEY: "re_test" }), {
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });
    expect(ok).toBe(false);
  });

  it("returns false (never throws) when fetch rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const ok = await sendEmail(makeEnv({ RESEND_API_KEY: "re_test" }), {
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });
    expect(ok).toBe(false);
  });

  it("keeps ICS attachments on the Resend payload", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "e1" }), { status: 200 }));
    const ok = await sendEmail(makeEnv({ RESEND_API_KEY: "re_test" }), {
      to: "a@b.com",
      subject: "Dinner",
      html: "<p>x</p>",
      attachments: [
        { filename: "event.ics", content: "QUJD", contentType: "text/calendar" },
      ],
    });
    expect(ok).toBe(true);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.attachments[0].filename).toBe("event.ics");
    expect(body.attachments[0].content).toBe("QUJD");
  });
});

describe("sendEmail Gmail", () => {
  it("sends via Gmail for fromUserId before Resend", async () => {
    const t = createTestEnv({
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "sec",
      RESEND_API_KEY: "re_test",
    });
    const user = seedUser(t.sqlite, { email: "me@example.com", name: "Me" });
    await t.env.KV.put(`user:refresh_token:${user.id}`, "rt");
    await t.env.KV.put(
      `user:google_scopes:${user.id}`,
      JSON.stringify([GMAIL_SEND_SCOPE]),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "tok", expires_in: 3600 }),
          { status: 200 },
        );
      }
      if (url.includes("gmail.googleapis.com")) {
        return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
      }
      return new Response("resend should not run", { status: 500 });
    });

    const result = await sendEmailDetailed(
      t.env,
      { to: "guest@example.com", subject: "Invite", html: "<p>hi</p>" },
      { fromUserId: user.id },
    );
    expect(result.ok).toBe(true);
    expect(result.via).toBe("gmail");
    expect(result.from).toContain("me@example.com");
    const urls = fetchSpy.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes("gmail.googleapis.com"))).toBe(true);
    expect(urls.some((u) => u.includes("resend.com"))).toBe(false);
  });
});

describe("reminderEmailHtml", () => {
  it("includes the heading, body, and CTA link", () => {
    const html = reminderEmailHtml({
      heading: "Expiring soon: Passport",
      body: "Renew it.",
      ctaLabel: "View document",
      ctaUrl: "https://vault.example/documents/abc",
    });
    expect(html).toContain("Expiring soon: Passport");
    expect(html).toContain("Renew it.");
    expect(html).toContain("https://vault.example/documents/abc");
    expect(html).toContain("View document");
  });

  it("escapes HTML in interpolated values (no injection)", () => {
    const html = reminderEmailHtml({
      heading: "<script>alert(1)</script>",
      body: "a & b < c",
      ctaLabel: "Go",
      ctaUrl: "https://x/y?a=1&b=2",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a &amp; b &lt; c");
  });
});
