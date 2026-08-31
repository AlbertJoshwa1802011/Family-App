/**
 * Wishlist affordability, sub-categories, and the assistant's guard rails.
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
  const alice = seedActor(sqlite, family.id, "member");
  const bob = seedActor(sqlite, family.id, "member");
  const admin = seedActor(sqlite, family.id, "owner");
  return { env, sqlite, familyId: family.id, alice, bob, admin };
}

const item = (familyId: string, over: Record<string, unknown> = {}) => ({
  familyId,
  name: "Laptop",
  estimatedCostMinor: 1200_00,
  currency: "USD",
  priority: 2,
  ...over,
});

interface ListBody {
  items: {
    id: string;
    name: string;
    monthsToAfford: number | null;
    affordableFrom: string | null;
  }[];
  totalWantedMinor: number;
}

describe("wishlist", () => {
  it("creates an item, private by default", async () => {
    const { env, familyId, alice } = setup();
    const res = await req(env, "POST", "/api/wishlist", alice.cookie, item(familyId));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: { visibility: string } };
    expect(body.item.visibility).toBe("private");
  });

  it("rejects a mismatched currency", async () => {
    const { env, familyId, alice } = setup();
    const res = await req(env, "POST", "/api/wishlist", alice.cookie, item(familyId, { currency: "GBP" }));
    expect(res.status).toBe(400);
  });

  it("rejects an out-of-range priority", async () => {
    const { env, familyId, alice } = setup();
    expect((await req(env, "POST", "/api/wishlist", alice.cookie, item(familyId, { priority: 9 }))).status).toBe(400);
  });

  it("hides a private item from other members, owner included", async () => {
    const { env, familyId, alice, bob, admin } = setup();
    await req(env, "POST", "/api/wishlist", alice.cookie, item(familyId));
    for (const actor of [bob, admin]) {
      const body = (await (
        await req(env, "GET", `/api/wishlist?familyId=${familyId}`, actor.cookie)
      ).json()) as ListBody;
      expect(body.items).toHaveLength(0);
    }
  });

  it("computes months to afford from the monthly surplus", async () => {
    const { env, familyId, alice } = setup();
    await req(env, "POST", "/api/wishlist", alice.cookie, item(familyId));

    // 1200.00 at 300.00/month → 4 months.
    const body = (await (
      await req(env, "GET", `/api/wishlist?familyId=${familyId}&surplusMinor=30000`, alice.cookie)
    ).json()) as ListBody;
    expect(body.items[0].monthsToAfford).toBe(4);
    expect(body.items[0].affordableFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("compounds affordability down the priority order", async () => {
    const { env, familyId, alice } = setup();
    await req(env, "POST", "/api/wishlist", alice.cookie, item(familyId, { name: "Phone", estimatedCostMinor: 300_00, priority: 1 }));
    await req(env, "POST", "/api/wishlist", alice.cookie, item(familyId, { name: "Laptop", estimatedCostMinor: 600_00, priority: 2 }));

    const body = (await (
      await req(env, "GET", `/api/wishlist?familyId=${familyId}&surplusMinor=30000`, alice.cookie)
    ).json()) as ListBody;

    // Phone first (1 month), then the laptop only after the phone is paid for.
    expect(body.items[0].name).toBe("Phone");
    expect(body.items[0].monthsToAfford).toBe(1);
    expect(body.items[1].name).toBe("Laptop");
    expect(body.items[1].monthsToAfford).toBe(3); // (300+600)/300
    expect(body.totalWantedMinor).toBe(90000);
  });

  it("says 'never at this rate' when nothing is being saved", async () => {
    const { env, familyId, alice } = setup();
    await req(env, "POST", "/api/wishlist", alice.cookie, item(familyId));
    const body = (await (
      await req(env, "GET", `/api/wishlist?familyId=${familyId}&surplusMinor=0`, alice.cookie)
    ).json()) as ListBody;
    expect(body.items[0].monthsToAfford).toBeNull();
    expect(body.items[0].affordableFrom).toBeNull();
  });

  it("drops purchased items out of the savings plan", async () => {
    const { env, familyId, alice } = setup();
    const created = (await (
      await req(env, "POST", "/api/wishlist", alice.cookie, item(familyId))
    ).json()) as { item: { id: string } };
    await req(env, "PATCH", `/api/wishlist/${created.item.id}`, alice.cookie, { status: "purchased" });

    const body = (await (
      await req(env, "GET", `/api/wishlist?familyId=${familyId}&surplusMinor=30000`, alice.cookie)
    ).json()) as ListBody;
    expect(body.items[0].monthsToAfford).toBeNull();
    expect(body.totalWantedMinor).toBe(0);
  });

  it("lets only the owner edit", async () => {
    const { env, familyId, alice, bob } = setup();
    const created = (await (
      await req(env, "POST", "/api/wishlist", alice.cookie, item(familyId, { visibility: "family" }))
    ).json()) as { item: { id: string } };
    expect((await req(env, "PATCH", `/api/wishlist/${created.item.id}`, bob.cookie, { priority: 1 })).status).toBe(403);
  });
});

describe("expense sub-categories", () => {
  async function rootId(env: Env, familyId: string, cookie: string): Promise<string> {
    const body = (await (
      await req(env, "GET", `/api/expenses/categories?familyId=${familyId}`, cookie)
    ).json()) as { categories: { id: string; name: string }[] };
    return body.categories.find((c) => c.name === "Groceries")!.id;
  }

  it("creates a child under a built-in category", async () => {
    const { env, familyId, admin } = setup();
    const parent = await rootId(env, familyId, admin.cookie);

    const res = await req(env, "POST", "/api/expenses/categories", admin.cookie, {
      familyId,
      name: "Vegetables",
      parentCategoryId: parent,
    });
    expect(res.status).toBe(201);
  });

  it("returns a two-level tree alongside the flat list", async () => {
    const { env, familyId, admin } = setup();
    const parent = await rootId(env, familyId, admin.cookie);
    await req(env, "POST", "/api/expenses/categories", admin.cookie, {
      familyId,
      name: "Vegetables",
      parentCategoryId: parent,
    });

    const body = (await (
      await req(env, "GET", `/api/expenses/categories?familyId=${familyId}`, admin.cookie)
    ).json()) as {
      tree: { id: string; name: string; children: { name: string }[] }[];
    };
    const groceries = body.tree.find((t) => t.id === parent)!;
    expect(groceries.children.map((c) => c.name)).toContain("Vegetables");
  });

  it("refuses a third level of nesting", async () => {
    const { env, familyId, admin } = setup();
    const parent = await rootId(env, familyId, admin.cookie);
    const child = (await (
      await req(env, "POST", "/api/expenses/categories", admin.cookie, {
        familyId,
        name: "Vegetables",
        parentCategoryId: parent,
      })
    ).json()) as { category: { id: string } };

    const res = await req(env, "POST", "/api/expenses/categories", admin.cookie, {
      familyId,
      name: "Root veg",
      parentCategoryId: child.category.id,
    });
    expect(res.status).toBe(400);
  });

  it("refuses an unknown parent", async () => {
    const { env, familyId, admin } = setup();
    const res = await req(env, "POST", "/api/expenses/categories", admin.cookie, {
      familyId,
      name: "Orphan",
      parentCategoryId: "does-not-exist",
    });
    expect(res.status).toBe(400);
  });

  it("allows the same child name under different parents", async () => {
    const { env, familyId, admin } = setup();
    const body = (await (
      await req(env, "GET", `/api/expenses/categories?familyId=${familyId}`, admin.cookie)
    ).json()) as { categories: { id: string; name: string }[] };
    const groceries = body.categories.find((c) => c.name === "Groceries")!.id;
    const transport = body.categories.find((c) => c.name === "Transport")!.id;

    expect((await req(env, "POST", "/api/expenses/categories", admin.cookie, { familyId, name: "Monthly", parentCategoryId: groceries })).status).toBe(201);
    expect((await req(env, "POST", "/api/expenses/categories", admin.cookie, { familyId, name: "Monthly", parentCategoryId: transport })).status).toBe(201);
  });
});

describe("assistant", () => {
  it("reports itself unconfigured without an API key", async () => {
    const { env, alice } = setup();
    const body = (await (
      await req(env, "GET", "/api/assistant/status", alice.cookie)
    ).json()) as { configured: boolean };
    expect(body.configured).toBe(false);
  });

  it("returns 501 with guidance rather than failing obscurely", async () => {
    const { env, familyId, alice } = setup();
    const res = await req(env, "POST", "/api/assistant/chat", alice.cookie, {
      familyId,
      message: "I ate noodles for 70",
    });
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("not_configured");
    expect(body.message).toContain("GEMINI_API_KEY");
  });

  it("checks family membership before doing anything", async () => {
    const { env, familyId, sqlite } = setup();
    const other = seedFamily(sqlite, seedUser(sqlite).id, "Other");
    const outsider = seedActor(sqlite, other.id, "owner");
    const res = await req(env, "POST", "/api/assistant/chat", outsider.cookie, {
      familyId,
      message: "hello",
    });
    // Membership is rejected before the missing-key check.
    expect(res.status).toBe(404);
  });

  it("validates the message", async () => {
    const { env, familyId, alice } = setup();
    expect((await req(env, "POST", "/api/assistant/chat", alice.cookie, { familyId, message: "" })).status).toBe(400);
    expect((await req(env, "POST", "/api/assistant/chat", alice.cookie, { familyId })).status).toBe(400);
  });

  it("requires a session", async () => {
    expect((await app.request("/api/assistant/chat", { method: "POST" })).status).toBe(401);
    expect((await app.request("/api/assistant/status")).status).toBe(401);
  });
});
