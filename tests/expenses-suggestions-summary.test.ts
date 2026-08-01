/**
 * GET /expenses/suggestions and GET /expenses/summary.
 *
 * Suggestions power the Add-Expense sheet's "recent" chips; summary powers
 * the Dashboard's month stat tile. Neither is analytics (no breakdowns, no
 * trends) — see worker/lib/expenses/queries.ts for the boundary.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { app } from "../worker/index";
import type { Env } from "../worker/types";
import {
  createTestEnv,
  seedActor,
  seedExpense,
  seedExpenseCategory,
  seedFamily,
  seedUser,
} from "./helpers/testEnv";

let env: Env;
let sqlite: DatabaseSync;
let familyId: string;
let owner: { userId: string; memberId: string; cookie: string };
let member: { userId: string; memberId: string; cookie: string };
let food: string;
let restaurants: string;
let home: string;

function req(path: string, init: RequestInit = {}, cookie?: string) {
  return app.request(
    `http://localhost/api${path}`,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(init.headers ?? {}),
      },
    },
    env,
  );
}

beforeEach(() => {
  ({ env, sqlite } = createTestEnv());
  const ownerUser = seedUser(sqlite);
  familyId = seedFamily(sqlite, ownerUser.id).id;
  owner = seedActor(sqlite, familyId, "owner");
  member = seedActor(sqlite, familyId, "member");

  food = seedExpenseCategory(sqlite, { familyId, slug: "food", name: "Food" }).id;
  restaurants = seedExpenseCategory(sqlite, {
    familyId,
    slug: "food-restaurants",
    name: "Restaurants",
    parentId: food,
  }).id;
  home = seedExpenseCategory(sqlite, { familyId, slug: "home", name: "Home" }).id;
});

describe("GET /expenses/suggestions", () => {
  interface SuggestionsResponse {
    recentCategories: { categoryId: string; categoryName: string; subcategoryId: string | null }[];
    frequentMerchants: { merchant: string; uses: number }[];
  }

  const get = async (cookie: string) => {
    const res = await req(`/expenses/suggestions?familyId=${familyId}`, {}, cookie);
    return { status: res.status, body: (await res.json()) as SuggestionsResponse };
  };

  it("requires a session and family membership", async () => {
    expect((await req(`/expenses/suggestions?familyId=${familyId}`)).status).toBe(401);
    const stranger = seedUser(sqlite);
    const cookie = seedActor(sqlite, (seedFamily(sqlite, stranger.id, "Other")).id, "owner").cookie;
    const res = await req(`/expenses/suggestions?familyId=${familyId}`, {}, cookie);
    expect(res.status).toBe(404);
  });

  it("returns empty arrays with no expenses yet", async () => {
    const { status, body } = await get(owner.cookie);
    expect(status).toBe(200);
    expect(body.recentCategories).toEqual([]);
    expect(body.frequentMerchants).toEqual([]);
  });

  it("orders recent categories by most-recently-used first", async () => {
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food });
    // Give "home" a later updatedAt explicitly so ordering is deterministic
    // even when both rows are inserted within the same wall-clock second.
    const homeExpenseId = seedExpense(sqlite, {
      familyId,
      createdByUserId: owner.userId,
      categoryId: home,
    }).id;
    sqlite
      .prepare("UPDATE expenses SET updated_at = unixepoch() + 100 WHERE id = ?")
      .run(homeExpenseId);

    const { body } = await get(owner.cookie);
    expect(body.recentCategories[0].categoryId).toBe(home);
  });

  it("groups by category AND subcategory separately", async () => {
    seedExpense(sqlite, {
      familyId,
      createdByUserId: owner.userId,
      categoryId: food,
      subcategoryId: restaurants,
    });
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food });

    const { body } = await get(owner.cookie);
    expect(body.recentCategories).toHaveLength(2);
  });

  it("excludes archived categories from suggestions", async () => {
    const archived = seedExpenseCategory(sqlite, { familyId, slug: "old", status: "active" });
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: archived.id });
    sqlite.prepare("UPDATE expense_categories SET status = 'archived' WHERE id = ?").run(archived.id);

    const { body } = await get(owner.cookie);
    expect(body.recentCategories.map((c) => c.categoryId)).not.toContain(archived.id);
  });

  it("orders frequent merchants by usage count", async () => {
    for (let i = 0; i < 3; i++) {
      seedExpense(sqlite, {
        familyId,
        createdByUserId: owner.userId,
        categoryId: food,
        merchant: "KFC",
        merchantKey: "kfc",
      });
    }
    seedExpense(sqlite, {
      familyId,
      createdByUserId: owner.userId,
      categoryId: food,
      merchant: "Amazon",
      merchantKey: "amazon",
    });

    const { body } = await get(owner.cookie);
    expect(body.frequentMerchants[0].merchant).toBe("KFC");
    expect(body.frequentMerchants[0].uses).toBe(3);
  });

  it("never derives suggestions from another member's private expenses", async () => {
    seedExpense(sqlite, {
      familyId,
      createdByUserId: member.userId,
      categoryId: home,
      merchant: "Therapist",
      merchantKey: "therapist",
      visibility: "private",
    });

    const { body } = await get(owner.cookie);
    expect(body.recentCategories.map((c) => c.categoryId)).not.toContain(home);
    expect(body.frequentMerchants.map((m) => m.merchant)).not.toContain("Therapist");
  });

  it("includes the user's OWN private expenses in their own suggestions", async () => {
    seedExpense(sqlite, {
      familyId,
      createdByUserId: member.userId,
      categoryId: home,
      merchant: "Therapist",
      merchantKey: "therapist",
      visibility: "private",
    });

    const { body } = await get(member.cookie);
    expect(body.recentCategories.map((c) => c.categoryId)).toContain(home);
    expect(body.frequentMerchants.map((m) => m.merchant)).toContain("Therapist");
  });
});

describe("GET /expenses/summary", () => {
  interface SummaryResponse {
    byCurrency: { currency: string; totalMinor: number; count: number }[];
    mixed: boolean;
    singleCurrency: { currency: string; totalMinor: number; count: number } | null;
  }

  const get = async (query: string, cookie: string) => {
    const res = await req(`/expenses/summary?familyId=${familyId}${query}`, {}, cookie);
    return { status: res.status, body: (await res.json()) as SummaryResponse & { error?: string } };
  };

  it("requires from and to", async () => {
    const res = await get("", owner.cookie);
    expect(res.status).toBe(400);
  });

  it("sums a single currency", async () => {
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, amountMinor: 10000, spentOn: "2026-08-01" });
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, amountMinor: 5000, spentOn: "2026-08-15" });

    const { status, body } = await get("&from=2026-08-01&to=2026-08-31", owner.cookie);
    expect(status).toBe(200);
    expect(body.mixed).toBe(false);
    expect(body.singleCurrency).toEqual({ currency: "INR", totalMinor: 15000, count: 2 });
  });

  it("NEVER combines different currencies into one number", async () => {
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, amountMinor: 10000, currency: "INR", spentOn: "2026-08-01" });
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, amountMinor: 5000, currency: "USD", spentOn: "2026-08-02" });

    const { body } = await get("&from=2026-08-01&to=2026-08-31", owner.cookie);
    expect(body.mixed).toBe(true);
    expect(body.singleCurrency).toBeNull();
    expect(body.byCurrency).toHaveLength(2);
  });

  it("respects the date range", async () => {
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, amountMinor: 10000, spentOn: "2026-07-01" });
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, amountMinor: 5000, spentOn: "2026-08-01" });

    const { body } = await get("&from=2026-08-01&to=2026-08-31", owner.cookie);
    expect(body.singleCurrency!.totalMinor).toBe(5000);
  });

  it("excludes another member's private expenses from the total", async () => {
    seedExpense(sqlite, {
      familyId,
      createdByUserId: member.userId,
      categoryId: food,
      amountMinor: 999900,
      spentOn: "2026-08-01",
      visibility: "private",
    });

    const { body } = await get("&from=2026-08-01&to=2026-08-31", owner.cookie);
    expect(body.byCurrency).toEqual([]);
  });

  it("includes the user's own private expenses in their own total", async () => {
    seedExpense(sqlite, {
      familyId,
      createdByUserId: member.userId,
      categoryId: food,
      amountMinor: 5000,
      spentOn: "2026-08-01",
      visibility: "private",
    });

    const { body } = await get("&from=2026-08-01&to=2026-08-31", member.cookie);
    expect(body.singleCurrency!.totalMinor).toBe(5000);
  });

  it("excludes trashed expenses from the total", async () => {
    seedExpense(sqlite, {
      familyId,
      createdByUserId: owner.userId,
      categoryId: food,
      amountMinor: 5000,
      spentOn: "2026-08-01",
      status: "trashed",
    });

    const { body } = await get("&from=2026-08-01&to=2026-08-31", owner.cookie);
    expect(body.byCurrency).toEqual([]);
  });

  it("404s for a non-member", async () => {
    const stranger = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, stranger.id, "Other").id;
    const cookie = seedActor(sqlite, otherFamily, "owner").cookie;
    const res = await req(`/expenses/summary?familyId=${familyId}&from=2026-08-01&to=2026-08-31`, {}, cookie);
    expect(res.status).toBe(404);
  });
});
