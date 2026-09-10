/**
 * API contract tests for /api/events, /api/tasks, /api/contacts.
 *
 * All routes now require authentication (Phase 2.5). Tests verify:
 * - 401 returned for every route without a valid session cookie
 * - 404 returned for paths that don't match any route (no middleware runs)
 * - Security headers and content-type on all responses
 * - requestId present for tracing
 *
 * Zod validation (400 responses) requires an authenticated session + real D1.
 * The validation schemas are exercised in integration tests and verified by
 * TypeScript compile-time type checking.
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";

// ── 1. /api/events — 401 without session ─────────────────────────────────────

describe("/api/events: 401 without session", () => {
  const protectedRoutes = [
    { method: "GET",    path: "/api/events" },
    { method: "POST",   path: "/api/events" },
    { method: "GET",    path: "/api/events/evt-1" },
    { method: "PATCH",  path: "/api/events/evt-1" },
    { method: "DELETE", path: "/api/events/evt-1" },
    { method: "POST",   path: "/api/events/evt-1/cancel" },
    { method: "POST",   path: "/api/events/evt-1/attendees" },
    { method: "DELETE", path: "/api/events/evt-1/attendees/mem-1" },
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

// ── 2. Deep/unmatched paths → 404 (no route → no middleware) ─────────────────

describe("/api/events: deep path 404s", () => {
  it("/api/events/x/y/z → 404 (no matching route pattern)", async () => {
    const res = await app.request("/api/events/x/y/z");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("/api/events/evt-1/cancel/extra → 404", async () => {
    const res = await app.request("/api/events/evt-1/cancel/extra");
    expect(res.status).toBe(404);
  });

  it("/api/events/evt-1/attendees/mem-1/extra → 404", async () => {
    const res = await app.request("/api/events/evt-1/attendees/mem-1/extra");
    expect(res.status).toBe(404);
  });
});

// ── 3. Security headers on events routes ─────────────────────────────────────

describe("/api/events: security headers", () => {
  it("GET /api/events has x-content-type-options: nosniff", async () => {
    const res = await app.request("/api/events");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("POST /api/events has application/json content-type", async () => {
    const res = await app.request("/api/events", { method: "POST" });
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("GET /api/events includes x-request-id for tracing", async () => {
    const res = await app.request("/api/events");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

// ── 4. /api/tasks — 401 without session ──────────────────────────────────────

describe("/api/tasks: 401 without session", () => {
  const protectedRoutes = [
    { method: "GET",    path: "/api/tasks" },
    { method: "POST",   path: "/api/tasks" },
    { method: "GET",    path: "/api/tasks/task-1" },
    { method: "PATCH",  path: "/api/tasks/task-1" },
    { method: "DELETE", path: "/api/tasks/task-1" },
  ];

  for (const { method, path } of protectedRoutes) {
    it(`${method} ${path} → 401`, async () => {
      const res = await app.request(path, { method });
      expect(res.status).toBe(401);
    });
  }
});

describe("/api/tasks: deep path 404s", () => {
  it("/api/tasks/x/y/z → 404", async () => {
    const res = await app.request("/api/tasks/x/y/z");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});

// ── 5. /api/contacts — 401 without session ───────────────────────────────────

describe("/api/contacts: 401 without session", () => {
  const protectedRoutes = [
    { method: "GET",    path: "/api/contacts" },
    { method: "POST",   path: "/api/contacts" },
    { method: "GET",    path: "/api/contacts/con-1" },
    { method: "PATCH",  path: "/api/contacts/con-1" },
    { method: "DELETE", path: "/api/contacts/con-1" },
  ];

  for (const { method, path } of protectedRoutes) {
    it(`${method} ${path} → 401`, async () => {
      const res = await app.request(path, { method });
      expect(res.status).toBe(401);
    });
  }
});

describe("/api/contacts: deep path 404s", () => {
  it("/api/contacts/x/y/z → 404", async () => {
    const res = await app.request("/api/contacts/x/y/z");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});

// ── 6. Security headers on tasks and contacts ─────────────────────────────────

describe("/api/tasks and /api/contacts: security headers", () => {
  it("GET /api/tasks has x-content-type-options: nosniff (even on 401)", async () => {
    const res = await app.request("/api/tasks");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("GET /api/contacts has x-content-type-options: nosniff (even on 401)", async () => {
    const res = await app.request("/api/contacts");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
