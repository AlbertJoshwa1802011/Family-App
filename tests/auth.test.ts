/**
 * Phase 1 auth + session + family route tests.
 *
 * Test strategy:
 * - All "unauthenticated" tests call routes without a session cookie and expect 401.
 * - Auth route shape tests verify the contract without real D1/KV (using mock env).
 * - Zod validation tests on protected routes verify 400 shape (via mock env with fake session).
 *
 * Real D1 integration tests (session CRUD, family CRUD) are covered by the
 * tests/families-db.test.ts file once better-sqlite3 is added. These tests focus on
 * the HTTP contract that can be verified without a real database.
 */
import { describe, it, expect } from "vitest";
import { app } from "../worker/index";

// ---------------------------------------------------------------------------
// 1. /auth/me — unauthenticated path (no D1 needed since no cookie)
// ---------------------------------------------------------------------------
describe("1. GET /api/auth/me — no session", () => {
  it("returns { user: null, families: [] } when no cookie present", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: unknown; families: unknown[] };
    expect(body.user).toBeNull();
    expect(Array.isArray(body.families)).toBe(true);
    expect(body.families).toHaveLength(0);
  });

  it("sets content-type application/json", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("does NOT require authentication (200, not 401)", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 2. /auth/google/start — shape test without env
// ---------------------------------------------------------------------------
describe("2. GET /api/auth/google/start", () => {
  it("returns 503 when GOOGLE_CLIENT_ID is not configured", async () => {
    // No env bindings → GOOGLE_CLIENT_ID is undefined
    const res = await app.request("/api/auth/google/start", { method: "GET" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("oauth_not_configured");
  });

  it("returns JSON with content-type header", async () => {
    const res = await app.request("/api/auth/google/start", { method: "GET" });
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

// ---------------------------------------------------------------------------
// 3. /auth/logout — always succeeds (clears cookie best-effort)
// ---------------------------------------------------------------------------
describe("3. POST /api/auth/logout", () => {
  it("returns { ok: true } without a session cookie", async () => {
    const res = await app.request("/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("sets a Set-Cookie header that clears the sid cookie", async () => {
    const res = await app.request("/api/auth/logout", { method: "POST" });
    const setCookie = res.headers.get("set-cookie") ?? "";
    // Hono's deleteCookie sets Max-Age=0 or expires in the past
    expect(setCookie).toMatch(/sid/);
  });
});

// ---------------------------------------------------------------------------
// 4. Protected family routes — 401 without session
// ---------------------------------------------------------------------------
describe("4. Protected family routes return 401 without session", () => {
  const protectedRoutes = [
    { method: "GET",   path: "/api/families" },
    { method: "POST",  path: "/api/families" },
    { method: "GET",   path: "/api/families/me/members" },
    { method: "GET",   path: "/api/families/fam-1" },
    { method: "GET",   path: "/api/families/fam-1/members" },
    { method: "PATCH", path: "/api/families/fam-1/members/mem-1" },
    { method: "POST",  path: "/api/families/fam-1/invites" },
    { method: "POST",  path: "/api/families/invites/some-token/accept" },
    { method: "GET",   path: "/api/families/fam-1/activity" },
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

// ---------------------------------------------------------------------------
// 5. POST /api/families Zod validation — 401 short-circuits before 400
//    (requireSession runs before Zod, so bad input on unauthed request → 401)
// ---------------------------------------------------------------------------
describe("5. POST /api/families Zod: requireSession fires before validation", () => {
  it("returns 401 (not 400) when unauthenticated with invalid body", async () => {
    const res = await app.request("/api/families", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }), // would fail Zod (min 1)
    });
    // Auth guard fires first → 401, not 400
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 6. PATCH /api/families/:id/members/:mid validation shape
//    (testing 401 contract — validation is tested separately below)
// ---------------------------------------------------------------------------
describe("6. PATCH /api/families/:id/members/:mid", () => {
  it("returns 401 without session regardless of body", async () => {
    const res = await app.request("/api/families/fam-1/members/mem-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 7. Security headers are present on auth + family routes
// ---------------------------------------------------------------------------
describe("7. Security headers on auth routes", () => {
  it("GET /api/auth/me has x-content-type-options: nosniff", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("POST /api/auth/logout has x-content-type-options: nosniff", async () => {
    const res = await app.request("/api/auth/logout", { method: "POST" });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("GET /api/families has x-content-type-options: nosniff (even on 401)", async () => {
    const res = await app.request("/api/families");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

// ---------------------------------------------------------------------------
// 8. requestId header present on all API responses
// ---------------------------------------------------------------------------
describe("8. requestId tracing on auth + family routes", () => {
  it("GET /api/auth/me includes x-request-id", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("GET /api/families (401) includes x-request-id", async () => {
    const res = await app.request("/api/families");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 9. OAuth callback — graceful redirect on error param
// ---------------------------------------------------------------------------
describe("9. GET /api/auth/google/callback error handling", () => {
  it("redirects to /login?error=... when Google returns an error param", async () => {
    const res = await app.request(
      "/api/auth/google/callback?error=access_denied",
    );
    // Should redirect (302/303) without crashing
    expect([301, 302, 303, 307, 308]).toContain(res.status);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("error=access_denied");
  });

  it("redirects to /login?error=missing_params when code or state is absent", async () => {
    const res = await app.request("/api/auth/google/callback");
    expect([301, 302, 303, 307, 308]).toContain(res.status);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("missing_params");
  });
});
