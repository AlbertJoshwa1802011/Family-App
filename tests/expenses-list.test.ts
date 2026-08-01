/**
 * GET /expenses — keyset pagination, filters, search.
 *
 * The pagination ordering is (spent_on DESC, rowid DESC). The dangerous case
 * is many expenses sharing the same spent_on: without the rowid tiebreaker a
 * page boundary could skip or repeat rows. Several tests below seed expenses
 * with an IDENTICAL spentOn specifically to exercise that boundary.
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
  seedPaymentMethod,
  seedSession,
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
let cash: string;

interface ExpenseListItem {
  id: string;
  amountMinor: number;
  spentOn: string;
  merchant: string | null;
  categoryId: string | null;
  categoryName: string | null;
  visibility: string;
}

interface ListResponse {
  expenses?: ExpenseListItem[];
  hasMore?: boolean;
  nextCursor?: string | null;
  error?: string;
}

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

async function list(query: string, cookie: string): Promise<{ status: number } & ListResponse> {
  const res = await req(`/expenses?familyId=${familyId}${query}`, {}, cookie);
  const body = (await res.json()) as ListResponse;
  return { status: res.status, ...body };
}

function seedN(
  actor: { userId: string },
  n: number,
  make: (i: number) => Record<string, unknown>,
) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(
      seedExpense(sqlite, {
        familyId,
        createdByUserId: actor.userId,
        categoryId: food,
        ...make(i),
      }).id,
    );
  }
  return ids;
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
  cash = seedPaymentMethod(sqlite, { familyId, slug: "cash", kind: "cash" }).id;
});

describe("basic listing", () => {
  it("requires a session", async () => {
    const res = await req(`/expenses?familyId=${familyId}`);
    expect(res.status).toBe(401);
  });

  it("requires familyId", async () => {
    const res = await req("/expenses", {}, owner.cookie);
    expect(res.status).toBe(400);
  });

  it("404s for a non-member", async () => {
    const stranger = seedUser(sqlite);
    const res = await list("", seedSession(sqlite, stranger.id));
    expect(res.status).toBe(404);
  });

  it("returns an empty list with hasMore=false when there's nothing", async () => {
    const res = await list("", owner.cookie);
    expect(res.status).toBe(200);
    expect(res.expenses).toEqual([]);
    expect(res.hasMore).toBe(false);
    expect(res.nextCursor).toBeNull();
  });

  it("orders newest spentOn first", async () => {
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, spentOn: "2026-01-01" });
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, spentOn: "2026-06-15" });
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, spentOn: "2026-03-10" });

    const res = await list("", owner.cookie);
    expect(res.expenses.map((e) => e.spentOn)).toEqual(["2026-06-15", "2026-03-10", "2026-01-01"]);
  });

  it("enriches each row with its category", async () => {
    seedExpense(sqlite, {
      familyId,
      createdByUserId: owner.userId,
      categoryId: food,
      subcategoryId: restaurants,
    });
    const res = await list("", owner.cookie);
    expect(res.expenses[0].categoryId).toBe(food);
    expect(res.expenses[0].categoryName).toBe("Food");
  });

  it("excludes trashed expenses", async () => {
    const trashed = seedExpense(sqlite, {
      familyId,
      createdByUserId: owner.userId,
      categoryId: food,
      status: "trashed",
    }).id;
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food });

    const res = await list("", owner.cookie);
    expect(res.expenses.map((e) => e.id)).not.toContain(trashed);
    expect(res.expenses).toHaveLength(1);
  });

  it("never leaks another family's expenses", async () => {
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    const otherCategory = seedExpenseCategory(sqlite, { familyId: otherFamily, slug: "food" }).id;
    const foreignId = seedExpense(sqlite, {
      familyId: otherFamily,
      createdByUserId: otherUser.id,
      categoryId: otherCategory,
    }).id;

    const res = await list("", owner.cookie);
    expect(res.expenses.map((e) => e.id)).not.toContain(foreignId);
  });
});

describe("privacy in the list", () => {
  it("excludes another member's private expense", async () => {
    const privateId = seedExpense(sqlite, {
      familyId,
      createdByUserId: member.userId,
      categoryId: food,
      visibility: "private",
    }).id;

    const res = await list("", owner.cookie);
    expect(res.expenses.map((e) => e.id)).not.toContain(privateId);
  });

  it("includes the creator's own private expense in their own list", async () => {
    const privateId = seedExpense(sqlite, {
      familyId,
      createdByUserId: member.userId,
      categoryId: food,
      visibility: "private",
    }).id;

    const res = await list("", member.cookie);
    expect(res.expenses.map((e) => e.id)).toContain(privateId);
  });
});

describe("keyset pagination", () => {
  it("paginates in fixed pages honoring hasMore", async () => {
    seedN(owner, 35, (i) => ({ spentOn: `2026-01-${String((i % 28) + 1).padStart(2, "0")}` }));

    const page1 = await list("", owner.cookie);
    expect(page1.expenses).toHaveLength(30); // EXPENSE_PAGE_SIZE
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await list(`&cursor=${encodeURIComponent(page1.nextCursor!)}`, owner.cookie);
    expect(page2.expenses).toHaveLength(5);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();
  });

  it("never repeats or skips a row across pages", async () => {
    const ids = seedN(owner, 40, (i) => ({
      spentOn: `2026-02-${String((i % 28) + 1).padStart(2, "0")}`,
    }));

    const seen = new Set<string>();
    let cursor: string | null = null;
    let guard = 0;
    do {
      const page: { expenses: ExpenseListItem[]; hasMore: boolean; nextCursor: string | null } =
        await list(cursor ? `&cursor=${encodeURIComponent(cursor)}` : "", owner.cookie);
      for (const e of page.expenses) {
        expect(seen.has(e.id), `row ${e.id} repeated`).toBe(false);
        seen.add(e.id);
      }
      cursor = page.nextCursor;
      guard++;
    } while (cursor && guard < 10);

    expect(seen.size).toBe(ids.length);
    for (const id of ids) expect(seen.has(id)).toBe(true);
  });

  it("the rowid tiebreaker holds when many expenses share the same spentOn", async () => {
    // 35 expenses, ALL on the same date — this is the case a plain
    // date-only cursor would corrupt (repeat or skip rows at the boundary).
    const ids = seedN(owner, 35, () => ({ spentOn: "2026-05-01" }));

    const page1 = await list("", owner.cookie);
    expect(page1.expenses).toHaveLength(30);
    expect(page1.hasMore).toBe(true);

    const page2 = await list(`&cursor=${encodeURIComponent(page1.nextCursor!)}`, owner.cookie);
    expect(page2.expenses).toHaveLength(5);
    expect(page2.hasMore).toBe(false);

    const allIds = [...page1.expenses, ...page2.expenses].map((e) => e.id);
    expect(new Set(allIds).size).toBe(35); // no duplicates
    expect(allIds.sort()).toEqual([...ids].sort());
  });

  it("ignores a malformed cursor rather than erroring", async () => {
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food });
    const res = await list("&cursor=garbage", owner.cookie);
    expect(res.status).toBe(200);
    expect(res.expenses).toHaveLength(1);
  });
});

describe("filters", () => {
  it("filters by date range", async () => {
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, spentOn: "2026-01-01" });
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, spentOn: "2026-03-15" });
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, spentOn: "2026-06-01" });

    const res = await list("&from=2026-02-01&to=2026-04-01", owner.cookie);
    expect(res.expenses.map((e) => e.spentOn)).toEqual(["2026-03-15"]);
  });

  it("filters by category", async () => {
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food });
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: home });

    const res = await list(`&categoryId=${home}`, owner.cookie);
    expect(res.expenses).toHaveLength(1);
    expect(res.expenses[0].categoryId).toBe(home);
  });

  it("filters by subcategory", async () => {
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, subcategoryId: restaurants });
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food });

    const res = await list(`&subcategoryId=${restaurants}`, owner.cookie);
    expect(res.expenses).toHaveLength(1);
  });

  it("filters by payment method", async () => {
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, paymentMethodId: cash });
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food });

    const res = await list(`&paymentMethodId=${cash}`, owner.cookie);
    expect(res.expenses).toHaveLength(1);
  });

  it("filters by payer member", async () => {
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, payerMemberId: member.memberId });
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, payerMemberId: owner.memberId });

    const res = await list(`&memberId=${member.memberId}`, owner.cookie);
    expect(res.expenses).toHaveLength(1);
  });

  it("filters by merchant, normalized the same way merchant_key is stored", async () => {
    seedExpense(sqlite, {
      familyId,
      createdByUserId: owner.userId,
      categoryId: food,
      merchant: "KFC Whitefield",
      merchantKey: "kfc whitefield",
    });
    seedExpense(sqlite, {
      familyId,
      createdByUserId: owner.userId,
      categoryId: food,
      merchant: "Amazon",
      merchantKey: "amazon",
    });

    const res = await list(`&merchant=${encodeURIComponent("KFC Whitefield")}`, owner.cookie);
    expect(res.expenses).toHaveLength(1);
    expect(res.expenses[0].merchant).toBe("KFC Whitefield");
  });

  it("filters by amount range", async () => {
    // ₹50, ₹500, ₹5000 — a range of ₹100–₹1000 should match only the ₹500 one.
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, amountMinor: 5000 });
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, amountMinor: 50000 });
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, amountMinor: 500000 });

    const res = await list("&minAmount=100&maxAmount=1000", owner.cookie);
    expect(res.expenses).toHaveLength(1);
    expect(res.expenses![0].amountMinor).toBe(50000);
  });

  it("rejects an invalid amount-range value", async () => {
    const res = await list("&minAmount=not-a-number", owner.cookie);
    expect(res.status).toBe(400);
    expect(res).toMatchObject({ error: "invalid_amount" });
  });

  it("combines multiple filters (AND, not OR)", async () => {
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, spentOn: "2026-01-01", amountMinor: 1000 });
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: home, spentOn: "2026-01-01", amountMinor: 1000 });

    const res = await list(`&categoryId=${food}&from=2026-01-01&to=2026-01-01`, owner.cookie);
    expect(res.expenses).toHaveLength(1);
    expect(res.expenses[0].categoryId).toBe(food);
  });

  it("excludes trashed rows even when other filters match", async () => {
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, status: "trashed" });
    const res = await list(`&categoryId=${food}`, owner.cookie);
    expect(res.expenses).toHaveLength(0);
  });
});

describe("search (?q=)", () => {
  it("matches merchant", async () => {
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, merchant: "KFC" });
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, merchant: "Amazon" });

    const res = await list("&q=kfc", owner.cookie);
    expect(res.expenses).toHaveLength(1);
    expect(res.expenses[0].merchant).toBe("KFC");
  });

  it("matches notes", async () => {
    sqlite
      .prepare(
        `INSERT INTO expenses (id, family_id, created_by_user_id, amount_minor, spent_on, category_id, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())`,
      )
      .run(crypto.randomUUID(), familyId, owner.userId, 1000, "2026-01-01", food, "team lunch reimbursement");

    const res = await list("&q=reimbursement", owner.cookie);
    expect(res.expenses).toHaveLength(1);
  });

  it("is case-insensitive (SQLite LIKE default for ASCII)", async () => {
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, merchant: "KFC" });
    const res = await list("&q=kfc", owner.cookie);
    expect(res.expenses).toHaveLength(1);
  });

  it("a wildcard-only query matches nothing, not everything", async () => {
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, merchant: "KFC" });
    const res = await list(`&q=${encodeURIComponent("%%%")}`, owner.cookie);
    expect(res.expenses).toEqual([]);
  });

  it("returns nothing for a query matching no expenses", async () => {
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: food, merchant: "KFC" });
    const res = await list("&q=nonexistentmerchant", owner.cookie);
    expect(res.expenses).toEqual([]);
  });
});
