/**
 * E0 — schema smoke: expense tables exist after migrations; no API routes yet.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestEnv, type TestEnv } from "./helpers/testEnv";

let t: TestEnv;

beforeEach(() => {
  t = createTestEnv();
});

const EXPENSE_TABLES = [
  "expense_categories",
  "expenses",
  "expense_participants",
  "expense_tags",
  "expense_receipts",
  "settlements",
  "recurring_expenses",
  "recurring_expense_log",
] as const;

describe("E0 expense schema", () => {
  it("creates all expense tables via migrations", () => {
    const rows = t.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as { name: string }[];
    const names = new Set(rows.map((r) => r.name));
    for (const table of EXPENSE_TABLES) {
      expect(names.has(table), `missing table ${table}`).toBe(true);
    }
  });

  it("adds families.default_currency with USD default", () => {
    const cols = t.sqlite
      .prepare("PRAGMA table_info(families)")
      .all() as { name: string; dflt_value: string | null }[];
    const currency = cols.find((c) => c.name === "default_currency");
    expect(currency).toBeTruthy();
    expect(currency?.dflt_value).toContain("USD");
  });

  it("allows inserting a personal expense row (schema reachable, no API)", () => {
    const userId = crypto.randomUUID();
    const familyId = crypto.randomUUID();
    const memberId = crypto.randomUUID();
    const expenseId = crypto.randomUUID();

    t.sqlite
      .prepare(
        "INSERT INTO users (id, google_sub, email, name) VALUES (?, ?, ?, ?)",
      )
      .run(userId, `sub-${userId}`, "e0@example.com", "E0");
    t.sqlite
      .prepare(
        "INSERT INTO families (id, name, owner_user_id) VALUES (?, ?, ?)",
      )
      .run(familyId, "E0 Family", userId);
    t.sqlite
      .prepare(
        `INSERT INTO family_members (id, family_id, user_id, member_type, role, status)
         VALUES (?, ?, ?, 'user', 'owner', 'active')`,
      )
      .run(memberId, familyId, userId);
    t.sqlite
      .prepare(
        `INSERT INTO expenses (
           id, family_id, paid_by_member_id, amount_minor, currency, expense_date,
           split_type, visibility, status, created_by_user_id
         ) VALUES (?, ?, ?, 500, 'USD', '2026-08-01', 'none', 'private', 'active', ?)`,
      )
      .run(expenseId, familyId, memberId, userId);

    const row = t.sqlite
      .prepare("SELECT amount_minor, split_type FROM expenses WHERE id = ?")
      .get(expenseId) as { amount_minor: number; split_type: string };
    expect(row.amount_minor).toBe(500);
    expect(row.split_type).toBe("none");
  });
});
