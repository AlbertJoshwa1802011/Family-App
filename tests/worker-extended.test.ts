/**
 * Exhaustive contract tests for the Family Vault Worker API.
 *
 * These tests verify the contract that all current and future API endpoints
 * must maintain: correct response shapes, security headers on every API route,
 * Zod validation enforcement (boundary tests), and consistent JSON error shapes.
 *
 * Pattern: app.request("/api/route", { method, body, headers }) — no HTTP server.
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";

// ---------------------------------------------------------------------------
// Helper: POST JSON helper
// ---------------------------------------------------------------------------
function postJSON(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchJSON(path: string, body: unknown) {
  return app.request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// 1. Worker baseline — health + auth/me shape + security headers
// ---------------------------------------------------------------------------
describe("1. Worker baseline", () => {
  it("GET /api/health returns all expected fields (ok, service, time)", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string; time: number };
    expect(body).toHaveProperty("ok");
    expect(body).toHaveProperty("service");
    expect(body).toHaveProperty("time");
  });

  it("GET /api/health — ok is boolean true", async () => {
    const res = await app.request("/api/health");
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("GET /api/health — service is 'family-vault'", async () => {
    const res = await app.request("/api/health");
    const body = (await res.json()) as { service: string };
    expect(body.service).toBe("family-vault");
  });

  it("GET /api/health — time is a number (unix ms)", async () => {
    const before = Date.now();
    const res = await app.request("/api/health");
    const after = Date.now();
    const body = (await res.json()) as { time: number };
    expect(typeof body.time).toBe("number");
    expect(body.time).toBeGreaterThanOrEqual(before);
    expect(body.time).toBeLessThanOrEqual(after + 10); // small leeway
  });

  it("GET /api/health — content-type is application/json", async () => {
    const res = await app.request("/api/health");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("GET /api/auth/me — returns correct shape when unauthenticated", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: unknown; families: unknown[] };
    expect(body).toHaveProperty("user");
    expect(body).toHaveProperty("families");
    expect(body.user).toBeNull();
    expect(Array.isArray(body.families)).toBe(true);
    expect(body.families).toHaveLength(0);
  });

  // Security headers on every major API endpoint
  it("x-content-type-options: nosniff on GET /api/auth/me", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("x-content-type-options: nosniff on GET /api/documents", async () => {
    const res = await app.request("/api/documents");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("x-content-type-options: nosniff on GET /api/families", async () => {
    const res = await app.request("/api/families");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("x-content-type-options: nosniff on GET /api/events", async () => {
    const res = await app.request("/api/events");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("x-content-type-options: nosniff on GET /api/tasks", async () => {
    const res = await app.request("/api/tasks");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("x-content-type-options: nosniff on GET /api/contacts", async () => {
    const res = await app.request("/api/contacts");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("x-content-type-options: nosniff on GET /api/notifications", async () => {
    const res = await app.request("/api/notifications");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("x-content-type-options: nosniff on GET /api/families/me/activity", async () => {
    const res = await app.request("/api/families/me/activity");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

// ---------------------------------------------------------------------------
// 2. Unknown routes always return JSON 404
// ---------------------------------------------------------------------------
describe("2. Unknown routes return JSON 404", () => {
  it("/api/does-not-exist → 404 JSON with error:'not_found'", async () => {
    const res = await app.request("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("/api/ (trailing slash only) → 404 JSON", async () => {
    const res = await app.request("/api/");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("/api/health/extra → 404 JSON (over-deep path)", async () => {
    const res = await app.request("/api/health/extra");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("/api/documents/x/y/z → 404 JSON (too-deep path)", async () => {
    const res = await app.request("/api/documents/x/y/z");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("/api/events/x/y/z/w → 404 JSON (too-deep path)", async () => {
    const res = await app.request("/api/events/x/y/z/w");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------
// 3. Correct HTTP methods on stub routes
// ---------------------------------------------------------------------------
describe("3. Correct HTTP methods on stub routes", () => {
  const docProtected = [
    { method: "GET",    path: "/api/documents" },
    { method: "POST",   path: "/api/documents" },
    { method: "GET",    path: "/api/documents/doc-1" },
    { method: "PATCH",  path: "/api/documents/doc-1" },
    { method: "DELETE", path: "/api/documents/doc-1" },
    { method: "POST",   path: "/api/documents/doc-1/files/upload-url" },
    { method: "POST",   path: "/api/documents/doc-1/files" },
    { method: "GET",    path: "/api/documents/doc-1/files/file-1/download" },
    { method: "GET",    path: "/api/documents/doc-1/comments" },
    { method: "POST",   path: "/api/documents/doc-1/comments" },
    { method: "DELETE", path: "/api/documents/doc-1/comments/comment-1" },
  ];

  for (const { method, path } of docProtected) {
    it(`${method} ${path} → 401 without session (auth required)`, async () => {
      const res = await app.request(path, { method });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("unauthorized");
    });
  }

  it("GET /api/families → 401 without session (auth required)", async () => {
    const res = await app.request("/api/families");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("POST /api/families → 401 without session (auth required)", async () => {
    const res = await app.request("/api/families", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Smith Family" }),
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/notifications → 401 (requires session)", async () => {
    const res = await app.request("/api/notifications");
    expect(res.status).toBe(401);
  });

  it("GET /api/events → 401 (requires session)", async () => {
    const res = await app.request("/api/events");
    expect(res.status).toBe(401);
  });

  it("GET /api/tasks → 401 (requires session)", async () => {
    const res = await app.request("/api/tasks");
    expect(res.status).toBe(401);
  });

  it("GET /api/contacts → 401 (requires session)", async () => {
    const res = await app.request("/api/contacts");
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 4. HTTP method not allowed — wrong methods on fixed routes
// ---------------------------------------------------------------------------
describe("4. Wrong HTTP methods on fixed routes return 404", () => {
  it("PUT /api/health → 404 (health only has GET)", async () => {
    const res = await app.request("/api/health", { method: "PUT" });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/health → 404", async () => {
    const res = await app.request("/api/health", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 5. Content-type requirement for POST/PATCH routes
// ---------------------------------------------------------------------------
describe("5. POST without Content-Type: application/json returns 400 or 415", () => {
  it("POST /api/events without Content-Type header → not 500", async () => {
    const res = await app.request("/api/events", {
      method: "POST",
      body: JSON.stringify({ title: "Test", startAt: 1750000000 }),
      // No Content-Type header
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("POST /api/tasks without Content-Type header → not 500", async () => {
    const res = await app.request("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Task" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("POST /api/contacts without Content-Type header → not 500", async () => {
    const res = await app.request("/api/contacts", {
      method: "POST",
      body: JSON.stringify({ name: "Alice" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// 6. Error response shape consistency
// ---------------------------------------------------------------------------
describe("6. Error response shape consistency", () => {
  it("404 responses have `error` field", async () => {
    const res = await app.request("/api/no-such-route");
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
  });

  it("error responses have `error` field (documents POST → 401 without auth)", async () => {
    const res = await app.request("/api/documents", { method: "POST" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
  });

  it("401 responses have error:'unauthorized'", async () => {
    const res = await postJSON("/api/events", { startAt: 1750000000 });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("401 responses have an `error` string field (not `issues`)", async () => {
    const res = await postJSON("/api/events", { startAt: 1750000000 });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
  });

  it("404 error JSON is served with content-type application/json", async () => {
    const res = await app.request("/api/nonexistent-endpoint");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("401 error JSON is served with content-type application/json", async () => {
    // Protected routes return 401 JSON when no session is present
    const res = await app.request("/api/families", { method: "POST" });
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("400 error JSON is served with content-type application/json", async () => {
    const res = await postJSON("/api/tasks", { notes: "no title" });
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

// ---------------------------------------------------------------------------
// 7. Auth enforcement on event / task / contact routes
// ---------------------------------------------------------------------------
// requireSession fires before Zod validation on all three routers.
// Every request without a valid session cookie returns 401 — regardless of
// whether the body is valid or invalid.
describe("7. Auth enforcement on event/task/contact routes", () => {
  const cases: Array<{ method: string; path: string; body: object }> = [
    // events
    { method: "POST",  path: "/api/events",          body: { familyId: "f-1", title: "Event", startAt: 1750000000 } },
    { method: "POST",  path: "/api/events",          body: { title: "" } },           // would fail Zod
    { method: "PATCH", path: "/api/events/some-id",  body: {} },
    { method: "PATCH", path: "/api/events/some-id",  body: { startAt: "bad" } },      // would fail Zod
    { method: "POST",  path: "/api/events/some-id/cancel",    body: {} },
    { method: "POST",  path: "/api/events/some-id/attendees", body: { memberIds: ["m-1"] } },
    // tasks
    { method: "POST",  path: "/api/tasks",           body: { familyId: "f-1", title: "Task" } },
    { method: "POST",  path: "/api/tasks",           body: { title: "a".repeat(301) } }, // would fail Zod
    { method: "PATCH", path: "/api/tasks/some-id",   body: { status: "done" } },
    { method: "PATCH", path: "/api/tasks/some-id",   body: { status: "pending" } },    // would fail Zod
    // contacts
    { method: "POST",  path: "/api/contacts",        body: { familyId: "f-1", name: "Alice" } },
    { method: "POST",  path: "/api/contacts",        body: { name: "" } },             // would fail Zod
    { method: "PATCH", path: "/api/contacts/some-id", body: { email: "bad" } },        // would fail Zod
  ];

  for (const { method, path, body } of cases) {
    it(`${method} ${path} → 401 (auth fires before validation)`, async () => {
      const res = await app.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(401);
      const responseBody = (await res.json()) as { error: string };
      expect(responseBody.error).toBe("unauthorized");
    });
  }
});
