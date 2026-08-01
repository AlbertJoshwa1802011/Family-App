/**
 * Category + subcategory API contract, against a real D1-backed database.
 *
 * Covers the hierarchy rules that must never be enforced client-side: depth,
 * cross-family parents, archive semantics, and the guarantee that a category
 * with history can never be physically deleted.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { app } from "../worker/index";
import { getDb } from "../worker/db/client";
import type { Env } from "../worker/types";
import {
  createTestEnv,
  seedActor,
  seedExpense,
  seedExpenseCategory,
  seedFamily,
  seedUser,
  seedSession,
} from "./helpers/testEnv";
import { ensureExpenseSetup } from "../worker/lib/expenses/defaults";

let env: Env;
let sqlite: DatabaseSync;
let familyId: string;
let owner: { userId: string; memberId: string; cookie: string };
let member: { userId: string; memberId: string; cookie: string };

interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  emoji: string | null;
  color: string | null;
  sortOrder: number;
  isSystem: boolean;
  status: string;
  children: CategoryNode[];
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

async function listCategories(cookie: string, query = ""): Promise<CategoryNode[]> {
  const res = await req(`/expense-categories?familyId=${familyId}${query}`, {}, cookie);
  const body = (await res.json()) as { categories: CategoryNode[] };
  return body.categories;
}

beforeEach(() => {
  ({ env, sqlite } = createTestEnv());
  const ownerUser = seedUser(sqlite);
  familyId = seedFamily(sqlite, ownerUser.id).id;
  owner = seedActor(sqlite, familyId, "owner");
  member = seedActor(sqlite, familyId, "member");
});

describe("GET /expense-categories", () => {
  it("requires a session", async () => {
    const res = await req(`/expense-categories?familyId=${familyId}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("requires familyId", async () => {
    const res = await req("/expense-categories", {}, owner.cookie);
    expect(res.status).toBe(400);
  });

  it("404s for a family the user does not belong to", async () => {
    const stranger = seedUser(sqlite);
    const cookie = seedSession(sqlite, stranger.id);
    const res = await req(`/expense-categories?familyId=${familyId}`, {}, cookie);
    expect(res.status).toBe(404);
  });

  it("returns an empty list before bootstrap", async () => {
    expect(await listCategories(owner.cookie)).toEqual([]);
  });

  it("returns a ready-to-render two-level tree after bootstrap", async () => {
    await ensureExpenseSetup(getDb(env), familyId);
    const categories = await listCategories(owner.cookie);

    expect(categories.length).toBeGreaterThan(5);
    const food = categories.find((c) => c.slug === "food")!;
    expect(food.parentId).toBeNull();
    expect(food.emoji).toBe("🍔");
    expect(food.children.map((ch) => ch.slug)).toContain("food-groceries");
    // Depth 2: no grandchildren anywhere in the payload.
    for (const cat of categories) {
      for (const child of cat.children) {
        expect(child.parentId).toBe(cat.id);
        expect((child as unknown as { children?: unknown }).children).toBeUndefined();
      }
    }
  });

  it("orders categories by sortOrder", async () => {
    await ensureExpenseSetup(getDb(env), familyId);
    const categories = await listCategories(owner.cookie);
    const orders = categories.map((c) => c.sortOrder);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it("hides archived categories unless asked", async () => {
    const archived = seedExpenseCategory(sqlite, {
      familyId,
      slug: "old",
      status: "archived",
    });

    expect((await listCategories(owner.cookie)).map((c) => c.id)).not.toContain(
      archived.id,
    );
    expect(
      (await listCategories(owner.cookie, "&includeArchived=1")).map((c) => c.id),
    ).toContain(archived.id);
  });

  it("never leaks another family's categories", async () => {
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    const foreign = seedExpenseCategory(sqlite, { familyId: otherFamily, slug: "food" });

    seedExpenseCategory(sqlite, { familyId, slug: "food" });
    const ids = (await listCategories(owner.cookie)).map((c) => c.id);
    expect(ids).not.toContain(foreign.id);
  });
});

describe("POST /expense-categories", () => {
  it("creates a top-level category with a generated slug", async () => {
    const res = await req(
      "/expense-categories",
      {
        method: "POST",
        body: JSON.stringify({ familyId, name: "Pet Care", emoji: "🐕", color: "teal" }),
      },
      member.cookie,
    );

    expect(res.status).toBe(201);
    const { category } = (await res.json()) as { category: CategoryNode };
    expect(category.slug).toBe("pet-care");
    expect(category.parentId).toBeNull();
    expect(category.isSystem).toBe(false);
    expect(category.status).toBe("active");
  });

  it("creates a subcategory with a parent-prefixed slug", async () => {
    const parent = seedExpenseCategory(sqlite, { familyId, slug: "food", name: "Food" });

    const res = await req(
      "/expense-categories",
      {
        method: "POST",
        body: JSON.stringify({ familyId, name: "Bakery", parentId: parent.id }),
      },
      owner.cookie,
    );

    expect(res.status).toBe(201);
    const { category } = (await res.json()) as { category: CategoryNode };
    expect(category.parentId).toBe(parent.id);
    expect(category.slug).toBe("food-bakery");
  });

  it("de-duplicates slugs within a family", async () => {
    seedExpenseCategory(sqlite, { familyId, slug: "pet-care" });

    const res = await req(
      "/expense-categories",
      { method: "POST", body: JSON.stringify({ familyId, name: "Pet Care" }) },
      owner.cookie,
    );

    const { category } = (await res.json()) as { category: CategoryNode };
    expect(category.slug).toBe("pet-care-2");
  });

  it("rejects a subcategory of a subcategory (max depth 2)", async () => {
    const parent = seedExpenseCategory(sqlite, { familyId, slug: "food" });
    const child = seedExpenseCategory(sqlite, {
      familyId,
      slug: "food-coffee",
      parentId: parent.id,
    });

    const res = await req(
      "/expense-categories",
      {
        method: "POST",
        body: JSON.stringify({ familyId, name: "Espresso", parentId: child.id }),
      },
      owner.cookie,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "max_category_depth" });
  });

  it("rejects a parent from another family", async () => {
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    const foreignParent = seedExpenseCategory(sqlite, {
      familyId: otherFamily,
      slug: "food",
    });

    const res = await req(
      "/expense-categories",
      {
        method: "POST",
        body: JSON.stringify({ familyId, name: "Sneaky", parentId: foreignParent.id }),
      },
      owner.cookie,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_parent_category" });
  });

  it("rejects an unknown parent", async () => {
    const res = await req(
      "/expense-categories",
      {
        method: "POST",
        body: JSON.stringify({ familyId, name: "Orphan", parentId: "does-not-exist" }),
      },
      owner.cookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_parent_category" });
  });

  it("rejects a subcategory under an archived parent", async () => {
    const parent = seedExpenseCategory(sqlite, {
      familyId,
      slug: "food",
      status: "archived",
    });

    const res = await req(
      "/expense-categories",
      {
        method: "POST",
        body: JSON.stringify({ familyId, name: "Bakery", parentId: parent.id }),
      },
      owner.cookie,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "parent_archived" });
  });

  it("rejects invalid payloads with the house error shape", async () => {
    const cases = [
      { familyId },
      { familyId, name: "" },
      { familyId, name: "x".repeat(61) },
      { familyId, name: "Ok", color: "chartreuse" },
      { familyId, name: "Ok", sortOrder: -1 },
      { familyId, name: "Ok", sortOrder: 1.5 },
      { name: "No family" },
    ];

    for (const body of cases) {
      const res = await req(
        "/expense-categories",
        { method: "POST", body: JSON.stringify(body) },
        owner.cookie,
      );
      expect(res.status, JSON.stringify(body)).toBe(400);
      const json = (await res.json()) as { error: string; issues?: unknown[] };
      expect(json.error).toBe("validation_error");
      expect(Array.isArray(json.issues)).toBe(true);
    }
  });

  it("requires a session", async () => {
    const res = await req("/expense-categories", {
      method: "POST",
      body: JSON.stringify({ familyId, name: "Nope" }),
    });
    expect(res.status).toBe(401);
  });

  it("refuses to create in a family the user is not part of", async () => {
    const stranger = seedUser(sqlite);
    const cookie = seedSession(sqlite, stranger.id);
    const res = await req(
      "/expense-categories",
      { method: "POST", body: JSON.stringify({ familyId, name: "Nope" }) },
      cookie,
    );
    expect(res.status).toBe(404);
  });
});

describe("PATCH /expense-categories/:id", () => {
  it("renames without changing the slug", async () => {
    const cat = seedExpenseCategory(sqlite, { familyId, slug: "food", name: "Food" });

    const res = await req(
      `/expense-categories/${cat.id}`,
      { method: "PATCH", body: JSON.stringify({ name: "Food & Drink", emoji: "🍽️" }) },
      member.cookie,
    );

    expect(res.status).toBe(200);
    const { category } = (await res.json()) as { category: CategoryNode };
    expect(category.name).toBe("Food & Drink");
    expect(category.emoji).toBe("🍽️");
    expect(category.slug).toBe("food"); // identity is stable
  });

  it("lets a family customise a seeded system category", async () => {
    await ensureExpenseSetup(getDb(env), familyId);
    const food = (await listCategories(owner.cookie)).find((c) => c.slug === "food")!;
    expect(food.isSystem).toBe(true);

    const res = await req(
      `/expense-categories/${food.id}`,
      { method: "PATCH", body: JSON.stringify({ name: "Groceries & Dining" }) },
      owner.cookie,
    );
    expect(res.status).toBe(200);
  });

  it("archives a category and cascades to its subcategories", async () => {
    const parent = seedExpenseCategory(sqlite, { familyId, slug: "food" });
    const child = seedExpenseCategory(sqlite, {
      familyId,
      slug: "food-coffee",
      parentId: parent.id,
    });

    const res = await req(
      `/expense-categories/${parent.id}`,
      { method: "PATCH", body: JSON.stringify({ status: "archived" }) },
      owner.cookie,
    );
    expect(res.status).toBe(200);

    const childRow = sqlite
      .prepare("SELECT status FROM expense_categories WHERE id = ?")
      .get(child.id) as { status: string };
    expect(childRow.status).toBe("archived");

    // And neither appears in the default (active-only) listing.
    const active = await listCategories(owner.cookie);
    expect(active.map((c) => c.id)).not.toContain(parent.id);
  });

  it("refuses to restore a subcategory while its parent is archived", async () => {
    const parent = seedExpenseCategory(sqlite, {
      familyId,
      slug: "food",
      status: "archived",
    });
    const child = seedExpenseCategory(sqlite, {
      familyId,
      slug: "food-coffee",
      parentId: parent.id,
      status: "archived",
    });

    const res = await req(
      `/expense-categories/${child.id}`,
      { method: "PATCH", body: JSON.stringify({ status: "active" }) },
      owner.cookie,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "parent_archived" });
  });

  it("restores a category", async () => {
    const cat = seedExpenseCategory(sqlite, {
      familyId,
      slug: "food",
      status: "archived",
    });

    const res = await req(
      `/expense-categories/${cat.id}`,
      { method: "PATCH", body: JSON.stringify({ status: "active" }) },
      owner.cookie,
    );
    expect(res.status).toBe(200);
    expect((await listCategories(owner.cookie)).map((c) => c.id)).toContain(cat.id);
  });

  it("ignores an attempt to re-parent (parentId is not an updatable field)", async () => {
    const parentA = seedExpenseCategory(sqlite, { familyId, slug: "food" });
    const parentB = seedExpenseCategory(sqlite, { familyId, slug: "home" });
    const child = seedExpenseCategory(sqlite, {
      familyId,
      slug: "food-coffee",
      parentId: parentA.id,
    });

    await req(
      `/expense-categories/${child.id}`,
      { method: "PATCH", body: JSON.stringify({ parentId: parentB.id }) },
      owner.cookie,
    );

    const row = sqlite
      .prepare("SELECT parent_id FROM expense_categories WHERE id = ?")
      .get(child.id) as { parent_id: string };
    expect(row.parent_id).toBe(parentA.id);
  });

  it("404s for an unknown category", async () => {
    const res = await req(
      "/expense-categories/nope",
      { method: "PATCH", body: JSON.stringify({ name: "x" }) },
      owner.cookie,
    );
    expect(res.status).toBe(404);
  });

  it("404s when the category belongs to another family", async () => {
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    const foreign = seedExpenseCategory(sqlite, { familyId: otherFamily, slug: "food" });

    const res = await req(
      `/expense-categories/${foreign.id}`,
      { method: "PATCH", body: JSON.stringify({ name: "Hijacked" }) },
      owner.cookie,
    );
    expect(res.status).toBe(404);
  });

  it("rejects invalid updates", async () => {
    const cat = seedExpenseCategory(sqlite, { familyId, slug: "food" });
    for (const body of [{ status: "deleted" }, { name: "" }, { color: "neon" }]) {
      const res = await req(
        `/expense-categories/${cat.id}`,
        { method: "PATCH", body: JSON.stringify(body) },
        owner.cookie,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("validation_error");
    }
  });
});

describe("POST /expense-categories/reorder", () => {
  it("persists a new order", async () => {
    const a = seedExpenseCategory(sqlite, { familyId, slug: "a" });
    const b = seedExpenseCategory(sqlite, { familyId, slug: "b" });

    const res = await req(
      "/expense-categories/reorder",
      {
        method: "POST",
        body: JSON.stringify({
          familyId,
          items: [
            { id: b.id, sortOrder: 0 },
            { id: a.id, sortOrder: 10 },
          ],
        }),
      },
      member.cookie,
    );

    expect(res.status).toBe(200);
    const categories = await listCategories(owner.cookie);
    expect(categories.map((c) => c.slug)).toEqual(["b", "a"]);
  });

  it("rejects ids from another family", async () => {
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    const foreign = seedExpenseCategory(sqlite, { familyId: otherFamily, slug: "food" });

    const res = await req(
      "/expense-categories/reorder",
      {
        method: "POST",
        body: JSON.stringify({ familyId, items: [{ id: foreign.id, sortOrder: 0 }] }),
      },
      owner.cookie,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_category_ids" });
  });

  it("rejects an empty batch", async () => {
    const res = await req(
      "/expense-categories/reorder",
      { method: "POST", body: JSON.stringify({ familyId, items: [] }) },
      owner.cookie,
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /expense-categories/:id", () => {
  it("deletes an unused custom category", async () => {
    const res0 = await req(
      "/expense-categories",
      { method: "POST", body: JSON.stringify({ familyId, name: "Typo" }) },
      owner.cookie,
    );
    const { category } = (await res0.json()) as { category: CategoryNode };

    const res = await req(
      `/expense-categories/${category.id}`,
      { method: "DELETE" },
      owner.cookie,
    );
    expect(res.status).toBe(200);
    expect((await listCategories(owner.cookie)).map((c) => c.id)).not.toContain(
      category.id,
    );
  });

  it("refuses to delete a seeded system category", async () => {
    await ensureExpenseSetup(getDb(env), familyId);
    const food = (await listCategories(owner.cookie)).find((c) => c.slug === "food")!;

    const res = await req(`/expense-categories/${food.id}`, { method: "DELETE" }, owner.cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "cannot_delete_system_category" });
  });

  it("refuses to delete a category that still has subcategories", async () => {
    const parent = seedExpenseCategory(sqlite, { familyId, slug: "food" });
    seedExpenseCategory(sqlite, { familyId, slug: "food-coffee", parentId: parent.id });

    const res = await req(
      `/expense-categories/${parent.id}`,
      { method: "DELETE" },
      owner.cookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "category_has_children" });
  });

  it("PRESERVES HISTORY: refuses to delete a category with expenses", async () => {
    const cat = seedExpenseCategory(sqlite, { familyId, slug: "food" });
    seedExpense(sqlite, {
      familyId,
      createdByUserId: owner.userId,
      categoryId: cat.id,
    });

    const res = await req(`/expense-categories/${cat.id}`, { method: "DELETE" }, owner.cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "category_in_use" });

    // The row — and therefore the expense's category — is still resolvable.
    const still = sqlite
      .prepare("SELECT id FROM expense_categories WHERE id = ?")
      .get(cat.id);
    expect(still).toBeDefined();
  });

  it("PRESERVES HISTORY: refuses to delete a subcategory used by an expense", async () => {
    const parent = seedExpenseCategory(sqlite, { familyId, slug: "food" });
    const child = seedExpenseCategory(sqlite, {
      familyId,
      slug: "food-coffee",
      parentId: parent.id,
    });
    seedExpense(sqlite, {
      familyId,
      createdByUserId: owner.userId,
      categoryId: parent.id,
      subcategoryId: child.id,
    });

    const res = await req(
      `/expense-categories/${child.id}`,
      { method: "DELETE" },
      owner.cookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "category_in_use" });
  });

  it("archived categories with history remain resolvable", async () => {
    const cat = seedExpenseCategory(sqlite, { familyId, slug: "food", name: "Food" });
    seedExpense(sqlite, { familyId, createdByUserId: owner.userId, categoryId: cat.id });

    await req(
      `/expense-categories/${cat.id}`,
      { method: "PATCH", body: JSON.stringify({ status: "archived" }) },
      owner.cookie,
    );

    // Not offered for new expenses…
    expect((await listCategories(owner.cookie)).map((c) => c.id)).not.toContain(cat.id);
    // …but still there for the historical expense to resolve against.
    const archived = await listCategories(owner.cookie, "&includeArchived=1");
    expect(archived.find((c) => c.id === cat.id)?.name).toBe("Food");
  });

  it("404s for another family's category", async () => {
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    const foreign = seedExpenseCategory(sqlite, { familyId: otherFamily, slug: "food" });

    const res = await req(
      `/expense-categories/${foreign.id}`,
      { method: "DELETE" },
      owner.cookie,
    );
    expect(res.status).toBe(404);
  });
});

describe("unknown expense-category routes", () => {
  it("returns a JSON 404, never the SPA shell", async () => {
    const res = await req("/expense-categories/deep/unknown/path", {}, owner.cookie);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
