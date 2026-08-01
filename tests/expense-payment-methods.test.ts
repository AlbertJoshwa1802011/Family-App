/**
 * Payment-method API contract. Same guarantees as categories: family scoping,
 * archive-don't-delete when history exists, and a `kind` that stays useful for
 * analytics no matter how the family renames things.
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
  seedSession,
  seedUser,
} from "./helpers/testEnv";
import {
  DEFAULT_PAYMENT_METHODS,
  ensureExpenseSetup,
} from "../worker/lib/expenses/defaults";

let env: Env;
let sqlite: DatabaseSync;
let familyId: string;
let owner: { userId: string; cookie: string };
let member: { userId: string; cookie: string };

interface PaymentMethod {
  id: string;
  name: string;
  slug: string;
  kind: string;
  emoji: string | null;
  sortOrder: number;
  isSystem: boolean;
  status: string;
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

async function list(cookie: string, query = ""): Promise<PaymentMethod[]> {
  const res = await req(
    `/expense-payment-methods?familyId=${familyId}${query}`,
    {},
    cookie,
  );
  return ((await res.json()) as { paymentMethods: PaymentMethod[] }).paymentMethods;
}

/** Create a family-scoped payment method through the API and return it. */
async function create(body: Record<string, unknown>, cookie: string) {
  const res = await req(
    "/expense-payment-methods",
    { method: "POST", body: JSON.stringify({ familyId, ...body }) },
    cookie,
  );
  return {
    status: res.status,
    body: (await res.json()) as { paymentMethod?: PaymentMethod; error?: string },
  };
}

beforeEach(() => {
  ({ env, sqlite } = createTestEnv());
  const ownerUser = seedUser(sqlite);
  familyId = seedFamily(sqlite, ownerUser.id).id;
  owner = seedActor(sqlite, familyId, "owner");
  member = seedActor(sqlite, familyId, "member");
});

describe("GET /expense-payment-methods", () => {
  it("requires a session", async () => {
    const res = await req(`/expense-payment-methods?familyId=${familyId}`);
    expect(res.status).toBe(401);
  });

  it("requires familyId", async () => {
    const res = await req("/expense-payment-methods", {}, owner.cookie);
    expect(res.status).toBe(400);
  });

  it("404s for a non-member", async () => {
    const stranger = seedUser(sqlite);
    const res = await req(
      `/expense-payment-methods?familyId=${familyId}`,
      {},
      seedSession(sqlite, stranger.id),
    );
    expect(res.status).toBe(404);
  });

  it("returns the seeded methods in order", async () => {
    await ensureExpenseSetup(getDb(env), familyId);
    const methods = await list(owner.cookie);

    expect(methods).toHaveLength(DEFAULT_PAYMENT_METHODS.length);
    expect(methods.map((m) => m.slug)).toContain("upi");
    expect(methods.every((m) => m.isSystem)).toBe(true);

    const orders = methods.map((m) => m.sortOrder);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it("keeps a usable kind on every seeded method", async () => {
    await ensureExpenseSetup(getDb(env), familyId);
    const kinds = new Set((await list(owner.cookie)).map((m) => m.kind));
    for (const kind of kinds) {
      expect(["cash", "card", "bank", "upi", "wallet", "other"]).toContain(kind);
    }
  });

  it("hides archived methods unless asked", async () => {
    const { body } = await create({ name: "Old Card" }, owner.cookie);
    const id = body.paymentMethod!.id;

    await req(
      `/expense-payment-methods/${id}`,
      { method: "PATCH", body: JSON.stringify({ status: "archived" }) },
      owner.cookie,
    );

    expect((await list(owner.cookie)).map((m) => m.id)).not.toContain(id);
    expect((await list(owner.cookie, "&includeArchived=1")).map((m) => m.id)).toContain(id);
  });

  it("never leaks another family's methods", async () => {
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    await ensureExpenseSetup(getDb(env), otherFamily);
    await ensureExpenseSetup(getDb(env), familyId);

    const mine = await list(owner.cookie);
    const foreignIds = sqlite
      .prepare("SELECT id FROM expense_payment_methods WHERE family_id = ?")
      .all(otherFamily)
      .map((r) => (r as { id: string }).id);

    for (const id of mine.map((m) => m.id)) {
      expect(foreignIds).not.toContain(id);
    }
  });
});

describe("POST /expense-payment-methods", () => {
  it("creates a custom method", async () => {
    const { status, body } = await create(
      { name: "PhonePe", emoji: "📱", kind: "wallet" },
      member.cookie,
    );

    expect(status).toBe(201);
    expect(body.paymentMethod!.slug).toBe("phonepe");
    expect(body.paymentMethod!.kind).toBe("wallet");
    expect(body.paymentMethod!.isSystem).toBe(false);
  });

  it("defaults kind to other", async () => {
    const { body } = await create({ name: "Store Credit" }, owner.cookie);
    expect(body.paymentMethod!.kind).toBe("other");
  });

  it("de-duplicates slugs within a family", async () => {
    await create({ name: "PhonePe" }, owner.cookie);
    const { body } = await create({ name: "PhonePe" }, owner.cookie);
    expect(body.paymentMethod!.slug).toBe("phonepe-2");
  });

  it("allows the same slug in a different family", async () => {
    await create({ name: "PhonePe" }, owner.cookie);

    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    const otherOwner = seedActor(sqlite, otherFamily, "owner");

    const res = await req(
      "/expense-payment-methods",
      {
        method: "POST",
        body: JSON.stringify({ familyId: otherFamily, name: "PhonePe" }),
      },
      otherOwner.cookie,
    );
    expect(res.status).toBe(201);
    const { paymentMethod } = (await res.json()) as { paymentMethod: PaymentMethod };
    expect(paymentMethod.slug).toBe("phonepe");
  });

  it("rejects invalid payloads", async () => {
    const cases = [
      {},
      { name: "" },
      { name: "x".repeat(61) },
      { name: "Ok", kind: "crypto" },
      { name: "Ok", sortOrder: -5 },
    ];

    for (const body of cases) {
      const { status, body: json } = await create(body, owner.cookie);
      expect(status, JSON.stringify(body)).toBe(400);
      expect(json.error).toBe("validation_error");
    }
  });

  it("refuses creation for a non-member", async () => {
    const stranger = seedUser(sqlite);
    const res = await req(
      "/expense-payment-methods",
      { method: "POST", body: JSON.stringify({ familyId, name: "Nope" }) },
      seedSession(sqlite, stranger.id),
    );
    expect(res.status).toBe(404);
  });

  it("requires a session", async () => {
    const res = await req("/expense-payment-methods", {
      method: "POST",
      body: JSON.stringify({ familyId, name: "Nope" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("PATCH /expense-payment-methods/:id", () => {
  it("renames and re-kinds without changing the slug", async () => {
    const { body } = await create({ name: "Card" }, owner.cookie);
    const id = body.paymentMethod!.id;

    const res = await req(
      `/expense-payment-methods/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ name: "HDFC Card", kind: "card", emoji: "💳" }),
      },
      member.cookie,
    );

    expect(res.status).toBe(200);
    const updated = (await res.json()) as { paymentMethod: PaymentMethod };
    expect(updated.paymentMethod.name).toBe("HDFC Card");
    expect(updated.paymentMethod.kind).toBe("card");
    expect(updated.paymentMethod.slug).toBe("card");
  });

  it("lets a family customise a seeded method", async () => {
    await ensureExpenseSetup(getDb(env), familyId);
    const cash = (await list(owner.cookie)).find((m) => m.slug === "cash")!;

    const res = await req(
      `/expense-payment-methods/${cash.id}`,
      { method: "PATCH", body: JSON.stringify({ name: "Pocket money" }) },
      owner.cookie,
    );
    expect(res.status).toBe(200);
  });

  it("archives and restores", async () => {
    const { body } = await create({ name: "Old Wallet" }, owner.cookie);
    const id = body.paymentMethod!.id;

    await req(
      `/expense-payment-methods/${id}`,
      { method: "PATCH", body: JSON.stringify({ status: "archived" }) },
      owner.cookie,
    );
    expect((await list(owner.cookie)).map((m) => m.id)).not.toContain(id);

    await req(
      `/expense-payment-methods/${id}`,
      { method: "PATCH", body: JSON.stringify({ status: "active" }) },
      owner.cookie,
    );
    expect((await list(owner.cookie)).map((m) => m.id)).toContain(id);
  });

  it("404s for an unknown id and for another family's method", async () => {
    expect(
      (
        await req(
          "/expense-payment-methods/nope",
          { method: "PATCH", body: JSON.stringify({ name: "x" }) },
          owner.cookie,
        )
      ).status,
    ).toBe(404);

    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    await ensureExpenseSetup(getDb(env), otherFamily);
    const foreignId = (
      sqlite
        .prepare("SELECT id FROM expense_payment_methods WHERE family_id = ? LIMIT 1")
        .get(otherFamily) as { id: string }
    ).id;

    const res = await req(
      `/expense-payment-methods/${foreignId}`,
      { method: "PATCH", body: JSON.stringify({ name: "Hijacked" }) },
      owner.cookie,
    );
    expect(res.status).toBe(404);
  });

  it("rejects invalid updates", async () => {
    const { body } = await create({ name: "Card" }, owner.cookie);
    for (const patch of [{ kind: "gold" }, { status: "deleted" }, { name: "" }]) {
      const res = await req(
        `/expense-payment-methods/${body.paymentMethod!.id}`,
        { method: "PATCH", body: JSON.stringify(patch) },
        owner.cookie,
      );
      expect(res.status).toBe(400);
    }
  });
});

describe("POST /expense-payment-methods/reorder", () => {
  it("persists a new order", async () => {
    const a = (await create({ name: "Alpha" }, owner.cookie)).body.paymentMethod!;
    const b = (await create({ name: "Beta" }, owner.cookie)).body.paymentMethod!;

    const res = await req(
      "/expense-payment-methods/reorder",
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
    expect((await list(owner.cookie)).map((m) => m.name)).toEqual(["Beta", "Alpha"]);
  });

  it("rejects ids from another family", async () => {
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    await ensureExpenseSetup(getDb(env), otherFamily);
    const foreignId = (
      sqlite
        .prepare("SELECT id FROM expense_payment_methods WHERE family_id = ? LIMIT 1")
        .get(otherFamily) as { id: string }
    ).id;

    const res = await req(
      "/expense-payment-methods/reorder",
      {
        method: "POST",
        body: JSON.stringify({ familyId, items: [{ id: foreignId, sortOrder: 0 }] }),
      },
      owner.cookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_payment_method_ids" });
  });
});

describe("DELETE /expense-payment-methods/:id", () => {
  it("deletes an unused custom method", async () => {
    const { body } = await create({ name: "Typo" }, owner.cookie);
    const res = await req(
      `/expense-payment-methods/${body.paymentMethod!.id}`,
      { method: "DELETE" },
      owner.cookie,
    );
    expect(res.status).toBe(200);
  });

  it("refuses to delete a seeded method", async () => {
    await ensureExpenseSetup(getDb(env), familyId);
    const cash = (await list(owner.cookie)).find((m) => m.slug === "cash")!;

    const res = await req(
      `/expense-payment-methods/${cash.id}`,
      { method: "DELETE" },
      owner.cookie,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "cannot_delete_system_payment_method" });
  });

  it("PRESERVES HISTORY: refuses to delete a method used by an expense", async () => {
    const { body } = await create({ name: "Amex" }, owner.cookie);
    const methodId = body.paymentMethod!.id;
    const categoryId = seedExpenseCategory(sqlite, { familyId, slug: "food" }).id;

    seedExpense(sqlite, {
      familyId,
      createdByUserId: owner.userId,
      categoryId,
      paymentMethodId: methodId,
    });

    const res = await req(
      `/expense-payment-methods/${methodId}`,
      { method: "DELETE" },
      owner.cookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "payment_method_in_use" });

    // Still resolvable for that historical expense.
    expect(
      sqlite
        .prepare("SELECT id FROM expense_payment_methods WHERE id = ?")
        .get(methodId),
    ).toBeDefined();
  });

  it("404s for another family's method", async () => {
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    await ensureExpenseSetup(getDb(env), otherFamily);
    const foreignId = (
      sqlite
        .prepare("SELECT id FROM expense_payment_methods WHERE family_id = ? LIMIT 1")
        .get(otherFamily) as { id: string }
    ).id;

    const res = await req(
      `/expense-payment-methods/${foreignId}`,
      { method: "DELETE" },
      owner.cookie,
    );
    expect(res.status).toBe(404);
  });
});

describe("expense seeding is not duplicated by the API", () => {
  it("bootstrapping twice leaves exactly one set of methods", async () => {
    await req(
      "/expense-settings/bootstrap",
      { method: "POST", body: JSON.stringify({ familyId }) },
      owner.cookie,
    );
    await req(
      "/expense-settings/bootstrap",
      { method: "POST", body: JSON.stringify({ familyId }) },
      member.cookie,
    );

    expect(await list(owner.cookie)).toHaveLength(DEFAULT_PAYMENT_METHODS.length);
  });
});
