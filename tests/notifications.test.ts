/**
 * API contract tests for /api/notifications (Phase 3).
 *
 * All routes require a session — without a cookie every route returns 401
 * (requireSession fires before any handler or Zod validation). Deep/unmatched
 * paths return 404. Security headers + content-type asserted throughout.
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";

describe("/api/notifications: 401 without session", () => {
  const protectedRoutes = [
    { method: "GET",  path: "/api/notifications" },
    { method: "GET",  path: "/api/notifications?unreadOnly=1" },
    { method: "POST", path: "/api/notifications/read-all" },
    { method: "POST", path: "/api/notifications/notif-1/read" },
    { method: "GET",  path: "/api/notifications/prefs" },
    { method: "PUT",  path: "/api/notifications/prefs" },
  ];

  for (const { method, path } of protectedRoutes) {
    it(`${method} ${path} → 401`, async () => {
      const res = await app.request(path, { method });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("unauthorized");
    });
  }
});

describe("/api/notifications: PUT prefs validation gated behind auth", () => {
  // Even with an invalid body, auth fires first → 401 (not 400).
  it("PUT /api/notifications/prefs with invalid windows → 401 (auth first)", async () => {
    const res = await app.request("/api/notifications/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ windows: ["not-a-number"] }),
    });
    expect(res.status).toBe(401);
  });
});

describe("/api/notifications: deep path 404s", () => {
  it("/api/notifications/x/y/z → 404", async () => {
    const res = await app.request("/api/notifications/x/y/z");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});

describe("/api/notifications: security headers", () => {
  it("GET has x-content-type-options: nosniff (even on 401)", async () => {
    const res = await app.request("/api/notifications");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("response is application/json", async () => {
    const res = await app.request("/api/notifications");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("includes x-request-id for tracing", async () => {
    const res = await app.request("/api/notifications");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});
