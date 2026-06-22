/**
 * Contract tests for /api/messages (family chat). No D1 binding in unit tests,
 * so we assert auth gating, routing, validation-order and headers — matching
 * the style of events.test.ts / occasions.test.ts.
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";

describe("/api/messages: 401 without session", () => {
  const routes = [
    { method: "GET", path: "/api/messages?familyId=fam-1" },
    { method: "POST", path: "/api/messages" },
  ];
  for (const { method, path } of routes) {
    it(`${method} ${path} → 401`, async () => {
      const res = await app.request(path, { method });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("unauthorized");
    });
  }
});

describe("/api/messages: routing + headers", () => {
  it("deep path → 404 not_found", async () => {
    const res = await app.request("/api/messages/x/y");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("returns JSON + nosniff", async () => {
    const res = await app.request("/api/messages?familyId=fam-1");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
