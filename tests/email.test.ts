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
  sendEmailResult,
} from "../worker/lib/email";
import type { Env } from "../worker/types";

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
});

describe("sendEmailResult", () => {
  it("returns email_not_configured without a key", async () => {
    const result = await sendEmailResult(makeEnv(), {
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });
    expect(result).toEqual({ ok: false, error: "email_not_configured" });
  });

  it("returns resend_<status> when Resend rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("bad from", { status: 403 }),
    );
    const result = await sendEmailResult(makeEnv({ RESEND_API_KEY: "re_test" }), {
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("resend_403");
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
