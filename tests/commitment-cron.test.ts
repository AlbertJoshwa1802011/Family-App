/**
 * The daily commitment sweep.
 *
 * This is what makes reminders work without opening the app, so the tests
 * drive runCommitmentReminders directly with a fixed clock.
 */
import { describe, expect, it } from "vitest";
import { runCommitmentReminders } from "../worker/lib/finance/commitmentCron";
import { createTestEnv, seedActor, seedFamily, seedUser } from "./helpers/testEnv";
import type { DatabaseSync } from "node:sqlite";

const AUG_5 = Date.UTC(2026, 7, 5);
const AUG_3 = Date.UTC(2026, 7, 3);
const JUL_1 = Date.UTC(2026, 6, 1);

function setup() {
  const { env, sqlite } = createTestEnv();
  const ownerUser = seedUser(sqlite);
  const family = seedFamily(sqlite, ownerUser.id);
  const alice = seedActor(sqlite, family.id, "member", { email: "alice@example.com" });
  return { env, sqlite, familyId: family.id, alice };
}

function insertCommitment(
  sqlite: DatabaseSync,
  familyId: string,
  ownerUserId: string,
  over: Record<string, unknown> = {},
): string {
  const id = crypto.randomUUID();
  const v = {
    kind: "emi",
    name: "Car loan",
    amount_kind: "fixed",
    amount_minor: 1200_00,
    currency: "USD",
    cadence: "monthly",
    day_of_month: 5,
    start_date: "2026-01-05",
    end_date: null,
    total_installments: 60,
    auto_log: 0,
    remind_days_before: 3,
    status: "active",
    visibility: "private",
    ...over,
  };
  sqlite
    .prepare(
      `INSERT INTO commitments
       (id, family_id, owner_user_id, kind, name, amount_kind, amount_minor, currency,
        cadence, day_of_month, start_date, end_date, total_installments, auto_log,
        remind_days_before, status, visibility)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id, familyId, ownerUserId, v.kind, v.name, v.amount_kind, v.amount_minor,
      v.currency, v.cadence, v.day_of_month, v.start_date, v.end_date,
      v.total_installments, v.auto_log, v.remind_days_before, v.status, v.visibility,
    );
  return id;
}

function rows(sqlite: DatabaseSync, sql: string): Record<string, unknown>[] {
  return sqlite.prepare(sql).all() as Record<string, unknown>[];
}

describe("commitment cron", () => {
  it("materialises upcoming periods for an active commitment", async () => {
    const { env, sqlite, familyId, alice } = setup();
    insertCommitment(sqlite, familyId, alice.userId);

    const stats = await runCommitmentReminders(env, AUG_5);
    expect(stats.commitmentsScanned).toBe(1);
    expect(stats.periodsCreated).toBeGreaterThan(0);

    const periods = rows(sqlite, "SELECT * FROM commitment_payments");
    expect(periods.length).toBeGreaterThan(0);
    expect(periods.some((p) => p.period_key === "2026-08")).toBe(true);
  });

  it("is idempotent — a second run creates no duplicates", async () => {
    const { env, sqlite, familyId, alice } = setup();
    insertCommitment(sqlite, familyId, alice.userId);

    await runCommitmentReminders(env, AUG_5);
    const afterFirst = rows(sqlite, "SELECT * FROM commitment_payments").length;
    const second = await runCommitmentReminders(env, AUG_5);

    expect(second.periodsCreated).toBe(0);
    expect(rows(sqlite, "SELECT * FROM commitment_payments")).toHaveLength(afterFirst);
  });

  it("notifies the owner inside the lead-time window, once", async () => {
    const { env, sqlite, familyId, alice } = setup();
    insertCommitment(sqlite, familyId, alice.userId);

    // Aug 3 is 2 days before the Aug 5 due date, inside remind_days_before=3.
    const first = await runCommitmentReminders(env, AUG_3);
    expect(first.remindersSent).toBe(1);

    const notes = rows(sqlite, "SELECT * FROM notifications");
    expect(notes).toHaveLength(1);
    expect(String(notes[0].title)).toContain("Car loan");

    // Re-running the same day must not notify again.
    const second = await runCommitmentReminders(env, AUG_3);
    expect(second.remindersSent).toBe(0);
    expect(rows(sqlite, "SELECT * FROM notifications")).toHaveLength(1);
  });

  it("does not notify outside the lead-time window", async () => {
    const { env, sqlite, familyId, alice } = setup();
    insertCommitment(sqlite, familyId, alice.userId, { remind_days_before: 1 });
    // Aug 3 is 2 days out, but the window is 1 day.
    const stats = await runCommitmentReminders(env, AUG_3);
    expect(stats.remindersSent).toBe(0);
  });

  it("auto-logs the expense on the due date when configured", async () => {
    const { env, sqlite, familyId, alice } = setup();
    insertCommitment(sqlite, familyId, alice.userId, { auto_log: 1 });

    const stats = await runCommitmentReminders(env, AUG_5);
    expect(stats.expensesLogged).toBeGreaterThan(0);

    const expenses = rows(sqlite, "SELECT * FROM expenses");
    expect(expenses.length).toBeGreaterThan(0);
    const aug = expenses.find((e) => e.expense_date === "2026-08-05");
    expect(aug).toBeDefined();
    expect(aug!.amount_minor).toBe(120000);
    expect(aug!.created_by_user_id).toBe(alice.userId);

    // And it's linked to the period, so the overview can exclude it.
    const linked = rows(
      sqlite,
      "SELECT * FROM commitment_payments WHERE expense_id IS NOT NULL",
    );
    expect(linked.length).toBeGreaterThan(0);
  });

  it("does not auto-log twice across runs", async () => {
    const { env, sqlite, familyId, alice } = setup();
    insertCommitment(sqlite, familyId, alice.userId, { auto_log: 1 });

    await runCommitmentReminders(env, AUG_5);
    const first = rows(sqlite, "SELECT * FROM expenses").length;
    await runCommitmentReminders(env, AUG_5);
    expect(rows(sqlite, "SELECT * FROM expenses")).toHaveLength(first);
  });

  it("does not auto-log before the due date", async () => {
    const { env, sqlite, familyId, alice } = setup();
    insertCommitment(sqlite, familyId, alice.userId, { auto_log: 1 });
    await runCommitmentReminders(env, JUL_1); // before the July 5 due date
    const july = rows(sqlite, "SELECT * FROM expenses WHERE expense_date = '2026-07-05'");
    expect(july).toHaveLength(0);
  });

  it("skips paused commitments entirely", async () => {
    const { env, sqlite, familyId, alice } = setup();
    insertCommitment(sqlite, familyId, alice.userId, { status: "paused", auto_log: 1 });
    const stats = await runCommitmentReminders(env, AUG_5);
    expect(stats.commitmentsScanned).toBe(0);
    expect(rows(sqlite, "SELECT * FROM commitment_payments")).toHaveLength(0);
  });

  it("stops at the end of a fixed term", async () => {
    const { env, sqlite, familyId, alice } = setup();
    // 3 installments from Jan → last is 2026-03-05, long past by August.
    insertCommitment(sqlite, familyId, alice.userId, { total_installments: 3 });
    await runCommitmentReminders(env, AUG_5);
    expect(rows(sqlite, "SELECT * FROM commitment_payments")).toHaveLength(0);
  });

  it("reminds for a percentage commitment without auto-logging it", async () => {
    const { env, sqlite, familyId, alice } = setup();
    insertCommitment(sqlite, familyId, alice.userId, {
      kind: "giving",
      name: "Tithe",
      amount_kind: "percent_of_income",
      amount_minor: null,
      auto_log: 1,
      total_installments: null,
    });

    const stats = await runCommitmentReminders(env, AUG_3);
    expect(stats.remindersSent).toBe(1);
    // The amount depends on the cycle's income, so the cron must not guess it.
    expect(stats.expensesLogged).toBe(0);
  });

  it("does not remind for a period already marked paid", async () => {
    const { env, sqlite, familyId, alice } = setup();
    const id = insertCommitment(sqlite, familyId, alice.userId);
    sqlite
      .prepare(
        `INSERT INTO commitment_payments (id, commitment_id, period_key, due_date, amount_minor, currency, paid)
         VALUES (?,?,?,?,?,?,1)`,
      )
      .run(crypto.randomUUID(), id, "2026-08", "2026-08-05", 120000, "USD");

    const stats = await runCommitmentReminders(env, AUG_3);
    expect(stats.remindersSent).toBe(0);
  });
});
