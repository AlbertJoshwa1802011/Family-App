import { describe, expect, it } from "vitest";
import { app } from "../worker/index";

describe("worker API", () => {
  it("GET /api/health returns ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("family-vault");
  });

  it("GET /api/auth/me returns an unauthenticated shape", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: unknown; families: unknown[] };
    expect(body.user).toBeNull();
    expect(Array.isArray(body.families)).toBe(true);
  });

  it("unknown /api routes return JSON 404 (not SPA HTML)", async () => {
    const res = await app.request("/api/this-does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("protected Phase 2 endpoints return 401 without session", async () => {
    // POST /api/documents now requires auth (requireSession fires before Zod).
    const res = await app.request("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ familyId: "fam-1", title: "Passport" }),
    });
    expect(res.status).toBe(401);
  });

  it("applies baseline security headers on /api responses", async () => {
    const res = await app.request("/api/health");
    // hono secureHeaders defaults
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
});

describe("scheduled handler (reminders without login)", () => {
  it("the Worker default export has a scheduled() function", async () => {
    const mod = await import("../worker/index");
    const worker = mod.default as { scheduled?: unknown };
    expect(typeof worker.scheduled).toBe("function");
  });
});
