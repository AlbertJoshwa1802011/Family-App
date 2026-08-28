/**
 * E1 — personal expenses API: CRUD, privacy, idempotency, categories, authz.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../worker/index";
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
let otherMember: ReturnType<typeof seedActor>;

beforeEach(() => {
  t = createTestEnv();
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  // seedFamily does not auto-add membership; seedActor adds the row.
  owner = seedActor(t.sqlite, familyId, "owner", { name: "Olivia Owner" });
  member = seedActor(t.sqlite, familyId, "member", { name: "Morgan Member" });
  otherMember = seedActor(t.sqlite, familyId, "member", { name: "Other Member" });
  // Ensure family default currency is INR for product-vision examples.
  t.sqlite
    .prepare("UPDATE families SET default_currency = ? WHERE id = ?")
    .run("INR", familyId);
});

function req(
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(
    path,
    {
      method,
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: "http://localhost",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    t.env,
  );
}

async function createPersonal(
  cookie: string,
  paidByMemberId: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await req("POST", "/api/expenses", cookie, {
    familyId,
    paidByMemberId,
    amountMinor: 45000,
    currency: "INR",
    expenseDate: "2026-08-28",
    merchant: "Local Mart",
    splitType: "none",
    visibility: "private",
    ...overrides,
  });
  return res;
}

describe("E1 personal expenses", () => {
  it("401 without session on list/create", async () => {
    expect(
      (await app.request(`/api/expenses?familyId=${familyId}`, {}, t.env)).status,
    ).toBe(401);
    expect(
      (
        await app.request(
          "/api/expenses",
          { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
          t.env,
        )
      ).status,
    ).toBe(401);
  });

  it("non-member cannot list or create (404)", async () => {
    const strangerUser = seedUser(t.sqlite);
    const otherFamily = seedFamily(t.sqlite, strangerUser.id);
    const stranger = seedActor(t.sqlite, otherFamily.id, "owner");

    expect(
      (await req("GET", `/api/expenses?familyId=${familyId}`, stranger.cookie)).status,
    ).toBe(404);
    expect(
      (
        await createPersonal(stranger.cookie, stranger.memberId, {
          familyId,
        })
      ).status,
    ).toBe(404);
  });

  it("create → list → get → patch → trash roundtrip", async () => {
    const createRes = await createPersonal(member.cookie, member.memberId, {
      categoryId: null,
      description: "Milk and bread",
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      expense: { id: string; amountMinor: number; splitType: string; scope: string };
    };
    expect(created.expense.amountMinor).toBe(45000);
    expect(created.expense.splitType).toBe("none");
    expect(created.expense.scope).toBe("personal");

    const listRes = await req(
      "GET",
      `/api/expenses?familyId=${familyId}&from=2026-08-01&to=2026-08-31&scope=personal`,
      member.cookie,
    );
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as {
      expenses: { id: string }[];
      totalMinor: number;
    };
    expect(list.expenses.some((e) => e.id === created.expense.id)).toBe(true);
    expect(list.totalMinor).toBeGreaterThanOrEqual(45000);

    const getRes = await req(
      "GET",
      `/api/expenses/${created.expense.id}`,
      member.cookie,
    );
    expect(getRes.status).toBe(200);

    const patchRes = await req(
      "PATCH",
      `/api/expenses/${created.expense.id}`,
      member.cookie,
      { merchant: "Updated Mart", amountMinor: 50000 },
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as {
      expense: { merchant: string; amountMinor: number };
    };
    expect(patched.expense.merchant).toBe("Updated Mart");
    expect(patched.expense.amountMinor).toBe(50000);

    const delRes = await req(
      "DELETE",
      `/api/expenses/${created.expense.id}`,
      member.cookie,
    );
    expect(delRes.status).toBe(200);

    expect(
      (await req("GET", `/api/expenses/${created.expense.id}`, member.cookie)).status,
    ).toBe(404);
  });

  it("private expense is hidden from other plain members (404) but visible to owner/admin", async () => {
    const createRes = await createPersonal(member.cookie, member.memberId, {
      visibility: "private",
      merchant: "Secret coffee",
    });
    const { expense } = (await createRes.json()) as { expense: { id: string } };

    expect(
      (await req("GET", `/api/expenses/${expense.id}`, otherMember.cookie)).status,
    ).toBe(404);

    const listOther = await req(
      "GET",
      `/api/expenses?familyId=${familyId}`,
      otherMember.cookie,
    );
    const otherBody = (await listOther.json()) as { expenses: { id: string }[] };
    expect(otherBody.expenses.some((e) => e.id === expense.id)).toBe(false);

    expect(
      (await req("GET", `/api/expenses/${expense.id}`, owner.cookie)).status,
    ).toBe(200);
  });

  it("family-visible personal expense is visible to every member", async () => {
    const createRes = await createPersonal(member.cookie, member.memberId, {
      visibility: "family",
      merchant: "Shared groceries note",
    });
    const { expense } = (await createRes.json()) as { expense: { id: string } };

    expect(
      (await req("GET", `/api/expenses/${expense.id}`, otherMember.cookie)).status,
    ).toBe(200);
  });

  it("rejects shared splitType / participants in E1", async () => {
    const res = await req("POST", "/api/expenses", member.cookie, {
      familyId,
      paidByMemberId: member.memberId,
      amountMinor: 1000,
      currency: "INR",
      expenseDate: "2026-08-28",
      splitType: "equal",
      participants: [{ memberId: member.memberId }, { memberId: otherMember.memberId }],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("rejects currency that does not match family default", async () => {
    const res = await createPersonal(member.cookie, member.memberId, {
      currency: "USD",
    });
    expect(res.status).toBe(400);
  });

  it("rejects dependent as paidBy (not_financial_actor)", async () => {
    const depId = crypto.randomUUID();
    t.sqlite
      .prepare(
        `INSERT INTO family_members (id, family_id, user_id, member_type, role, status, display_name)
         VALUES (?, ?, NULL, 'dependent', 'member', 'active', 'Kid')`,
      )
      .run(depId, familyId);

    const res = await createPersonal(member.cookie, depId);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_financial_actor");
  });

  it("clientRequestId create is idempotent — retry returns same expense, no duplicate", async () => {
    const clientRequestId = crypto.randomUUID();
    const first = await createPersonal(member.cookie, member.memberId, {
      clientRequestId,
      amountMinor: 99900,
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { expense: { id: string } };

    const second = await createPersonal(member.cookie, member.memberId, {
      clientRequestId,
      amountMinor: 99900,
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { expense: { id: string } };
    expect(secondBody.expense.id).toBe(firstBody.expense.id);

    const count = t.sqlite
      .prepare(
        "SELECT COUNT(*) AS c FROM expenses WHERE family_id = ? AND amount_minor = 99900",
      )
      .get(familyId) as { c: number };
    expect(count.c).toBe(1);
  });

  it("search is family-scoped and privacy-aware", async () => {
    await createPersonal(member.cookie, member.memberId, {
      merchant: "AlphaMart",
      visibility: "private",
    });
    await createPersonal(owner.cookie, owner.memberId, {
      merchant: "AlphaMarket",
      visibility: "family",
    });

    const asOther = await req(
      "GET",
      `/api/expenses?familyId=${familyId}&q=Alpha`,
      otherMember.cookie,
    );
    const body = (await asOther.json()) as { expenses: { merchant: string }[] };
    expect(body.expenses.every((e) => e.merchant !== "AlphaMart")).toBe(true);
    expect(body.expenses.some((e) => e.merchant === "AlphaMarket")).toBe(true);
  });

  it("categories: lists builtins; admin can create+archive custom; member cannot", async () => {
    const listRes = await req(
      "GET",
      `/api/expenses/categories?familyId=${familyId}`,
      member.cookie,
    );
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as {
      categories: { id: string; builtin: boolean; name: string }[];
    };
    expect(list.categories.some((c) => c.builtin)).toBe(true);
    expect(list.categories.some((c) => c.name === "Groceries")).toBe(true);

    expect(
      (
        await req("POST", "/api/expenses/categories", member.cookie, {
          familyId,
          name: "Pets",
        })
      ).status,
    ).toBe(403);

    const createCat = await req("POST", "/api/expenses/categories", owner.cookie, {
      familyId,
      name: "Pets",
    });
    expect(createCat.status).toBe(201);
    const { category } = (await createCat.json()) as { category: { id: string } };

    // Use custom category on an expense, then archive — historical ref stays.
    const expRes = await createPersonal(member.cookie, member.memberId, {
      categoryId: category.id,
    });
    expect(expRes.status).toBe(201);

    const arch = await req(
      "POST",
      `/api/expenses/categories/${category.id}/archive?familyId=${familyId}`,
      owner.cookie,
    );
    expect(arch.status).toBe(200);

    const listAfter = await req(
      "GET",
      `/api/expenses/categories?familyId=${familyId}`,
      member.cookie,
    );
    const after = (await listAfter.json()) as {
      categories: { id: string }[];
    };
    expect(after.categories.some((c) => c.id === category.id)).toBe(false);

    const builtinId = list.categories.find((c) => c.builtin)!.id;
    expect(
      (
        await req(
          "POST",
          `/api/expenses/categories/${builtinId}/archive?familyId=${familyId}`,
          owner.cookie,
        )
      ).status,
    ).toBe(404);
  });

  it("rejects amountMinor <= 0 and malformed dates", async () => {
    expect(
      (await createPersonal(member.cookie, member.memberId, { amountMinor: 0 }))
        .status,
    ).toBe(400);
    expect(
      (
        await createPersonal(member.cookie, member.memberId, {
          expenseDate: "08-28-2026",
        })
      ).status,
    ).toBe(400);
  });

  it("other member cannot edit or trash someone else's personal expense", async () => {
    const createRes = await createPersonal(member.cookie, member.memberId, {
      visibility: "family",
    });
    const { expense } = (await createRes.json()) as { expense: { id: string } };

    expect(
      (
        await req("PATCH", `/api/expenses/${expense.id}`, otherMember.cookie, {
          merchant: "Nope",
        })
      ).status,
    ).toBe(403);

    expect(
      (await req("DELETE", `/api/expenses/${expense.id}`, otherMember.cookie)).status,
    ).toBe(403);

    // Owner/admin can trash.
    expect(
      (await req("DELETE", `/api/expenses/${expense.id}`, owner.cookie)).status,
    ).toBe(200);
  });
});
