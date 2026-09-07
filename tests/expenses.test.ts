/**
 * Family expenses: create/list/update/delete, Zod boundaries, family isolation.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../worker/index";
import { fromCents, toCents, formatMoney } from "../worker/lib/expenses";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

let t: TestEnv;
let familyId: string;
let owner: ReturnType<typeof seedActor>;
let member: ReturnType<typeof seedActor>;

beforeEach(() => {
  t = createTestEnv();
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  owner = seedActor(t.sqlite, familyId, "owner", { name: "Olive Owner" });
  member = seedActor(t.sqlite, familyId, "member", { name: "Milo Member" });
});

function req(method: string, path: string, cookie: string, body?: object) {
  return app.request(
    path,
    {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
    t.env,
  );
}

describe("expense money helpers", () => {
  it("rounds major units to integer cents", () => {
    expect(toCents(100)).toBe(10000);
    expect(toCents(99.5)).toBe(9950);
    expect(toCents(1.01)).toBe(101);
    expect(fromCents(10000)).toBe(100);
  });

  it("formats INR/USD/EUR/GBP and a fallback code", () => {
    expect(formatMoney(10000, "INR")).toBe("₹100");
    expect(formatMoney(1050, "USD")).toBe("$10.50");
    expect(formatMoney(200, "EUR")).toBe("€2");
    expect(formatMoney(100, "GBP")).toBe("£1");
    expect(formatMoney(500, "JPY")).toBe("5 JPY");
  });
});

describe("expenses API", () => {
  it("create → list roundtrip with amount in major units and cents", async () => {
    const create = await req("POST", "/api/expenses", member.cookie, {
      familyId,
      amount: 100,
      category: "food",
      note: "outside snacks",
    });
    expect(create.status).toBe(201);
    const { expense } = (await create.json()) as {
      expense: { id: string; amount: number; amountCents: number; category: string; note: string };
    };
    expect(expense.amount).toBe(100);
    expect(expense.amountCents).toBe(10000);
    expect(expense.category).toBe("food");
    expect(expense.note).toBe("outside snacks");

    const list = await req("GET", `/api/expenses?familyId=${familyId}`, owner.cookie);
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      expenses: { id: string }[];
      total: number;
      totalCents: number;
    };
    expect(body.expenses.map((e) => e.id)).toEqual([expense.id]);
    expect(body.total).toBe(100);
    expect(body.totalCents).toBe(10000);
  });

  it("PATCH updates amount; null note clears; member cannot edit owner's row", async () => {
    const created = await (
      await req("POST", "/api/expenses", owner.cookie, {
        familyId,
        amount: 50,
        note: "fuel",
        category: "transport",
      })
    ).json() as { expense: { id: string } };

    const forbidden = await req("PATCH", `/api/expenses/${created.expense.id}`, member.cookie, {
      amount: 1,
    });
    expect(forbidden.status).toBe(403);

    const patched = await req("PATCH", `/api/expenses/${created.expense.id}`, owner.cookie, {
      amount: 75.5,
      note: null,
    });
    expect(patched.status).toBe(200);
    const { expense } = (await patched.json()) as {
      expense: { amount: number; amountCents: number; note: string | null };
    };
    expect(expense.amountCents).toBe(7550);
    expect(expense.note).toBeNull();
  });

  it("DELETE: author can delete; stranger 404; missing familyId 400", async () => {
    const created = await (
      await req("POST", "/api/expenses", member.cookie, { familyId, amount: 10 })
    ).json() as { expense: { id: string } };

    expect((await req("GET", "/api/expenses", member.cookie)).status).toBe(400);
    expect((await req("DELETE", `/api/expenses/${created.expense.id}`, member.cookie)).status).toBe(200);
    expect((await req("GET", `/api/expenses/${created.expense.id}`, member.cookie)).status).toBe(404);
  });

  it("Zod: missing amount, negative, bad currency, bad category → 400 validation_error", async () => {
    const missing = await req("POST", "/api/expenses", member.cookie, { familyId });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toBe("validation_error");

    expect(
      (await req("POST", "/api/expenses", member.cookie, { familyId, amount: -5 })).status,
    ).toBe(400);
    expect(
      (await req("POST", "/api/expenses", member.cookie, { familyId, amount: 10, currency: "rupee" })).status,
    ).toBe(400);
    expect(
      (await req("POST", "/api/expenses", member.cookie, { familyId, amount: 10, category: "snacks" })).status,
    ).toBe(400);
    expect(
      (await req("POST", "/api/expenses", member.cookie, { familyId, amount: 10, spentOn: "5 Sept" })).status,
    ).toBe(400);
  });

  it("family isolation: outsider cannot list, get, create, or mutate", async () => {
    const created = await (
      await req("POST", "/api/expenses", member.cookie, { familyId, amount: 20, note: "secret" })
    ).json() as { expense: { id: string } };

    const strangerUser = seedUser(t.sqlite);
    const otherFamily = seedFamily(t.sqlite, strangerUser.id);
    const stranger = seedActor(t.sqlite, otherFamily.id, "owner");

    expect(
      (await req("GET", `/api/expenses?familyId=${familyId}`, stranger.cookie)).status,
    ).toBe(404);
    expect(
      (await req("GET", `/api/expenses/${created.expense.id}`, stranger.cookie)).status,
    ).toBe(404);
    expect(
      (await req("POST", "/api/expenses", stranger.cookie, { familyId, amount: 1 })).status,
    ).toBe(404);
    expect(
      (await req("PATCH", `/api/expenses/${created.expense.id}`, stranger.cookie, { amount: 99 })).status,
    ).toBe(404);
    expect(
      (await req("DELETE", `/api/expenses/${created.expense.id}`, stranger.cookie)).status,
    ).toBe(404);
  });

  it("401 without a session; deep path 404 JSON", async () => {
    expect((await app.request("/api/expenses", {}, t.env)).status).toBe(401);
    expect(
      (await app.request("/api/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, t.env)).status,
    ).toBe(401);
    const deep = await app.request("/api/expenses/x/y/z", {}, t.env);
    expect(deep.status).toBe(404);
    expect(((await deep.json()) as { error: string }).error).toBe("not_found");
  });

  it("filters by category", async () => {
    await req("POST", "/api/expenses", member.cookie, { familyId, amount: 10, category: "food" });
    await req("POST", "/api/expenses", member.cookie, { familyId, amount: 40, category: "transport" });
    const res = await req("GET", `/api/expenses?familyId=${familyId}&category=food`, member.cookie);
    const { expenses, total } = (await res.json()) as { expenses: { category: string }[]; total: number };
    expect(expenses.every((e) => e.category === "food")).toBe(true);
    expect(total).toBe(10);
  });
});

describe("expense categories (Money Manager–style tree)", () => {
  it("GET /expenses/categories seeds emoji parent→child tree once", async () => {
    const res = await req(
      "GET",
      `/api/expenses/categories?familyId=${familyId}`,
      member.cookie,
    );
    expect(res.status).toBe(200);
    const { categories } = (await res.json()) as {
      categories: {
        slug: string | null;
        emoji: string;
        name: string;
        children: { slug: string | null; emoji: string; name: string }[];
      }[];
    };
    expect(categories.length).toBeGreaterThanOrEqual(9);
    const food = categories.find((c) => c.slug === "food");
    expect(food?.emoji).toBe("🍔");
    expect(food?.name).toBe("Food & Dining");
    expect(food?.children.some((c) => c.slug === "food-snacks" && c.emoji === "🍿")).toBe(true);
    expect(categories.every((c) => c.emoji.length > 0)).toBe(true);

    // Idempotent: second call does not duplicate.
    const again = await (
      await req("GET", `/api/expenses/categories?familyId=${familyId}`, owner.cookie)
    ).json() as { categories: unknown[] };
    expect(again.categories).toHaveLength(categories.length);
  });

  it("POST creates a subcategory under a parent and selects it on expense", async () => {
    const tree = await (
      await req("GET", `/api/expenses/categories?familyId=${familyId}`, member.cookie)
    ).json() as { categories: { id: string; slug: string | null; children: { id: string }[] }[] };
    const food = tree.categories.find((c) => c.slug === "food")!;

    const created = await req("POST", "/api/expenses/categories", member.cookie, {
      familyId,
      name: "Office lunch",
      emoji: "🥗",
      parentId: food.id,
    });
    expect(created.status).toBe(201);
    const { category } = (await created.json()) as {
      category: { id: string; name: string; emoji: string; parentId: string | null; slug: string | null };
    };
    expect(category.name).toBe("Office lunch");
    expect(category.emoji).toBe("🥗");
    expect(category.parentId).toBe(food.id);
    expect(category.slug).toBeNull();

    const exp = await req("POST", "/api/expenses", member.cookie, {
      familyId,
      amount: 250,
      categoryId: category.id,
      note: "salad bowl",
    });
    expect(exp.status).toBe(201);
    const body = (await exp.json()) as {
      expense: {
        category: string;
        categoryId: string;
        categoryName: string;
        categoryEmoji: string;
        parentCategoryName: string | null;
      };
    };
    expect(body.expense.category).toBe("food"); // root slug for filters
    expect(body.expense.categoryId).toBe(category.id);
    expect(body.expense.categoryName).toBe("Office lunch");
    expect(body.expense.categoryEmoji).toBe("🥗");
    expect(body.expense.parentCategoryName).toBe("Food & Dining");
  });

  it("rejects grandchild (max depth 2), cross-family parent, bad emoji length", async () => {
    const tree = await (
      await req("GET", `/api/expenses/categories?familyId=${familyId}`, member.cookie)
    ).json() as { categories: { id: string; slug: string | null; children: { id: string }[] }[] };
    const food = tree.categories.find((c) => c.slug === "food")!;
    const snacks = food.children[0]!;

    const deep = await req("POST", "/api/expenses/categories", member.cookie, {
      familyId,
      name: "Too deep",
      parentId: snacks.id,
    });
    expect(deep.status).toBe(400);
    expect(((await deep.json()) as { error: string }).error).toBe("max_depth");

    const strangerUser = seedUser(t.sqlite);
    const other = seedFamily(t.sqlite, strangerUser.id);
    const stranger = seedActor(t.sqlite, other.id, "owner");
    const otherTree = await (
      await req("GET", `/api/expenses/categories?familyId=${other.id}`, stranger.cookie)
    ).json() as { categories: { id: string }[] };

    const cross = await req("POST", "/api/expenses/categories", member.cookie, {
      familyId,
      name: "Hijack",
      parentId: otherTree.categories[0]!.id,
    });
    expect(cross.status).toBe(400);
    expect(((await cross.json()) as { error: string }).error).toBe("invalid_parent_id");

    const longEmoji = await req("POST", "/api/expenses/categories", member.cookie, {
      familyId,
      name: "Bad",
      emoji: "x".repeat(20),
    });
    expect(longEmoji.status).toBe(400);
    expect(((await longEmoji.json()) as { error: string }).error).toBe("validation_error");
  });

  it("outsider cannot list or create categories; missing familyId 400; 401 bare", async () => {
    const strangerUser = seedUser(t.sqlite);
    const other = seedFamily(t.sqlite, strangerUser.id);
    const stranger = seedActor(t.sqlite, other.id, "owner");

    expect(
      (await req("GET", `/api/expenses/categories?familyId=${familyId}`, stranger.cookie)).status,
    ).toBe(404);
    expect(
      (await req("POST", "/api/expenses/categories", stranger.cookie, {
        familyId,
        name: "Nope",
      })).status,
    ).toBe(404);
    expect((await req("GET", "/api/expenses/categories", member.cookie)).status).toBe(400);
    expect((await app.request("/api/expenses/categories", {}, t.env)).status).toBe(401);
  });

  it("invalid categoryId on create → 400; leaf pick stores root slug", async () => {
    const bad = await req("POST", "/api/expenses", member.cookie, {
      familyId,
      amount: 5,
      categoryId: "not-a-real-id",
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_category_id");

    const tree = await (
      await req("GET", `/api/expenses/categories?familyId=${familyId}`, member.cookie)
    ).json() as {
      categories: { id: string; slug: string | null; children: { id: string; slug: string | null }[] }[];
    };
    const transport = tree.categories.find((c) => c.slug === "transport")!;
    const fuel = transport.children.find((c) => c.slug === "transport-fuel")!;

    const exp = await (
      await req("POST", "/api/expenses", member.cookie, {
        familyId,
        amount: 80,
        categoryId: fuel.id,
        note: "shell petrol",
      })
    ).json() as { expense: { category: string; categoryId: string; categoryName: string } };
    expect(exp.expense.category).toBe("transport");
    expect(exp.expense.categoryId).toBe(fuel.id);
    expect(exp.expense.categoryName).toBe("Fuel");

    const filtered = await (
      await req("GET", `/api/expenses?familyId=${familyId}&category=transport`, member.cookie)
    ).json() as { expenses: { id: string }[]; total: number };
    expect(filtered.total).toBe(80);
  });
});

describe("expense note suggestions (fast lookup)", () => {
  async function seedNotes() {
    const tree = await (
      await req("GET", `/api/expenses/categories?familyId=${familyId}`, member.cookie)
    ).json() as {
      categories: { id: string; slug: string | null; children: { id: string; slug: string | null }[] }[];
    };
    const food = tree.categories.find((c) => c.slug === "food")!;
    const snacks = food.children.find((c) => c.slug === "food-snacks")!;
    const coffee = food.children.find((c) => c.slug === "food-coffee")!;

    for (let i = 0; i < 3; i++) {
      await req("POST", "/api/expenses", member.cookie, {
        familyId,
        amount: 100 + i,
        categoryId: snacks.id,
        note: "outside snacks",
        spentOn: `2026-09-0${i + 1}`,
      });
    }
    await req("POST", "/api/expenses", member.cookie, {
      familyId,
      amount: 40,
      categoryId: coffee.id,
      note: "office coffee",
    });
    await req("POST", "/api/expenses", member.cookie, {
      familyId,
      amount: 15,
      categoryId: snacks.id,
      note: "school snacks",
    });
  }

  it("ranks prefix matches and frequency; empty q returns recent unique notes", async () => {
    await seedNotes();

    const empty = await req(
      "GET",
      `/api/expenses/suggestions?familyId=${familyId}`,
      member.cookie,
    );
    expect(empty.status).toBe(200);
    const emptyBody = (await empty.json()) as { suggestions: { note: string; count: number }[] };
    expect(emptyBody.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(emptyBody.suggestions[0]!.note).toBe("outside snacks");
    expect(emptyBody.suggestions[0]!.count).toBe(3);

    const q = await req(
      "GET",
      `/api/expenses/suggestions?familyId=${familyId}&q=snack`,
      member.cookie,
    );
    const { suggestions } = (await q.json()) as {
      suggestions: {
        note: string;
        amount: number;
        categoryEmoji: string;
        categoryName: string;
        count: number;
      }[];
    };
    expect(suggestions.map((s) => s.note)).toEqual(
      expect.arrayContaining(["outside snacks", "school snacks"]),
    );
    expect(suggestions.every((s) => s.note.toLowerCase().includes("snack"))).toBe(true);
    expect(suggestions[0]!.note).toBe("outside snacks");
    expect(suggestions[0]!.count).toBe(3);
    expect(suggestions[0]!.categoryEmoji).toBe("🍿");
    expect(suggestions[0]!.amount).toBeGreaterThan(0);

    // Prefix "out" should prefer "outside snacks" over anything else matching.
    const prefix = await (
      await req(
        "GET",
        `/api/expenses/suggestions?familyId=${familyId}&q=out`,
        member.cookie,
      )
    ).json() as { suggestions: { note: string }[] };
    expect(prefix.suggestions[0]!.note).toBe("outside snacks");
  });

  it("family isolation on suggestions; LIKE metacharacters stripped safely", async () => {
    await seedNotes();
    const strangerUser = seedUser(t.sqlite);
    const other = seedFamily(t.sqlite, strangerUser.id);
    const stranger = seedActor(t.sqlite, other.id, "owner");

    expect(
      (await req(
        "GET",
        `/api/expenses/suggestions?familyId=${familyId}&q=snack`,
        stranger.cookie,
      )).status,
    ).toBe(404);

    const meta = await req(
      "GET",
      `/api/expenses/suggestions?familyId=${familyId}&q=${encodeURIComponent("%_snack")}`,
      member.cookie,
    );
    expect(meta.status).toBe(200);
    const { suggestions } = (await meta.json()) as { suggestions: { note: string }[] };
    // Stripped %/_ → still matches "snack"
    expect(suggestions.some((s) => s.note.includes("snack"))).toBe(true);
  });
});
