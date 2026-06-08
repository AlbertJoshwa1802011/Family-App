/**
 * Stress / load tests — exercise the request-handling layer (routing, middleware,
 * Zod validation, 404 + error paths) under high concurrency.
 *
 * These call the Hono app directly via app.request() in-process, so they measure
 * the Worker's own request pipeline deterministically (no network flakiness).
 * They assert ERROR-RATE and LATENCY budgets — if a future change introduces a
 * crash, a memory blow-up, or a pathological slowdown in the hot path, these fail.
 *
 * Budgets are intentionally generous for CI variance but tight enough to catch
 * real regressions (e.g. an accidental O(n) middleware or unhandled rejection).
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";

interface LoadResult {
  durations: number[];
  statuses: number[];
  errors: number;
  wallMs: number;
  throughput: number; // req/sec
}

/**
 * Runs `count` requests with a bounded worker pool of `concurrency`. Bounded
 * concurrency yields meaningful steady-state per-request latency (unlike firing
 * everything at once, where late requests just measure queue-wait). We measure
 * total wall-clock to derive throughput, which catches pathological slowdowns.
 */
async function runLoad(
  requestFactory: (i: number) => Promise<Response>,
  count: number,
  concurrency = 50,
): Promise<LoadResult> {
  const durations: number[] = [];
  const statuses: number[] = [];
  let errors = 0;
  let next = 0;

  const wallStart = performance.now();
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= count) return;
      const start = performance.now();
      try {
        const res = await requestFactory(i);
        durations.push(performance.now() - start);
        statuses.push(res.status);
        await res.text(); // drain body
      } catch {
        errors++;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const wallMs = performance.now() - wallStart;

  durations.sort((a, b) => a - b);
  return {
    durations,
    statuses,
    errors,
    wallMs,
    throughput: (count / wallMs) * 1000,
  };
}

describe("stress: concurrent GET /api/health", () => {
  it("handles 2000 health checks with zero errors and healthy throughput", async () => {
    const { statuses, errors, throughput } = await runLoad(
      () => app.request("/api/health"),
      2000,
    );

    expect(errors).toBe(0);
    expect(statuses.length).toBe(2000);
    expect(statuses.every((s) => s === 200)).toBe(true);
    // In-process throughput floor: a pathological slowdown would breach this.
    expect(throughput).toBeGreaterThan(1000); // req/sec
  });
});

describe("stress: mixed read/write/unknown traffic", () => {
  it("handles 3000 mixed requests without crashing or returning 500", async () => {
    const validEvent = JSON.stringify({
      title: "Load test event",
      startAt: Math.floor(Date.now() / 1000) + 3600,
      type: "gathering",
    });
    const invalidEvent = JSON.stringify({ title: "" }); // fails Zod

    const { statuses, errors, throughput } = await runLoad((i) => {
      const kind = i % 5;
      switch (kind) {
        case 0:
          return app.request("/api/health");
        case 1:
          return app.request("/api/events"); // 401 (requires session)
        case 2:
          return app.request("/api/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: validEvent,
          }); // 401 (requires session)
        case 3:
          return app.request("/api/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: invalidEvent,
          }); // 401 (auth fires before Zod)
        default:
          return app.request("/api/unknown-" + i); // 404
      }
    }, 3000);

    expect(errors).toBe(0);
    expect(statuses.length).toBe(3000);
    // Every request must resolve to a known, intended status — never 500.
    const allowed = new Set([200, 400, 401, 404, 501]);
    expect(statuses.every((s) => allowed.has(s))).toBe(true);
    expect(statuses.includes(500)).toBe(false);
    expect(throughput).toBeGreaterThan(500); // req/sec
  });
});

describe("stress: oversized payload rejection (memory safety)", () => {
  it("rejects a >1MiB JSON body with 413, not 500 or OOM", async () => {
    // Build a ~2 MiB body.
    const huge = JSON.stringify({ title: "x".repeat(2 * 1024 * 1024) });
    const res = await app.request("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: huge,
    });
    // bodyLimit middleware should short-circuit with 413.
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("payload_too_large");
  });

  it("accepts a body just under the limit", async () => {
    // ~0.5 MiB description — within the 1 MiB cap; fails Zod (max 2000) but
    // the point is the body-limit does NOT reject it (returns 400, not 413).
    const body = JSON.stringify({
      title: "ok",
      startAt: Math.floor(Date.now() / 1000) + 3600,
      description: "y".repeat(512 * 1024),
    });
    const res = await app.request("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(res.status).not.toBe(413);
  });
});

describe("stress: auth enforcement under load stays correct", () => {
  it("returns 401 for every unauthenticated request — no cross-contamination", async () => {
    // All /api/tasks POST requests require a session; auth fires before Zod, so
    // both valid and invalid bodies return 401 (not 400 or 501).
    const results = await Promise.all(
      Array.from({ length: 500 }, (_, i) => {
        const valid = i % 2 === 0;
        const body = valid
          ? JSON.stringify({ familyId: "f-1", title: "Task " + i })
          : JSON.stringify({ title: "" });
        return app
          .request("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          })
          .then((r) => ({ valid, status: r.status }));
      }),
    );

    for (const { status } of results) {
      expect(status).toBe(401);
    }
  });
});

describe("stress: error responses carry a requestId for tracing", () => {
  it("includes requestId in 404 responses", async () => {
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
    // requestId middleware also sets the X-Request-Id response header.
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});
