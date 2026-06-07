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

  it("unimplemented Phase 1/2 endpoints return 501", async () => {
    const res = await app.request("/api/documents", { method: "POST" });
    expect(res.status).toBe(501);
  });
});
