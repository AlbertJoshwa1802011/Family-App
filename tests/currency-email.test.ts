/**
 * Integration: test-email delivery gate + family currency PATCH.
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { createTestEnv, seedActor, seedFamily, seedUser } from "./helpers/testEnv";
import type { Env } from "../worker/types";

const ORIGIN = "http://localhost:5173";

function req(env: Env, method: string, path: string, cookie: string, body?: unknown) {
  return app.request(
    path,
    {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: ORIGIN },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

describe("POST /api/notifications/test-email", () => {
  it("returns 503 when RESEND_API_KEY is missing", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "member");

    const res = await req(env, "POST", "/api/notifications/test-email", alice.cookie);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("email_not_configured");
  });
});

describe("PATCH /api/families/:id currency", () => {
  it("updates defaultCurrency to USD", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    // Seed family starts as USD; flip to INR then back to prove the write path.
    sqlite
      .prepare("UPDATE families SET default_currency = ? WHERE id = ?")
      .run("INR", family.id);
    const alice = seedActor(sqlite, family.id, "member");

    const bad = await req(env, "PATCH", `/api/families/${family.id}`, alice.cookie, {
      defaultCurrency: "XYZ",
    });
    expect(bad.status).toBe(400);
    const badBody = (await bad.json()) as { error: string };
    expect(badBody.error).toBe("validation_error");

    const res = await req(env, "PATCH", `/api/families/${family.id}`, alice.cookie, {
      defaultCurrency: "USD",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { family: { defaultCurrency: string } };
    expect(body.family.defaultCurrency).toBe("USD");

    const get = await req(env, "GET", `/api/families/${family.id}`, alice.cookie);
    const got = (await get.json()) as { family: { defaultCurrency: string } };
    expect(got.family.defaultCurrency).toBe("USD");
  });

  it("rejects empty body", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "member");

    const res = await req(env, "PATCH", `/api/families/${family.id}`, alice.cookie, {});
    expect(res.status).toBe(400);
  });

  it("relabelExisting rewrites money row labels without converting amounts", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    const alice = seedActor(sqlite, family.id, "member");

    // Seed a USD commitment + expense while family default is still USD.
    const commitmentId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO commitments (
          id, family_id, owner_user_id, kind, name, amount_kind, amount_minor,
          currency, cadence, day_of_month, start_date, auto_log, remind_days_before,
          status, visibility
        ) VALUES (?, ?, ?, 'emi', 'Car', 'fixed', 500000, 'USD', 'monthly', 1, '2026-01-01', 0, 3, 'active', 'private')`,
      )
      .run(commitmentId, family.id, alice.userId);
    const expenseId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO expenses (
          id, family_id, paid_by_member_id, amount_minor, currency, expense_date,
          merchant, visibility, created_by_user_id, split_type, status
        ) VALUES (?, ?, ?, 120000, 'USD', '2026-01-15', 'Shop', 'private', ?, 'none', 'active')`,
      )
      .run(expenseId, family.id, alice.memberId, alice.userId);

    const res = await req(env, "PATCH", `/api/families/${family.id}`, alice.cookie, {
      defaultCurrency: "INR",
      relabelExisting: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      family: { defaultCurrency: string };
      relabeled: { commitments: number; expenses: number };
    };
    expect(body.family.defaultCurrency).toBe("INR");
    expect(body.relabeled.commitments).toBeGreaterThanOrEqual(1);
    expect(body.relabeled.expenses).toBeGreaterThanOrEqual(1);

    const commitment = sqlite
      .prepare("SELECT currency, amount_minor FROM commitments WHERE id = ?")
      .get(commitmentId) as { currency: string; amount_minor: number };
    expect(commitment.currency).toBe("INR");
    expect(commitment.amount_minor).toBe(500000);

    const expense = sqlite
      .prepare("SELECT currency, amount_minor FROM expenses WHERE id = ?")
      .get(expenseId) as { currency: string; amount_minor: number };
    expect(expense.currency).toBe("INR");
    expect(expense.amount_minor).toBe(120000);
  });
});

describe("POST /api/families/:id/relabel-currency", () => {
  it("fixes USD commitments after the family default is already INR", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    sqlite
      .prepare("UPDATE families SET default_currency = ? WHERE id = ?")
      .run("INR", family.id);
    const alice = seedActor(sqlite, family.id, "member");

    const commitmentId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO commitments (
          id, family_id, owner_user_id, kind, name, amount_kind, amount_minor,
          currency, cadence, day_of_month, start_date, auto_log, remind_days_before,
          status, visibility
        ) VALUES (?, ?, ?, 'rent', 'Home', 'fixed', 2500000, 'USD', 'monthly', 1, '2026-01-01', 0, 3, 'active', 'private')`,
      )
      .run(commitmentId, family.id, alice.userId);

    const badTo = await req(env, "POST", `/api/families/${family.id}/relabel-currency`, alice.cookie, {
      from: "USD",
      to: "EUR",
    });
    expect(badTo.status).toBe(400);

    const res = await req(env, "POST", `/api/families/${family.id}/relabel-currency`, alice.cookie, {
      from: "USD",
      to: "INR",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; to: string };
    expect(body.to).toBe("INR");
    expect(body.total).toBeGreaterThanOrEqual(1);

    const row = sqlite
      .prepare("SELECT currency FROM commitments WHERE id = ?")
      .get(commitmentId) as { currency: string };
    expect(row.currency).toBe("INR");
  });

  it("surfaces mismatched currencies on GET /finance/settings", async () => {
    const { env, sqlite } = createTestEnv();
    const owner = seedUser(sqlite);
    const family = seedFamily(sqlite, owner.id);
    sqlite
      .prepare("UPDATE families SET default_currency = ? WHERE id = ?")
      .run("INR", family.id);
    const alice = seedActor(sqlite, family.id, "member");

    sqlite
      .prepare(
        `INSERT INTO commitments (
          id, family_id, owner_user_id, kind, name, amount_kind, amount_minor,
          currency, cadence, day_of_month, start_date, auto_log, remind_days_before,
          status, visibility
        ) VALUES (?, ?, ?, 'emi', 'Bike', 'fixed', 100000, 'USD', 'monthly', 1, '2026-01-01', 0, 3, 'active', 'private')`,
      )
      .run(crypto.randomUUID(), family.id, alice.userId);

    const res = await req(
      env,
      "GET",
      `/api/finance/settings?familyId=${family.id}`,
      alice.cookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      currency: string;
      otherCurrenciesInUse: string[];
    };
    expect(body.currency).toBe("INR");
    expect(body.otherCurrenciesInUse).toContain("USD");
  });
});
