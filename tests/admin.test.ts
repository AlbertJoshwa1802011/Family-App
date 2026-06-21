/**
 * Contract tests for the platform-admin storage routes (worker/routes/admin.ts).
 *
 * These routes are guarded by requireSession THEN requirePlatformAdmin. Without a
 * session cookie, requireSession short-circuits to 401 before any DB access — so we
 * can assert the auth contract without a bound D1. Mirrors the no-session pattern in
 * tests/worker-extended.test.ts.
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";

function post(path: string) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

describe("admin storage routes — auth enforcement (no session)", () => {
  it("GET /api/admin/storage → 401 unauthorized", async () => {
    const res = await app.request("/api/admin/storage");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("POST /api/admin/storage/connect/start → 401", async () => {
    const res = await post("/api/admin/storage/connect/start");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("unauthorized");
  });

  it("GET /api/admin/storage/connect/callback → 401 (session fires before code exchange)", async () => {
    const res = await app.request("/api/admin/storage/connect/callback?code=x&state=y");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("unauthorized");
  });

  it("POST /api/admin/storage/disconnect → 401", async () => {
    const res = await post("/api/admin/storage/disconnect");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("unauthorized");
  });
});

describe("admin storage routes — route shape", () => {
  it("unknown /api/admin/* path → 401 (auth gate covers all admin paths before routing)", async () => {
    const res = await app.request("/api/admin/does-not-exist");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("unauthorized");
  });

  it("unknown non-admin /api/* path → 404 not_found JSON", async () => {
    const res = await app.request("/api/totally-unknown");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("not_found");
  });

  it("401 response is application/json", async () => {
    const res = await app.request("/api/admin/storage");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("GET on a POST-only route (connect/start) without session still returns 401, not 404", async () => {
    // requireSession is registered on all admin routes via use('*'), so even a
    // method mismatch is gated by auth first.
    const res = await app.request("/api/admin/storage/connect/start");
    expect(res.status).toBe(401);
  });
});
