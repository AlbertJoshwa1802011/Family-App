/**
 * POST /expenses — creation, money handling, and reference integrity.
 *
 * Money handling is security-critical: the client sends a decimal string/
 * number, never a pre-computed minor-unit integer, and the server is the only
 * place `toMinorUnits` runs. Reference integrity (category/subcategory/
 * payment-method/family scoping) must hold regardless of what the client
 * sends — these tests assume a hostile-but-not-buggy client throughout.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { app } from "../worker/index";
import type { Env } from "../worker/types";
import {
  createTestEnv,
  seedActor,
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
let categoryId: string;
let subcategoryId: string;
let paymentMethodId: string;

interface ExpenseDetail {
  id: string;
  amountMinor: number;
  currency: string;
  spentOn: string;
  spentTime: string | null;
  merchant: string | null;
  merchantKey: string | null;
  notes: string | null;
  visibility: "family" | "private";
  status: string;
  source: string;
  createdByUserId: string;
  payerMemberId: string | null;
  categoryId: string;
  categoryName: string;
  subcategoryId: string | null;
  paymentMethodId: string | null;
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

async function create(body: Record<string, unknown>, cookie: string) {
  const res = await req("/expenses", { method: "POST", body: JSON.stringify(body) }, cookie);
  const json = (await res.json()) as { expense?: ExpenseDetail; error?: string; issues?: unknown[] };
  return { status: res.status, ...json };
}

beforeEach(() => {
  ({ env, sqlite } = createTestEnv());
  const ownerUser = seedUser(sqlite);
  familyId = seedFamily(sqlite, ownerUser.id).id;
  owner = seedActor(sqlite, familyId, "owner");
  member = seedActor(sqlite, familyId, "member");

  categoryId = seedExpenseCategory(sqlite, { familyId, slug: "food", name: "Food" }).id;
  subcategoryId = seedExpenseCategory(sqlite, {
    familyId,
    slug: "food-restaurants",
    name: "Restaurants",
    parentId: categoryId,
  }).id;
  paymentMethodId = seedPaymentMethod(sqlite, { familyId, slug: "cash", kind: "cash" }).id;
});

describe("valid creation", () => {
  it("creates a minimal expense with only amount, category and default date", async () => {
    const res = await create({ familyId, amount: "450", categoryId }, member.cookie);

    expect(res.status).toBe(201);
    expect(res.expense!.amountMinor).toBe(45000);
    expect(res.expense!.currency).toBe("INR"); // family default (Phase B)
    expect(res.expense!.spentOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.expense!.visibility).toBe("family");
    expect(res.expense!.status).toBe("active");
    expect(res.expense!.source).toBe("manual");
    expect(res.expense!.createdByUserId).toBe(member.userId);
    // Defaults the payer to the acting member's own row.
    expect(res.expense!.payerMemberId).toBe(member.memberId);
    expect(res.expense!.categoryName).toBe("Food");
  });

  it("accepts every optional field", async () => {
    const res = await create(
      {
        familyId,
        amount: "450.50",
        spentOn: "2026-07-15",
        spentTime: "13:45",
        categoryId,
        subcategoryId,
        merchant: "  KFC  ",
        paymentMethodId,
        notes: "Team lunch",
        payerMemberId: owner.memberId,
        visibility: "private",
      },
      member.cookie,
    );

    expect(res.status).toBe(201);
    expect(res.expense!.amountMinor).toBe(45050);
    expect(res.expense!.spentOn).toBe("2026-07-15");
    expect(res.expense!.spentTime).toBe("13:45");
    expect(res.expense!.merchant).toBe("KFC"); // trimmed
    expect(res.expense!.merchantKey).toBe("kfc");
    expect(res.expense!.notes).toBe("Team lunch");
    expect(res.expense!.payerMemberId).toBe(owner.memberId);
    expect(res.expense!.visibility).toBe("private");
    expect(res.expense!.subcategoryId).toBe(subcategoryId);
    expect(res.expense!.paymentMethodId).toBe(paymentMethodId);
  });

  it("never populates external_id/import_batch_id for a manual expense", async () => {
    const res = await create({ familyId, amount: "10", categoryId }, member.cookie);
    const row = sqlite
      .prepare("SELECT external_id, external_account, import_batch_id, source FROM expenses WHERE id = ?")
      .get(res.expense!.id) as Record<string, unknown>;
    expect(row.external_id).toBeNull();
    expect(row.external_account).toBeNull();
    expect(row.import_batch_id).toBeNull();
    expect(row.source).toBe("manual");
  });

  it("respects a family currency other than INR", async () => {
    await req(
      "/expense-settings",
      { method: "PATCH", body: JSON.stringify({ familyId, defaultCurrency: "JPY" }) },
      owner.cookie,
    );

    const res = await create({ familyId, amount: "1200", categoryId }, member.cookie);
    expect(res.status).toBe(201);
    expect(res.expense!.currency).toBe("JPY");
    // JPY has 0 minor-unit decimals — 1200 major units is 1200 minor units.
    expect(res.expense!.amountMinor).toBe(1200);
  });

  it("lets the caller override the family default currency explicitly", async () => {
    const res = await create({ familyId, amount: "10", currency: "USD", categoryId }, member.cookie);
    expect(res.status).toBe(201);
    expect(res.expense!.currency).toBe("USD");
    expect(res.expense!.amountMinor).toBe(1000);
  });
});

describe("money handling — the critical boundary", () => {
  it("parses common decimal shapes without float drift", async () => {
    const cases: [string | number, number][] = [
      ["450", 45000],
      ["450.50", 45050],
      ["450.5", 45050],
      [450, 45000],
      [450.5, 45050],
      ["1.005", 101], // half-up rounding on the dropped digit, not binary float
      ["1,234.50", 123450], // thousands separator tolerated
    ];

    for (const [amount, expectedMinor] of cases) {
      const res = await create({ familyId, amount, categoryId }, member.cookie);
      expect(res.status, `amount=${amount}`).toBe(201);
      expect(res.expense!.amountMinor, `amount=${amount}`).toBe(expectedMinor);
    }
  });

  it("rejects a missing amount", async () => {
    const res = await create({ familyId, categoryId }, member.cookie);
    expect(res.status).toBe(400);
    expect(res.error).toBe("validation_error");
  });

  it("rejects an unparseable amount", async () => {
    const res = await create({ familyId, amount: "not-a-number", categoryId }, member.cookie);
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_amount");
  });

  it("rejects a zero amount", async () => {
    const res = await create({ familyId, amount: "0", categoryId }, member.cookie);
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_amount");
  });

  it("rejects a negative amount — refunds are never negative expenses", async () => {
    const res = await create({ familyId, amount: "-50", categoryId }, member.cookie);
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_amount");
  });

  it("rejects an amount with too many decimal places worth of garbage", async () => {
    const res = await create({ familyId, amount: "12.34.56", categoryId }, member.cookie);
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_amount");
  });

  it("rejects a currency the app doesn't support", async () => {
    const res = await create(
      { familyId, amount: "10", currency: "XYZ", categoryId },
      member.cookie,
    );
    expect(res.status).toBe(400);
    expect(res.error).toBe("validation_error");
  });

  it("never stores a float — amount_minor column is always an integer", async () => {
    const res = await create({ familyId, amount: "450.50", categoryId }, member.cookie);
    const row = sqlite
      .prepare("SELECT amount_minor FROM expenses WHERE id = ?")
      .get(res.expense!.id) as { amount_minor: number };
    expect(Number.isInteger(row.amount_minor)).toBe(true);
    expect(row.amount_minor).toBe(45050);
  });
});

describe("category integrity", () => {
  it("rejects a missing categoryId", async () => {
    const res = await create({ familyId, amount: "10" }, member.cookie);
    expect(res.status).toBe(400);
    expect(res.error).toBe("validation_error");
  });

  it("rejects an unknown categoryId", async () => {
    const res = await create({ familyId, amount: "10", categoryId: "nope" }, member.cookie);
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_category");
  });

  it("rejects a categoryId from another family", async () => {
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    const foreignCategory = seedExpenseCategory(sqlite, { familyId: otherFamily, slug: "food" });

    const res = await create(
      { familyId, amount: "10", categoryId: foreignCategory.id },
      member.cookie,
    );
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_category");
  });

  it("rejects an archived category", async () => {
    const archived = seedExpenseCategory(sqlite, { familyId, slug: "old", status: "archived" });
    const res = await create({ familyId, amount: "10", categoryId: archived.id }, member.cookie);
    expect(res.status).toBe(400);
    expect(res.error).toBe("category_archived");
  });

  it("rejects a subcategory used as the top-level category", async () => {
    const res = await create({ familyId, amount: "10", categoryId: subcategoryId }, member.cookie);
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_category");
  });
});

describe("subcategory integrity", () => {
  it("rejects an unknown subcategoryId", async () => {
    const res = await create(
      { familyId, amount: "10", categoryId, subcategoryId: "nope" },
      member.cookie,
    );
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_subcategory");
  });

  it("rejects a subcategory that belongs to a different category", async () => {
    const otherCategory = seedExpenseCategory(sqlite, { familyId, slug: "home" });
    const res = await create(
      { familyId, amount: "10", categoryId: otherCategory.id, subcategoryId },
      member.cookie,
    );
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_subcategory");
  });

  it("rejects a subcategory from another family", async () => {
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    const foreignParent = seedExpenseCategory(sqlite, { familyId: otherFamily, slug: "food" });
    const foreignChild = seedExpenseCategory(sqlite, {
      familyId: otherFamily,
      slug: "food-x",
      parentId: foreignParent.id,
    });

    const res = await create(
      { familyId, amount: "10", categoryId, subcategoryId: foreignChild.id },
      member.cookie,
    );
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_subcategory");
  });

  it("rejects an archived subcategory", async () => {
    const archivedChild = seedExpenseCategory(sqlite, {
      familyId,
      slug: "food-archived",
      parentId: categoryId,
      status: "archived",
    });
    const res = await create(
      { familyId, amount: "10", categoryId, subcategoryId: archivedChild.id },
      member.cookie,
    );
    expect(res.status).toBe(400);
    expect(res.error).toBe("subcategory_archived");
  });

  it("rejects a top-level category passed as a subcategory", async () => {
    const otherTopLevel = seedExpenseCategory(sqlite, { familyId, slug: "home" });
    const res = await create(
      { familyId, amount: "10", categoryId, subcategoryId: otherTopLevel.id },
      member.cookie,
    );
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_subcategory");
  });
});

describe("payment method integrity", () => {
  it("rejects an unknown paymentMethodId", async () => {
    const res = await create(
      { familyId, amount: "10", categoryId, paymentMethodId: "nope" },
      member.cookie,
    );
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_payment_method");
  });

  it("rejects a payment method from another family", async () => {
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    const foreignMethod = seedPaymentMethod(sqlite, { familyId: otherFamily, slug: "cash" });

    const res = await create(
      { familyId, amount: "10", categoryId, paymentMethodId: foreignMethod.id },
      member.cookie,
    );
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_payment_method");
  });

  it("rejects an archived payment method — hiding it from GET is not enough", async () => {
    const archived = seedPaymentMethod(sqlite, {
      familyId,
      slug: "old-card",
      status: "archived",
    });
    const res = await create(
      { familyId, amount: "10", categoryId, paymentMethodId: archived.id },
      member.cookie,
    );
    expect(res.status).toBe(400);
    expect(res.error).toBe("payment_method_archived");
  });
});

describe("payer integrity", () => {
  it("rejects a payerMemberId from another family", async () => {
    const otherUser = seedUser(sqlite);
    const otherFamily = seedFamily(sqlite, otherUser.id, "Other").id;
    const otherOwner = seedActor(sqlite, otherFamily, "owner");

    const res = await create(
      { familyId, amount: "10", categoryId, payerMemberId: otherOwner.memberId },
      member.cookie,
    );
    expect(res.status).toBe(400);
    expect(res.error).toBe("invalid_member_ids");
  });
});

describe("authorization", () => {
  it("requires a session", async () => {
    const res = await req("/expenses", {
      method: "POST",
      body: JSON.stringify({ familyId, amount: "10", categoryId }),
    });
    expect(res.status).toBe(401);
  });

  it("404s for a non-member (no family enumeration)", async () => {
    const stranger = seedUser(sqlite);
    const res = await create(
      { familyId, amount: "10", categoryId },
      seedSession(sqlite, stranger.id),
    );
    expect(res.status).toBe(404);
  });

  it("allows an ordinary member to create an expense", async () => {
    const res = await create({ familyId, amount: "10", categoryId }, member.cookie);
    expect(res.status).toBe(201);
  });

  it("rejects a foreign Origin (CSRF)", async () => {
    const res = await app.request(
      "http://localhost/api/expenses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: member.cookie,
          Origin: "https://evil.example",
        },
        body: JSON.stringify({ familyId, amount: "10", categoryId }),
      },
      env,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "csrf_rejected" });
  });
});
