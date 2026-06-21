/**
 * Audit taxonomy + defaulting unit tests, and /api/activity contract tests.
 *
 * The audit defaulting logic is pure (no D1 needed): we pass a stub Db that captures
 * the inserted row. The /api/activity contract mirrors the auth-gated style in
 * events.test.ts (401 without session, security headers, deep-path 404).
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { ACTIONS, insertAuditEvent } from "../worker/lib/audit";
import type { Db } from "../worker/db/client";

// ── ACTIONS taxonomy ──────────────────────────────────────────────────────────

describe("audit ACTIONS taxonomy", () => {
  it("every action is dot-namespaced (domain.verb_pasttense)", () => {
    for (const value of Object.values(ACTIONS)) {
      expect(value).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it("has no duplicate action strings", () => {
    const values = Object.values(ACTIONS);
    expect(new Set(values).size).toBe(values.length);
  });
});

// ── severity / visibility defaulting (stub Db — no real D1 required) ───────────

function captureDb(): { db: Db; rows: Record<string, unknown>[] } {
  const rows: Record<string, unknown>[] = [];
  const db = {
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        rows.push(row);
      },
    }),
  } as unknown as Db;
  return { db, rows };
}

describe("insertAuditEvent defaulting", () => {
  it("auto-tags known security actions with severity=security", async () => {
    const { db, rows } = captureDb();
    await insertAuditEvent(db, { action: ACTIONS.SECRET_REVEALED });
    expect(rows[0].severity).toBe("security");
  });

  it("defaults ordinary actions to severity=info and visibility=family", async () => {
    const { db, rows } = captureDb();
    await insertAuditEvent(db, { action: ACTIONS.TASK_CREATED });
    expect(rows[0].severity).toBe("info");
    expect(rows[0].visibility).toBe("family");
  });

  it("honors explicit severity/visibility overrides", async () => {
    const { db, rows } = captureDb();
    await insertAuditEvent(db, {
      action: ACTIONS.DOCUMENT_VIEWED,
      severity: "security",
      visibility: "private",
    });
    expect(rows[0].severity).toBe("security");
    expect(rows[0].visibility).toBe("private");
  });

  it("serializes meta to a JSON string (or undefined when absent)", async () => {
    const { db, rows } = captureDb();
    await insertAuditEvent(db, {
      action: ACTIONS.FAMILY_CREATED,
      meta: { name: "X" },
    });
    await insertAuditEvent(db, { action: ACTIONS.FAMILY_CREATED });
    expect(rows[0].meta).toBe(JSON.stringify({ name: "X" }));
    expect(rows[1].meta).toBeUndefined();
  });
});

// ── /api/activity contract (mirrors events.test.ts) ───────────────────────────

describe("/api/activity: contract", () => {
  it("GET /api/activity/me → 401 without session", async () => {
    const res = await app.request("/api/activity/me");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("GET /api/activity/me has nosniff + x-request-id (even on 401)", async () => {
    const res = await app.request("/api/activity/me");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("deep path /api/activity/x/y/z → 404 not_found", async () => {
    const res = await app.request("/api/activity/x/y/z");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});
