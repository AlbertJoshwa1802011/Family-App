/**
 * Security middleware contract tests: CSRF (Origin/Referer) enforcement.
 *
 * The CSRF check only fires for credentialed (cookie-bearing), state-changing
 * requests, and runs before requireSession — so we can assert it without a DB.
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";

describe("CSRF origin enforcement", () => {
  it("rejects a credentialed mutation from a foreign origin (403)", async () => {
    const res = await app.request("/api/documents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: "sid=fake-session",
        Origin: "https://evil.example",
      },
      body: JSON.stringify({ familyId: "f", title: "x" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden_origin");
  });

  it("does not block mutations that carry no session cookie (falls through to 401)", async () => {
    const res = await app.request("/api/documents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: JSON.stringify({ familyId: "f", title: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("does not block safe methods even with a cookie + foreign origin", async () => {
    const res = await app.request("/api/health", {
      headers: { Cookie: "sid=fake-session", Origin: "https://evil.example" },
    });
    expect(res.status).toBe(200);
  });

  it("blocks the download proxy from a foreign origin (before auth)", async () => {
    const res = await app.request("/api/documents/d1/files/f1/download", {
      headers: { Referer: "https://evil.example/page" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden_origin");
  });

  it("allows the download proxy with no Origin/Referer (falls through to auth)", async () => {
    const res = await app.request("/api/documents/d1/files/f1/download");
    expect(res.status).toBe(401);
  });
});
