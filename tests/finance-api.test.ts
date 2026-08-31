/**
 * Finance API — income, commitments, settings, overview.
 *
 * The privacy rule mirrors expenses: owned by its creator, private by default,
 * and no owner/admin bypass. These tests hold that line.
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

function setup() {
  const { env, sqlite } = createTestEnv();
  const ownerUser = seedUser(sqlite);
  const family = seedFamily(sqlite, ownerUser.id);
  const alice = seedActor(sqlite, family.id, "member", { name: "Alice" });
  const bob = seedActor(sqlite, family.id, "member", { name: "Bob" });
  const admin = seedActor(sqlite, family.id, "owner", { name: "Owner" });
  return { env, sqlite, familyId: family.id, alice, bob, admin };
}

const salary = (familyId: string) => ({
  familyId,
  label: "Salary",
  amountMinor: 8000_00,
  currency: "USD",
  cadence: "monthly",
  startDate: "2026-01-01",
});

const emi = (familyId: string) => ({
  familyId,
  kind: "emi",
  name: "Car loan",
  amountMinor: 1200_00,
  currency: "USD",
  cadence: "monthly",
  dayOfMonth: 5,
  startDate: "2026-01-05",
  totalInstallments: 60,
});

describe("finance: income", () => {
  it("creates income, private by default", async () => {
    const { env, familyId, alice } = setup();
    const res = await req(env, "POST", "/api/finance/incomes", alice.cookie, salary(familyId));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { income: { visibility: string; ownerUserId: string } };
    expect(body.income.visibility).toBe("private");
    expect(body.income.ownerUserId).toBe(alice.userId);
  });

  it("rejects a currency that isn't the family's", async () => {
    const { env, familyId, alice } = setup();
    const res = await req(env, "POST", "/api/finance/incomes", alice.cookie, {
      ...salary(familyId),
      currency: "EUR",
    });
    expect(res.status).toBe(400);
  });

  it("rejects an endDate before the startDate", async () => {
    const { env, familyId, alice } = setup();
    const res = await req(env, "POST", "/api/finance/incomes", alice.cookie, {
      ...salary(familyId),
      endDate: "2025-01-01",
    });
    expect(res.status).toBe(400);
  });

  it("hides private income from other members, owner included", async () => {
    const { env, familyId, alice, bob, admin } = setup();
    await req(env, "POST", "/api/finance/incomes", alice.cookie, salary(familyId));

    for (const actor of [bob, admin]) {
      const list = (await (
        await req(env, "GET", `/api/finance/incomes?familyId=${familyId}`, actor.cookie)
      ).json()) as { incomes: unknown[] };
      expect(list.incomes).toHaveLength(0);
    }
  });

  it("lets only the owner edit or delete", async () => {
    const { env, familyId, alice, bob } = setup();
    const created = (await (
      await req(env, "POST", "/api/finance/incomes", alice.cookie, {
        ...salary(familyId),
        visibility: "family",
      })
    ).json()) as { income: { id: string } };

    expect((await req(env, "PATCH", `/api/finance/incomes/${created.income.id}`, bob.cookie, { amountMinor: 1 })).status).toBe(403);
    expect((await req(env, "DELETE", `/api/finance/incomes/${created.income.id}`, bob.cookie)).status).toBe(403);
    expect((await req(env, "PATCH", `/api/finance/incomes/${created.income.id}`, alice.cookie, { amountMinor: 5000_00 })).status).toBe(200);
  });

  it("404s a private income for a non-owner rather than 403", async () => {
    const { env, familyId, alice, bob } = setup();
    const created = (await (
      await req(env, "POST", "/api/finance/incomes", alice.cookie, salary(familyId))
    ).json()) as { income: { id: string } };
    expect((await req(env, "PATCH", `/api/finance/incomes/${created.income.id}`, bob.cookie, { amountMinor: 1 })).status).toBe(404);
  });
});

describe("finance: commitments", () => {
  it("creates an EMI with a fixed term", async () => {
    const { env, familyId, alice } = setup();
    const res = await req(env, "POST", "/api/finance/commitments", alice.cookie, emi(familyId));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { commitment: { totalInstallments: number; kind: string } };
    expect(body.commitment.kind).toBe("emi");
    expect(body.commitment.totalInstallments).toBe(60);
  });

  it("accepts tithe as a percentage of income", async () => {
    const { env, familyId, alice } = setup();
    const res = await req(env, "POST", "/api/finance/commitments", alice.cookie, {
      familyId,
      kind: "giving",
      name: "Tithe",
      amountKind: "percent_of_income",
      percentBp: 1000,
      currency: "USD",
      cadence: "monthly",
      startDate: "2026-01-01",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { commitment: { percentBp: number; amountMinor: number | null } };
    expect(body.commitment.percentBp).toBe(1000);
    expect(body.commitment.amountMinor).toBeNull();
  });

  it("rejects a fixed commitment with no amount", async () => {
    const { env, familyId, alice } = setup();
    const res = await req(env, "POST", "/api/finance/commitments", alice.cookie, {
      familyId,
      kind: "insurance",
      name: "Policy",
      currency: "USD",
      cadence: "monthly",
      startDate: "2026-01-01",
    });
    expect(res.status).toBe(400);
  });

  it("rejects a percent commitment with no percentage", async () => {
    const { env, familyId, alice } = setup();
    const res = await req(env, "POST", "/api/finance/commitments", alice.cookie, {
      familyId,
      kind: "giving",
      name: "Tithe",
      amountKind: "percent_of_income",
      currency: "USD",
      cadence: "monthly",
      startDate: "2026-01-01",
    });
    expect(res.status).toBe(400);
  });

  it("filters by kind", async () => {
    const { env, familyId, alice } = setup();
    await req(env, "POST", "/api/finance/commitments", alice.cookie, emi(familyId));
    await req(env, "POST", "/api/finance/commitments", alice.cookie, {
      ...emi(familyId),
      kind: "insurance",
      name: "Health cover",
    });

    const list = (await (
      await req(env, "GET", `/api/finance/commitments?familyId=${familyId}&kind=emi`, alice.cookie)
    ).json()) as { commitments: { kind: string }[] };
    expect(list.commitments).toHaveLength(1);
    expect(list.commitments[0].kind).toBe("emi");
  });

  it("hides a private commitment from the family owner", async () => {
    const { env, familyId, alice, admin } = setup();
    await req(env, "POST", "/api/finance/commitments", alice.cookie, emi(familyId));
    const list = (await (
      await req(env, "GET", `/api/finance/commitments?familyId=${familyId}`, admin.cookie)
    ).json()) as { commitments: unknown[] };
    expect(list.commitments).toHaveLength(0);
  });

  it("records a payment idempotently", async () => {
    const { env, familyId, alice } = setup();
    const created = (await (
      await req(env, "POST", "/api/finance/commitments", alice.cookie, emi(familyId))
    ).json()) as { commitment: { id: string } };

    const payload = { periodKey: "2026-08", dueDate: "2026-08-05", amountMinor: 1200_00, logExpense: true };
    const first = await req(env, "POST", `/api/finance/commitments/${created.commitment.id}/pay`, alice.cookie, payload);
    expect(first.status).toBe(201);
    const second = await req(env, "POST", `/api/finance/commitments/${created.commitment.id}/pay`, alice.cookie, payload);
    expect(second.status).toBe(200);

    // The logged expense exists exactly once.
    const list = (await (
      await req(env, "GET", `/api/expenses?familyId=${familyId}`, alice.cookie)
    ).json()) as { expenses: unknown[] };
    expect(list.expenses).toHaveLength(1);
  });
});

describe("finance: settings", () => {
  it("defaults to no savings target and payday on the 1st", async () => {
    const { env, familyId, alice } = setup();
    const body = (await (
      await req(env, "GET", `/api/finance/settings?familyId=${familyId}`, alice.cookie)
    ).json()) as { settings: { savingsTargetKind: string; paydayDayOfMonth: number } };
    expect(body.settings.savingsTargetKind).toBe("none");
    expect(body.settings.paydayDayOfMonth).toBe(1);
  });

  it("saves and reads back a percentage target", async () => {
    const { env, familyId, alice } = setup();
    const put = await req(env, "PUT", "/api/finance/settings", alice.cookie, {
      familyId,
      savingsTargetKind: "percent",
      savingsTargetPercentBp: 2000,
      paydayDayOfMonth: 25,
    });
    expect(put.status).toBe(200);

    const body = (await (
      await req(env, "GET", `/api/finance/settings?familyId=${familyId}`, alice.cookie)
    ).json()) as { settings: { savingsTargetPercentBp: number; paydayDayOfMonth: number } };
    expect(body.settings.savingsTargetPercentBp).toBe(2000);
    expect(body.settings.paydayDayOfMonth).toBe(25);
  });

  it("rejects an amount target with no amount", async () => {
    const { env, familyId, alice } = setup();
    const res = await req(env, "PUT", "/api/finance/settings", alice.cookie, {
      familyId,
      savingsTargetKind: "amount",
      paydayDayOfMonth: 1,
    });
    expect(res.status).toBe(400);
  });

  it("keeps settings separate per member", async () => {
    const { env, familyId, alice, bob } = setup();
    await req(env, "PUT", "/api/finance/settings", alice.cookie, {
      familyId,
      savingsTargetKind: "amount",
      savingsTargetMinor: 500_00,
      paydayDayOfMonth: 10,
    });
    const bobs = (await (
      await req(env, "GET", `/api/finance/settings?familyId=${familyId}`, bob.cookie)
    ).json()) as { settings: { savingsTargetKind: string } };
    expect(bobs.settings.savingsTargetKind).toBe("none");
  });
});

describe("finance: overview", () => {
  async function seedPlan(env: Env, familyId: string, cookie: string) {
    await req(env, "POST", "/api/finance/incomes", cookie, salary(familyId));
    await req(env, "POST", "/api/finance/commitments", cookie, emi(familyId));
    await req(env, "POST", "/api/finance/commitments", cookie, {
      familyId,
      kind: "giving",
      name: "Tithe",
      amountKind: "percent_of_income",
      percentBp: 1000,
      currency: "USD",
      cadence: "monthly",
      dayOfMonth: 1,
      startDate: "2026-01-01",
    });
    await req(env, "PUT", "/api/finance/settings", cookie, {
      familyId,
      savingsTargetKind: "amount",
      savingsTargetMinor: 1000_00,
      paydayDayOfMonth: 1,
    });
  }

  it("computes the full plan for the cycle", async () => {
    const { env, familyId, alice } = setup();
    await seedPlan(env, familyId, alice.cookie);

    const body = (await (
      await req(env, "GET", `/api/finance/overview?familyId=${familyId}&date=2026-08-14`, alice.cookie)
    ).json()) as {
      plan: {
        incomeMinor: number;
        committedMinor: number;
        givingMinor: number;
        savingsTargetMinor: number;
        spendableMinor: number;
        status: string;
      };
      currency: string;
    };

    expect(body.currency).toBe("USD");
    expect(body.plan.incomeMinor).toBe(800000);
    expect(body.plan.givingMinor).toBe(80000); // 10% of income
    expect(body.plan.committedMinor).toBe(120000 + 80000);
    expect(body.plan.savingsTargetMinor).toBe(100000);
    expect(body.plan.spendableMinor).toBe(500000);
    expect(body.plan.status).toBe("on_track");
  });

  it("counts an expense against the plan", async () => {
    const { env, familyId, alice } = setup();
    await seedPlan(env, familyId, alice.cookie);
    await req(env, "POST", "/api/expenses", alice.cookie, {
      familyId,
      paidByMemberId: alice.memberId,
      amountMinor: 250_00,
      currency: "USD",
      expenseDate: "2026-08-10",
    });

    const body = (await (
      await req(env, "GET", `/api/finance/overview?familyId=${familyId}&date=2026-08-14`, alice.cookie)
    ).json()) as { plan: { spentMinor: number; remainingMinor: number } };

    expect(body.plan.spentMinor).toBe(25000);
    expect(body.plan.remainingMinor).toBe(500000 - 25000);
  });

  it("does not double count an auto-logged commitment expense", async () => {
    const { env, familyId, alice } = setup();
    await seedPlan(env, familyId, alice.cookie);

    const commitments = (await (
      await req(env, "GET", `/api/finance/commitments?familyId=${familyId}&kind=emi`, alice.cookie)
    ).json()) as { commitments: { id: string }[] };

    // Pay it, logging the expense — exactly what the cron does.
    await req(env, "POST", `/api/finance/commitments/${commitments.commitments[0].id}/pay`, alice.cookie, {
      periodKey: "2026-08",
      dueDate: "2026-08-05",
      amountMinor: 1200_00,
      logExpense: true,
    });

    const body = (await (
      await req(env, "GET", `/api/finance/overview?familyId=${familyId}&date=2026-08-14`, alice.cookie)
    ).json()) as { plan: { spentMinor: number; committedMinor: number } };

    // Counted once, as a commitment.
    expect(body.plan.committedMinor).toBe(200000);
    expect(body.plan.spentMinor).toBe(0);
  });

  it("excludes another member's private income from my overview", async () => {
    const { env, familyId, alice, bob } = setup();
    await req(env, "POST", "/api/finance/incomes", bob.cookie, salary(familyId));

    const body = (await (
      await req(env, "GET", `/api/finance/overview?familyId=${familyId}&date=2026-08-14`, alice.cookie)
    ).json()) as { plan: { incomeMinor: number } };
    expect(body.plan.incomeMinor).toBe(0);
  });

  it("returns a trend of the requested length", async () => {
    const { env, familyId, alice } = setup();
    await seedPlan(env, familyId, alice.cookie);
    const body = (await (
      await req(env, "GET", `/api/finance/overview?familyId=${familyId}&date=2026-08-14&months=3`, alice.cookie)
    ).json()) as { trend: { key: string }[] };
    expect(body.trend.map((t) => t.key)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("rejects a malformed date", async () => {
    const { env, familyId, alice } = setup();
    const res = await req(env, "GET", `/api/finance/overview?familyId=${familyId}&date=14-08-2026`, alice.cookie);
    expect(res.status).toBe(400);
  });

  it("hides the family from a non-member", async () => {
    const { env, familyId, sqlite } = setup();
    const other = seedFamily(sqlite, seedUser(sqlite).id, "Other");
    const outsider = seedActor(sqlite, other.id, "owner");
    const res = await req(env, "GET", `/api/finance/overview?familyId=${familyId}`, outsider.cookie);
    expect(res.status).toBe(404);
  });
});

describe("finance: auth", () => {
  const routes = [
    ["GET", "/api/finance/overview?familyId=f-1"],
    ["GET", "/api/finance/settings?familyId=f-1"],
    ["PUT", "/api/finance/settings"],
    ["GET", "/api/finance/incomes?familyId=f-1"],
    ["POST", "/api/finance/incomes"],
    ["GET", "/api/finance/commitments?familyId=f-1"],
    ["POST", "/api/finance/commitments"],
    ["GET", "/api/wishlist?familyId=f-1"],
    ["POST", "/api/wishlist"],
  ] as const;

  for (const [method, path] of routes) {
    it(`${method} ${path} → 401 without a session`, async () => {
      expect((await app.request(path, { method })).status).toBe(401);
    });
  }
});
