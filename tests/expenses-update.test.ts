/**
 * PATCH /expenses/:id.
 *
 * The hard rule here (spec §27): changing category must never leave a stale,
 * mismatched subcategory in place. And references are only re-validated when
 * they're actually part of the diff — an archived category must not lock
 * every other field of the historical expenses that already reference it.
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
let admin: { userId: string; memberId: string; cookie: string };
let member: { userId: string; memberId: string; cookie: string };
let other: { userId: string; memberId: string; cookie: string };
let food: string;
let restaurants: string;
let groceries: string;
let home: string;
let paymentMethodId: string;

interface ExpenseDetail {
  id: string;
  amountMinor: number;
  currency: string;
  categoryId: string | null;
  subcategoryId: string | null;
  paymentMethodId: string | null;
  merchant: string | null;
  merchantKey: string | null;
  notes: string | null;
  visibility: string;
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

async function patch(id: string, body: Record<string, unknown>, cookie: string) {
  const res = await req(`/expenses/${id}`, { method: "PATCH", body: JSON.stringify(body) }, cookie);
  const json = (await res.json()) as { expense?: ExpenseDetail; error?: string };
  return { status: res.status, ...json };
}

function seedOwnExpense(actor: { userId: string; memberId: string }, extra: Record<string, unknown> = {}) {
  return seedExpense(sqlite, {
    familyId,
    createdByUserId: actor.userId,
    categoryId: food,
    subcategoryId: restaurants,
    paymentMethodId,
    amountMinor: 10000,
    ...extra,
  }).id;
}

beforeEach(() => {
  ({ env, sqlite } = createTestEnv());
  const ownerUser = seedUser(sqlite);
  familyId = seedFamily(sqlite, ownerUser.id).id;
  owner = seedActor(sqlite, familyId, "owner");
  admin = seedActor(sqlite, familyId, "admin");
  member = seedActor(sqlite, familyId, "member");
  other = seedActor(sqlite, familyId, "member");

  food = seedExpenseCategory(sqlite, { familyId, slug: "food", name: "Food" }).id;
  restaurants = seedExpenseCategory(sqlite, {
    familyId,
    slug: "food-restaurants",
    name: "Restaurants",
    parentId: food,
  }).id;
  groceries = seedExpenseCategory(sqlite, {
    familyId,
    slug: "food-groceries",
    name: "Groceries",
    parentId: food,
  }).id;
  home = seedExpenseCategory(sqlite, { familyId, slug: "home", name: "Home" }).id;
  paymentMethodId = seedPaymentMethod(sqlite, { familyId, slug: "cash", kind: "cash" }).id;
});

describe("basic field updates", () => {
  it("updates amount using the expense's own currency", async () => {
    const id = seedOwnExpense(member, { currency: "USD" });
    const res = await patch(id, { amount: "12.34" }, member.cookie);
    expect(res.status).toBe(200);
    expect(res.expense!.amountMinor).toBe(1234);
    expect(res.expense!.currency).toBe("USD"); // unchanged
  });

  it("rejects an invalid amount on update", async () => {
    const id = seedOwnExpense(member);
    const res = await patch(id, { amount: "-5" }, member.cookie);
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_amount");
  });

  it("updates merchant and recomputes merchantKey", async () => {
    const id = seedOwnExpense(member);
    const res = await patch(id, { merchant: "  Trader Joe's  " }, member.cookie);
    expect(res.status).toBe(200);
    expect(res.expense!.merchant).toBe("Trader Joe's");
    expect(res.expense!.merchantKey).toBe("trader joe s");
  });

  it("clears merchant when set to null", async () => {
    const id = seedOwnExpense(member, { merchant: "KFC", merchantKey: "kfc" });
    const res = await patch(id, { merchant: null }, member.cookie);
    expect(res.status).toBe(200);
    expect(res.expense!.merchant).toBeNull();
    expect(res.expense!.merchantKey).toBeNull();
  });

  it("updates notes, spentOn, spentTime and visibility independently", async () => {
    const id = seedOwnExpense(member);
    const res = await patch(
      id,
      { notes: "reimbursed", spentOn: "2026-01-05", spentTime: "09:30", visibility: "private" },
      member.cookie,
    );
    expect(res.status).toBe(200);
    expect(res.expense).toMatchObject({
      notes: "reimbursed",
      spentOn: "2026-01-05",
      spentTime: "09:30",
      visibility: "private",
    });
  });

  it("leaves fields not included in the patch untouched", async () => {
    const id = seedOwnExpense(member, { merchant: "KFC", notes: "lunch" });
    const res = await patch(id, { notes: "dinner" }, member.cookie);
    expect(res.status).toBe(200);
    expect(res.expense!.merchant).toBe("KFC");
    expect(res.expense!.notes).toBe("dinner");
  });

  it("does not accept a currency field at all (immutable after creation)", async () => {
    const id = seedOwnExpense(member, { currency: "INR" });
    const res = await patch(id, { currency: "USD", amount: "10" } as Record<string, unknown>, member.cookie);
    // Zod strips unknown keys by default rather than erroring — assert the
    // currency silently did NOT change, which is the actual guarantee.
    expect(res.status).toBe(200);
    expect(res.expense!.currency).toBe("INR");
  });
});

describe("category change and subcategory auto-clear (spec §27)", () => {
  it("clears the subcategory when category changes without an explicit new one", async () => {
    const id = seedOwnExpense(member); // food / restaurants
    const res = await patch(id, { categoryId: home }, member.cookie);
    expect(res.status).toBe(200);
    expect(res.expense!.categoryId).toBe(home);
    expect(res.expense!.subcategoryId).toBeNull();
  });

  it("keeps a subcategory that's still valid under an unrelated field update", async () => {
    const id = seedOwnExpense(member);
    const res = await patch(id, { notes: "still food" }, member.cookie);
    expect(res.status).toBe(200);
    expect(res.expense!.subcategoryId).toBe(restaurants);
  });

  it("accepts category + a matching new subcategory in the same request", async () => {
    const id = seedOwnExpense(member); // food / restaurants
    const res = await patch(id, { categoryId: food, subcategoryId: groceries }, member.cookie);
    expect(res.status).toBe(200);
    expect(res.expense!.categoryId).toBe(food);
    expect(res.expense!.subcategoryId).toBe(groceries);
  });

  it("rejects an explicitly-provided subcategory that mismatches the new category", async () => {
    const id = seedOwnExpense(member); // food / restaurants
    const res = await patch(id, { categoryId: home, subcategoryId: groceries }, member.cookie);
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_subcategory");
    // And nothing was written.
    const row = sqlite.prepare("SELECT category_id FROM expenses WHERE id = ?").get(id) as {
      category_id: string;
    };
    expect(row.category_id).toBe(food);
  });

  it("clears the subcategory explicitly via null", async () => {
    const id = seedOwnExpense(member);
    const res = await patch(id, { subcategoryId: null }, member.cookie);
    expect(res.status).toBe(200);
    expect(res.expense!.subcategoryId).toBeNull();
    expect(res.expense!.categoryId).toBe(food); // untouched
  });
});

describe("archived references — only re-validated when actually changing", () => {
  it("archiving a category does NOT block editing unrelated fields of its expenses", async () => {
    const id = seedOwnExpense(member);
    await req(
      `/expense-categories/${food}`,
      { method: "PATCH", body: JSON.stringify({ status: "archived" }) },
      owner.cookie,
    );

    const res = await patch(id, { notes: "still editable" }, member.cookie);
    expect(res.status).toBe(200);
    expect(res.expense!.notes).toBe("still editable");
  });

  it("rejects newly selecting an archived category", async () => {
    const archived = seedExpenseCategory(sqlite, { familyId, slug: "old", status: "archived" });
    const id = seedOwnExpense(member);
    const res = await patch(id, { categoryId: archived.id }, member.cookie);
    expect(res.status).toBe(400);
    expect(res.error).toBe("category_archived");
  });

  it("rejects newly selecting an archived subcategory", async () => {
    const archivedChild = seedExpenseCategory(sqlite, {
      familyId,
      slug: "food-archived",
      parentId: food,
      status: "archived",
    });
    const id = seedOwnExpense(member);
    const res = await patch(
      id,
      { categoryId: food, subcategoryId: archivedChild.id },
      member.cookie,
    );
    expect(res.status).toBe(400);
    expect(res.error).toBe("subcategory_archived");
  });

  it("rejects newly selecting an archived payment method", async () => {
    const archivedMethod = seedPaymentMethod(sqlite, {
      familyId,
      slug: "old-card",
      status: "archived",
    });
    const id = seedOwnExpense(member);
    const res = await patch(id, { paymentMethodId: archivedMethod.id }, member.cookie);
    expect(res.status).toBe(400);
    expect(res.error).toBe("payment_method_archived");
  });

  it("does NOT block editing other fields on an expense whose payment method was archived after the fact", async () => {
    const id = seedOwnExpense(member);
    await req(
      `/expense-payment-methods/${paymentMethodId}`,
      { method: "PATCH", body: JSON.stringify({ status: "archived" }) },
      owner.cookie,
    );

    const res = await patch(id, { amount: "20" }, member.cookie);
    expect(res.status).toBe(200);
    expect(res.expense!.paymentMethodId).toBe(paymentMethodId); // still there, untouched
  });
});

describe("cross-family references", () => {
  it("rejects a category from another family", async () => {
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    const foreignCategory = seedExpenseCategory(sqlite, { familyId: otherFamily, slug: "food" });

    const id = seedOwnExpense(member);
    const res = await patch(id, { categoryId: foreignCategory.id }, member.cookie);
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_category");
  });

  it("rejects a payment method from another family", async () => {
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    const foreignMethod = seedPaymentMethod(sqlite, { familyId: otherFamily, slug: "cash" });

    const id = seedOwnExpense(member);
    const res = await patch(id, { paymentMethodId: foreignMethod.id }, member.cookie);
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_payment_method");
  });

  it("rejects a payerMemberId from another family", async () => {
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    const otherOwner = seedActor(sqlite, otherFamily, "owner");

    const id = seedOwnExpense(member);
    const res = await patch(id, { payerMemberId: otherOwner.memberId }, member.cookie);
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_member_ids");
  });
});

describe("authorization", () => {
  it("lets the creator edit their own expense", async () => {
    const id = seedOwnExpense(member);
    const res = await patch(id, { notes: "x" }, member.cookie);
    expect(res.status).toBe(200);
  });

  it("lets an admin edit a family-visible expense created by someone else", async () => {
    const id = seedOwnExpense(member);
    const res = await patch(id, { notes: "fixed by admin" }, admin.cookie);
    expect(res.status).toBe(200);
  });

  it("lets the owner edit a family-visible expense created by someone else", async () => {
    const id = seedOwnExpense(member);
    const res = await patch(id, { notes: "fixed by owner" }, owner.cookie);
    expect(res.status).toBe(200);
  });

  it("forbids an ordinary member from editing someone else's expense", async () => {
    const id = seedOwnExpense(member);
    const res = await patch(id, { notes: "nope" }, other.cookie);
    expect(res.status).toBe(403);
    expect(res.error).toBe("forbidden");
  });

  it("requires a session", async () => {
    const id = seedOwnExpense(member);
    const res = await req(`/expenses/${id}`, { method: "PATCH", body: JSON.stringify({ notes: "x" }) });
    expect(res.status).toBe(401);
  });

  it("404s for a non-member", async () => {
    const id = seedOwnExpense(member);
    const stranger = seedUser(sqlite);
    const res = await patch(id, { notes: "x" }, seedSession(sqlite, stranger.id));
    expect(res.status).toBe(404);
  });

  it("404s for an unknown expense id", async () => {
    const res = await patch("does-not-exist", { notes: "x" }, member.cookie);
    expect(res.status).toBe(404);
  });
});

describe("visibility enforcement", () => {
  it("404s (not 403) when a member tries to edit another member's private expense", async () => {
    const id = seedOwnExpense(member, { visibility: "private" });
    const res = await patch(id, { notes: "peeking" }, other.cookie);
    expect(res.status).toBe(404);
  });

  it("404s even for the family OWNER trying to edit another member's private expense", async () => {
    const id = seedOwnExpense(member, { visibility: "private" });
    const res = await patch(id, { notes: "admin override attempt" }, owner.cookie);
    expect(res.status).toBe(404);
  });

  it("404s even for an ADMIN trying to edit another member's private expense", async () => {
    const id = seedOwnExpense(member, { visibility: "private" });
    const res = await patch(id, { notes: "admin override attempt" }, admin.cookie);
    expect(res.status).toBe(404);
  });

  it("lets the creator edit their own private expense", async () => {
    const id = seedOwnExpense(member, { visibility: "private" });
    const res = await patch(id, { notes: "mine" }, member.cookie);
    expect(res.status).toBe(200);
  });

  it("a member CAN switch their own expense's visibility to private", async () => {
    const id = seedOwnExpense(member, { visibility: "family" });
    const res = await patch(id, { visibility: "private" }, member.cookie);
    expect(res.status).toBe(200);
    expect(res.expense!.visibility).toBe("private");
  });
});

describe("edit rejects an already-trashed expense", () => {
  it("404s for a trashed expense", async () => {
    const id = seedOwnExpense(member, { status: "trashed" });
    const res = await patch(id, { notes: "x" }, member.cookie);
    expect(res.status).toBe(404);
  });
});
