/**
 * API-wide contract matrix.
 *
 * For every route in tests/catalog/routes.ts we record:
 *  - unauthenticated status (401 vs public)
 *  - nosniff + request-id
 *  - never HTML for /api/*
 *  - mutation with a broken JSON body does not 500
 *  - an over-deep path under the module is JSON 404
 */
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOG_ROUTES } from "./routes";
import { catalogReq, createTestEnv, seedFamilySession } from "./helpers";

describe("catalog: API contract matrix", () => {
  let env: ReturnType<typeof createTestEnv>["env"];
  let cookie: string;

  beforeAll(() => {
    const seeded = seedFamilySession();
    env = seeded.env;
    cookie = seeded.actor.cookie;
  });

  it.each(CATALOG_ROUTES.filter((r) => r.auth === "required"))(
    "$method $path without a session → 401 unauthorized",
    async (route) => {
      const res = await catalogReq(env, route.method, route.path, {
        body: route.mutation ? {} : undefined,
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("unauthorized");
    },
  );

  it.each(CATALOG_ROUTES)(
    "$method $path sets x-content-type-options: nosniff",
    async (route) => {
      const res = await catalogReq(env, route.method, route.path, {
        body: route.mutation ? {} : undefined,
      });
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    },
  );

  it.each(CATALOG_ROUTES)(
    "$method $path sets x-request-id",
    async (route) => {
      const res = await catalogReq(env, route.method, route.path, {
        body: route.mutation ? {} : undefined,
      });
      expect(res.headers.get("x-request-id")).toBeTruthy();
    },
  );

  it.each(CATALOG_ROUTES)(
    "$method $path does not return HTML",
    async (route) => {
      const res = await catalogReq(env, route.method, route.path, {
        body: route.mutation ? {} : undefined,
      });
      const ct = res.headers.get("content-type") ?? "";
      expect(ct.includes("text/html")).toBe(false);
    },
  );

  it.each(CATALOG_ROUTES.filter((r) => r.mutation && r.auth === "required"))(
    "$method $path broken JSON does not 500",
    async (route) => {
      const res = await catalogReq(env, route.method, route.path, {
        cookie,
        rawBody: "{",
      });
      // Some handlers ignore the body (200), return 501/503 for unset deps,
      // or 400 on parse — none of those should crash into a 500.
      expect(res.status).not.toBe(500);
      const ct = res.headers.get("content-type") ?? "";
      expect(ct.includes("text/html")).toBe(false);
    },
  );

  const modules = [...new Set(CATALOG_ROUTES.map((r) => r.module))];
  it.each(modules)("GET /api/%s/x/y/z/q → JSON (not HTML)", async (mod) => {
    const res = await catalogReq(env, "GET", `/api/${mod}/x/y/z/q`);
    // Admin mounts requirePlatformAdmin on '*', so unauth is 401 before 404.
    expect([401, 404]).toContain(res.status);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { error: string };
    expect(["not_found", "unauthorized"]).toContain(body.error);
  });
});
