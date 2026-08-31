/**
 * Recurring expenses, wishlist, money plan, category parentId, summary budget.
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedUser,
} from "./helpers/testEnv";
import type { Env } from "../worker/types";
import { isDueWithinDays, periodKeyFor } from "../worker/lib/expenses/recurringDue";
import { computeBudget, toMonthlyMinor } from "../worker/lib/expenses/budget";
import { isoWeekKey } from "../worker/lib/expenses/isoWeek";

const ORIGIN = "http://localhost:5173";

function post(env: Env, path: string, cookie: string, body: unknown) {
  return app.request(
    path,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: ORIGIN,
      },
      body: JSON.stringify(body),
    },
    env,
  );
}

function put(env: Env, path: string, cookie: string, body: unknown) {
  return app.request(
    path,
    {
      method: "PUT",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: ORIGIN,
      },
      body: JSON.stringify(body),
    },
    env,
  );
}

function patch(env: Env, path: string, cookie: string, body: unknown) {
  return app.request(
    path,
    {
      method: "PATCH",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: ORIGIN,
      },
      body: JSON.stringify(body),
    },
    env,
  );
}

function get(env: Env, path: string, cookie: string) {
  return app.request(path, { headers: { Cookie: cookie } }, env);
}

function setup() {
  const { env, sqlite } = createTestEnv();
  const ownerUser = seedUser(sqlite);
  const family = seedFamily(sqlite, ownerUser.id);
  const alice = seedActor(sqlite, family.id, "member", { name: "Alice" });
  const bob = seedActor(sqlite, family.id, "member", { name: "Bob" });
  return { env, sqlite, familyId: family.id, alice, bob };
}

describe("recurringDue helpers", () => {
  it("flags a monthly charge due within 3 days", () => {
    const check = isDueWithinDays(
      {
        interval: "monthly",
        startDate: "2026-01-15",
        endDate: null,
        dayOfMonth: 17,
        active: true,
      },
      "2026-08-15",
      3,
    );
    expect(check.due).toBe(true);
    expect(check.dueDate).toBe("2026-08-17");
    expect(check.daysUntil).toBe(2);
  });

  it("builds period keys", () => {
    expect(periodKeyFor("monthly", "2026-08-17")).toBe("2026-08");
    expect(periodKeyFor("yearly", "2026-08-17")).toBe("2026");
    expect(periodKeyFor("weekly", "2026-08-17")).toMatch(/^2026-W\d{2}$/);
  });
});

describe("budget helpers", () => {
  it("computes leftover after tithe/children/savings/recurring/spent", () => {
    const b = computeBudget({
      monthlyIncomeMinor: 100_000,
      tithePercent: 10,
      childrenGivingMinor: 1_000,
      savingsGoalMinor: 5_000,
      spentMinor: 20_000,
      recurringMonthlyMinor: 15_000,
    });
    // 100000 - 20000 - 15000 - 10000 - 1000 - 5000 = 49000
    expect(b.titheDueMinor).toBe(10_000);
    expect(b.leftoverMinor).toBe(49_000);
  });

  it("normalizes weekly/yearly to monthly", () => {
    expect(toMonthlyMinor(1000, "monthly")).toBe(1000);
    expect(toMonthlyMinor(1200, "yearly")).toBe(100);
    expect(toMonthlyMinor(1200, "weekly")).toBe(Math.round((1200 * 52) / 12));
  });
});

describe("isoWeekKey", () => {
  it("returns ISO week buckets", () => {
    expect(isoWeekKey("2026-08-17")).toMatch(/^2026-W\d{2}$/);
  });
});

describe("expense categories: parentId", () => {
  it("creates a subcategory under a builtin parent and rejects depth > 1", async () => {
    const { env, sqlite } = createTestEnv();
    const ownerUser = seedUser(sqlite);
    const family = seedFamily(sqlite, ownerUser.id);
    const admin = seedActor(sqlite, family.id, "admin");
    const familyId = family.id;

    const cats = await get(
      env,
      `/api/expenses/categories?familyId=${familyId}`,
      admin.cookie,
    );
    expect(cats.status).toBe(200);
    const catBody = (await cats.json()) as {
      categories: { id: string; name: string; parentId: string | null }[];
    };
    expect(catBody.categories.some((c) => c.id === "builtin_tithe")).toBe(true);
    expect(catBody.categories.some((c) => c.id === "builtin_emi_loans")).toBe(
      true,
    );
    const fuel = catBody.categories.find((c) => c.id === "builtin_fuel");
    expect(fuel?.parentId).toBe("builtin_transport");

    const res = await post(env, "/api/expenses/categories", admin.cookie, {
      familyId,
      name: "Coffee shops",
      parentId: "builtin_dining",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      category: { id: string; parentId: string | null; name: string };
    };
    expect(body.category.parentId).toBe("builtin_dining");
    expect(body.category.name).toBe("Coffee shops");

    const deep = await post(env, "/api/expenses/categories", admin.cookie, {
      familyId,
      name: "Too deep",
      parentId: body.category.id,
    });
    expect(deep.status).toBe(400);
    const err = (await deep.json()) as { error: string };
    expect(err.error).toBe("validation_error");
  });
});

describe("money plan + summary budget", () => {
  it("upserts a plan and surfaces budget fields on summary", async () => {
    const { env, familyId, alice } = setup();

    const putRes = await put(
      env,
      `/api/expenses/plan?familyId=${familyId}`,
      alice.cookie,
      {
        monthlyIncomeMinor: 200_000,
        tithePercent: 10,
        childrenGivingMinor: 2_000,
        savingsGoalMinor: 10_000,
      },
    );
    expect(putRes.status).toBe(200);
    const planBody = (await putRes.json()) as {
      plan: { monthlyIncomeMinor: number; tithePercent: number };
    };
    expect(planBody.plan.monthlyIncomeMinor).toBe(200_000);
    expect(planBody.plan.tithePercent).toBe(10);

    await post(env, "/api/expenses", alice.cookie, {
      familyId,
      paidByMemberId: alice.memberId,
      amountMinor: 5_000,
      currency: "USD",
      expenseDate: "2026-08-10",
    });

    await post(env, "/api/expenses/recurring", alice.cookie, {
      familyId,
      title: "Car EMI",
      kind: "emi",
      amountMinor: 20_000,
      currency: "USD",
      interval: "monthly",
      startDate: "2026-01-01",
      dayOfMonth: 5,
    });

    const summary = await get(
      env,
      `/api/expenses/summary?familyId=${familyId}&from=2026-08-01&to=2026-08-31`,
      alice.cookie,
    );
    expect(summary.status).toBe(200);
    const body = (await summary.json()) as {
      totalMinor: number;
      recurringMonthlyMinor: number;
      byWeek: { week: string; totalMinor: number }[];
      budget: {
        incomeMinor: number;
        titheDueMinor: number;
        leftoverMinor: number;
      };
      spendAdvice: string;
    };
    expect(body.totalMinor).toBe(5_000);
    expect(body.recurringMonthlyMinor).toBe(20_000);
    expect(body.budget.incomeMinor).toBe(200_000);
    expect(body.budget.titheDueMinor).toBe(20_000);
    expect(body.byWeek.length).toBeGreaterThan(0);
    expect(body.spendAdvice.length).toBeGreaterThan(0);
    // leftover = 200000 - 5000 - 20000 - 20000 - 2000 - 10000 = 143000
    expect(body.budget.leftoverMinor).toBe(143_000);
  });
});

describe("recurring expenses: privacy", () => {
  it("hides private recurring from other members including owners", async () => {
    const { env, familyId, alice, bob } = setup();
    const created = await post(env, "/api/expenses/recurring", alice.cookie, {
      familyId,
      title: "Secret EMI",
      amountMinor: 9_999,
      currency: "USD",
      interval: "monthly",
      startDate: "2026-01-01",
      dayOfMonth: 1,
      visibility: "private",
    });
    expect(created.status).toBe(201);
    const { recurring } = (await created.json()) as {
      recurring: { id: string };
    };

    const bobList = (await (
      await get(env, `/api/expenses/recurring?familyId=${familyId}`, bob.cookie)
    ).json()) as { recurring: { id: string }[] };
    expect(bobList.recurring.map((r) => r.id)).not.toContain(recurring.id);

    const bobGet = await get(
      env,
      `/api/expenses/recurring/${recurring.id}`,
      bob.cookie,
    );
    expect(bobGet.status).toBe(404);
  });

  it("lets the creator update and delete", async () => {
    const { env, familyId, alice } = setup();
    const created = await post(env, "/api/expenses/recurring", alice.cookie, {
      familyId,
      title: "Netflix",
      kind: "subscription",
      amountMinor: 1_500,
      currency: "USD",
      interval: "monthly",
      startDate: "2026-01-01",
      dayOfMonth: 10,
    });
    const { recurring } = (await created.json()) as {
      recurring: { id: string };
    };

    const upd = await patch(
      env,
      `/api/expenses/recurring/${recurring.id}`,
      alice.cookie,
      { amountMinor: 1_600 },
    );
    expect(upd.status).toBe(200);

    const del = await app.request(
      `/api/expenses/recurring/${recurring.id}`,
      { method: "DELETE", headers: { Cookie: alice.cookie, Origin: ORIGIN } },
      env,
    );
    expect(del.status).toBe(200);
  });
});

describe("wishlist CRUD", () => {
  it("creates, lists, and updates wishlist items for family members", async () => {
    const { env, familyId, alice, bob } = setup();
    const created = await post(env, "/api/expenses/wishlist", alice.cookie, {
      familyId,
      title: "Standing desk",
      estimatedMinor: 30_000,
      priority: "should",
    });
    expect(created.status).toBe(201);
    const { item } = (await created.json()) as {
      item: { id: string; title: string; status: string };
    };
    expect(item.status).toBe("open");

    // Family-visible: bob can list it.
    const list = (await (
      await get(env, `/api/expenses/wishlist?familyId=${familyId}`, bob.cookie)
    ).json()) as { items: { id: string }[] };
    expect(list.items.map((i) => i.id)).toContain(item.id);

    // Only creator can patch.
    const byBob = await patch(
      env,
      `/api/expenses/wishlist/${item.id}`,
      bob.cookie,
      { status: "bought" },
    );
    expect(byBob.status).toBe(403);

    const byAlice = await patch(
      env,
      `/api/expenses/wishlist/${item.id}`,
      alice.cookie,
      { status: "bought" },
    );
    expect(byAlice.status).toBe(200);
  });
});
