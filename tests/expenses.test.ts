/**
 * Expenses API — privacy, totals and the write path.
 *
 * The privacy rule is the reason this feature exists in the shape it does:
 * an expense is private to the member who recorded it, and NO family role
 * (owner or admin included) may read it. These tests are the guard on that.
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { createTestEnv, seedActor, seedFamily, seedUser } from "./helpers/testEnv";
import type { Env } from "../worker/types";

interface ExpenseBody {
  expense: {
    id: string;
    amountMinor: number;
    visibility: "family" | "private";
    createdByUserId: string;
  };
}

interface ListBody {
  expenses: { id: string }[];
  totalMinor: number;
}

interface SummaryBody {
  view: string;
  currency: string;
  totalMinor: number;
  count: number;
  privateMinor: number;
  sharedMinor: number;
  byCategory: { categoryId: string | null; name: string; totalMinor: number; count: number }[];
  byMonth: { month: string; totalMinor: number }[];
}

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

/** A family with two members plus an admin, all able to act financially. */
function setup() {
  const { env, sqlite } = createTestEnv();
  const ownerUser = seedUser(sqlite);
  const family = seedFamily(sqlite, ownerUser.id);
  const alice = seedActor(sqlite, family.id, "member", { name: "Alice" });
  const bob = seedActor(sqlite, family.id, "member", { name: "Bob" });
  const admin = seedActor(sqlite, family.id, "owner", { name: "Owner" });
  return { env, sqlite, familyId: family.id, alice, bob, admin };
}

function expensePayload(
  familyId: string,
  paidByMemberId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    familyId,
    paidByMemberId,
    amountMinor: 12_50,
    currency: "USD",
    expenseDate: "2026-08-14",
    merchant: "Corner Shop",
    ...overrides,
  };
}

describe("expenses: creation", () => {
  it("creates an expense that is private by default", async () => {
    const { env, familyId, alice } = setup();
    const res = await post(env, "/api/expenses", alice.cookie, expensePayload(familyId, alice.memberId));
    expect(res.status).toBe(201);
    const body = (await res.json()) as ExpenseBody;
    expect(body.expense.visibility).toBe("private");
    expect(body.expense.amountMinor).toBe(1250);
  });

  it("rejects a currency that isn't the family's", async () => {
    const { env, familyId, alice } = setup();
    const res = await post(
      env,
      "/api/expenses",
      alice.cookie,
      expensePayload(familyId, alice.memberId, { currency: "EUR" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("rejects a negative amount", async () => {
    const { env, familyId, alice } = setup();
    const res = await post(
      env,
      "/api/expenses",
      alice.cookie,
      expensePayload(familyId, alice.memberId, { amountMinor: -1 }),
    );
    expect(res.status).toBe(400);
  });

  it("allows a zero amount for container parents", async () => {
    const { env, familyId, alice } = setup();
    const res = await post(
      env,
      "/api/expenses",
      alice.cookie,
      expensePayload(familyId, alice.memberId, {
        amountMinor: 0,
        merchant: "Google Pay",
      }),
    );
    expect(res.status).toBe(201);
  });

  it("rejects a malformed date", async () => {
    const { env, familyId, alice } = setup();
    const res = await post(
      env,
      "/api/expenses",
      alice.cookie,
      expensePayload(familyId, alice.memberId, { expenseDate: "14-08-2026" }),
    );
    expect(res.status).toBe(400);
  });

  it("is idempotent for a repeated clientRequestId", async () => {
    const { env, familyId, alice } = setup();
    const clientRequestId = crypto.randomUUID();
    const payload = expensePayload(familyId, alice.memberId, { clientRequestId });

    const first = await post(env, "/api/expenses", alice.cookie, payload);
    expect(first.status).toBe(201);
    const second = await post(env, "/api/expenses", alice.cookie, payload);
    expect(second.status).toBe(200);

    const a = (await first.json()) as ExpenseBody;
    const b = (await second.json()) as ExpenseBody;
    expect(b.expense.id).toBe(a.expense.id);

    const list = (await (await get(env, `/api/expenses?familyId=${familyId}`, alice.cookie)).json()) as ListBody;
    expect(list.expenses).toHaveLength(1);
  });
});

describe("expenses: privacy", () => {
  it("hides a private expense from another member's list", async () => {
    const { env, familyId, alice, bob } = setup();
    await post(env, "/api/expenses", alice.cookie, expensePayload(familyId, alice.memberId));

    const list = (await (await get(env, `/api/expenses?familyId=${familyId}`, bob.cookie)).json()) as ListBody;
    expect(list.expenses).toHaveLength(0);
    expect(list.totalMinor).toBe(0);
  });

  it("hides a private expense from the family OWNER too", async () => {
    const { env, familyId, alice, admin } = setup();
    await post(env, "/api/expenses", alice.cookie, expensePayload(familyId, alice.memberId));

    const list = (await (await get(env, `/api/expenses?familyId=${familyId}`, admin.cookie)).json()) as ListBody;
    // No role bypass: personal books stay personal.
    expect(list.expenses).toHaveLength(0);
  });

  it("returns 404 (not 403) when another member fetches it by id", async () => {
    const { env, familyId, alice, bob } = setup();
    const created = (await (
      await post(env, "/api/expenses", alice.cookie, expensePayload(familyId, alice.memberId))
    ).json()) as ExpenseBody;

    const res = await get(env, `/api/expenses/${created.expense.id}`, bob.cookie);
    expect(res.status).toBe(404);
  });

  it("shows an expense once its owner marks it family-visible", async () => {
    const { env, familyId, alice, bob } = setup();
    const created = (await (
      await post(
        env,
        "/api/expenses",
        alice.cookie,
        expensePayload(familyId, alice.memberId, { visibility: "family" }),
      )
    ).json()) as ExpenseBody;

    const res = await get(env, `/api/expenses/${created.expense.id}`, bob.cookie);
    expect(res.status).toBe(200);

    const list = (await (await get(env, `/api/expenses?familyId=${familyId}`, bob.cookie)).json()) as ListBody;
    expect(list.expenses.map((e) => e.id)).toContain(created.expense.id);
  });

  it("lets only the creator edit an expense", async () => {
    const { env, familyId, alice, bob, admin } = setup();
    const created = (await (
      await post(
        env,
        "/api/expenses",
        alice.cookie,
        expensePayload(familyId, alice.memberId, { visibility: "family" }),
      )
    ).json()) as ExpenseBody;

    const byOther = await patch(env, `/api/expenses/${created.expense.id}`, bob.cookie, { amountMinor: 1 });
    expect(byOther.status).toBe(403);

    const byOwner = await patch(env, `/api/expenses/${created.expense.id}`, admin.cookie, { amountMinor: 1 });
    expect(byOwner.status).toBe(403);

    const byCreator = await patch(env, `/api/expenses/${created.expense.id}`, alice.cookie, { amountMinor: 999 });
    expect(byCreator.status).toBe(200);
  });

  it("keeps a trashed expense out of the list", async () => {
    const { env, familyId, alice } = setup();
    const created = (await (
      await post(env, "/api/expenses", alice.cookie, expensePayload(familyId, alice.memberId))
    ).json()) as ExpenseBody;

    const del = await app.request(
      `/api/expenses/${created.expense.id}`,
      { method: "DELETE", headers: { Cookie: alice.cookie, Origin: ORIGIN } },
      env,
    );
    expect([200, 204]).toContain(del.status);

    const list = (await (await get(env, `/api/expenses?familyId=${familyId}`, alice.cookie)).json()) as ListBody;
    expect(list.expenses).toHaveLength(0);
  });

  it("list view=mine is only the caller's rows; default list still shows shared family rows", async () => {
    const { env, familyId, alice, bob } = setup();
    await post(env, "/api/expenses", alice.cookie, expensePayload(familyId, alice.memberId, { amountMinor: 100 }));
    await post(
      env,
      "/api/expenses",
      bob.cookie,
      expensePayload(familyId, bob.memberId, { amountMinor: 200, visibility: "family" }),
    );

    const mine = (await (
      await get(env, `/api/expenses?familyId=${familyId}&view=mine`, alice.cookie)
    ).json()) as ListBody;
    expect(mine.expenses).toHaveLength(1);
    expect(mine.totalMinor).toBe(100);

    const shared = (await (
      await get(env, `/api/expenses?familyId=${familyId}&view=family`, alice.cookie)
    ).json()) as ListBody;
    expect(shared.expenses).toHaveLength(2);
    expect(shared.totalMinor).toBe(300);

    const def = (await (
      await get(env, `/api/expenses?familyId=${familyId}`, alice.cookie)
    ).json()) as ListBody;
    expect(def.expenses).toHaveLength(2);
    expect(def.totalMinor).toBe(300);
  });
});

describe("expenses: summary", () => {
  it("totals only what the caller recorded under view=mine", async () => {
    const { env, familyId, alice, bob } = setup();
    await post(env, "/api/expenses", alice.cookie, expensePayload(familyId, alice.memberId, { amountMinor: 1000 }));
    await post(env, "/api/expenses", alice.cookie, expensePayload(familyId, alice.memberId, { amountMinor: 2500 }));
    await post(
      env,
      "/api/expenses",
      bob.cookie,
      expensePayload(familyId, bob.memberId, { amountMinor: 9999, visibility: "family" }),
    );

    const res = await get(env, `/api/expenses/summary?familyId=${familyId}`, alice.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SummaryBody;
    expect(body.view).toBe("mine");
    expect(body.totalMinor).toBe(3500);
    expect(body.count).toBe(2);
    expect(body.currency).toBe("USD");
  });

  it("includes others' shared expenses under view=family, but not their private ones", async () => {
    const { env, familyId, alice, bob } = setup();
    await post(env, "/api/expenses", alice.cookie, expensePayload(familyId, alice.memberId, { amountMinor: 1000 }));
    await post(
      env,
      "/api/expenses",
      bob.cookie,
      expensePayload(familyId, bob.memberId, { amountMinor: 500, visibility: "family" }),
    );
    await post(
      env,
      "/api/expenses",
      bob.cookie,
      expensePayload(familyId, bob.memberId, { amountMinor: 7777 }), // private to Bob
    );

    const body = (await (
      await get(env, `/api/expenses/summary?familyId=${familyId}&view=family`, alice.cookie)
    ).json()) as SummaryBody;

    expect(body.totalMinor).toBe(1500);
    expect(body.privateMinor).toBe(1000); // Alice's own
    expect(body.sharedMinor).toBe(500);
  });

  it("groups by month and by category", async () => {
    const { env, familyId, alice } = setup();
    await post(
      env,
      "/api/expenses",
      alice.cookie,
      expensePayload(familyId, alice.memberId, { amountMinor: 300, expenseDate: "2026-07-02" }),
    );
    await post(
      env,
      "/api/expenses",
      alice.cookie,
      expensePayload(familyId, alice.memberId, { amountMinor: 700, expenseDate: "2026-08-09" }),
    );

    const body = (await (
      await get(env, `/api/expenses/summary?familyId=${familyId}`, alice.cookie)
    ).json()) as SummaryBody;

    expect(body.byMonth).toEqual([
      { month: "2026-07", totalMinor: 300 },
      { month: "2026-08", totalMinor: 700 },
    ]);
    // Both are uncategorized here, so they roll into one bucket.
    expect(body.byCategory).toHaveLength(1);
    expect(body.byCategory[0].name).toBe("Uncategorized");
    expect(body.byCategory[0].totalMinor).toBe(1000);
  });

  it("honours a from/to window", async () => {
    const { env, familyId, alice } = setup();
    await post(
      env,
      "/api/expenses",
      alice.cookie,
      expensePayload(familyId, alice.memberId, { amountMinor: 300, expenseDate: "2026-07-02" }),
    );
    await post(
      env,
      "/api/expenses",
      alice.cookie,
      expensePayload(familyId, alice.memberId, { amountMinor: 700, expenseDate: "2026-08-09" }),
    );

    const body = (await (
      await get(env, `/api/expenses/summary?familyId=${familyId}&from=2026-08-01&to=2026-08-31`, alice.cookie)
    ).json()) as SummaryBody;
    expect(body.totalMinor).toBe(700);
    expect(body.count).toBe(1);
  });

  it("rejects a malformed date window", async () => {
    const { env, familyId, alice } = setup();
    const res = await get(env, `/api/expenses/summary?familyId=${familyId}&from=nope`, alice.cookie);
    expect(res.status).toBe(400);
  });

  it("requires familyId", async () => {
    const { env, alice } = setup();
    const res = await get(env, "/api/expenses/summary", alice.cookie);
    expect(res.status).toBe(400);
  });

  it("hides the family from a non-member", async () => {
    const { env, familyId, sqlite } = setup();
    const otherFamily = seedFamily(sqlite, seedUser(sqlite).id, "Other");
    const outsider = seedActor(sqlite, otherFamily.id, "owner");
    const res = await get(env, `/api/expenses/summary?familyId=${familyId}`, outsider.cookie);
    expect(res.status).toBe(404);
  });
});

describe("expenses: auth", () => {
  const routes = [
    { method: "GET", path: "/api/expenses?familyId=f-1" },
    { method: "GET", path: "/api/expenses/summary?familyId=f-1" },
    { method: "GET", path: "/api/expenses/categories?familyId=f-1" },
    { method: "POST", path: "/api/expenses" },
    { method: "GET", path: "/api/expenses/e-1" },
    { method: "PATCH", path: "/api/expenses/e-1" },
    { method: "DELETE", path: "/api/expenses/e-1" },
  ];

  for (const { method, path } of routes) {
    it(`${method} ${path} → 401 without a session`, async () => {
      const res = await app.request(path, { method });
      expect(res.status).toBe(401);
    });
  }
});

describe("expenses: nesting", () => {
  it("creates a child under a parent and rolls up on list/detail", async () => {
    const { env, familyId, alice } = setup();
    const parent = (await (
      await post(
        env,
        "/api/expenses",
        alice.cookie,
        expensePayload(familyId, alice.memberId, {
          amountMinor: 0,
          merchant: "Google Pay",
        }),
      )
    ).json()) as ExpenseBody & {
      expense: { id: string; nestDepth: number; childCount: number };
    };
    expect(parent.expense.nestDepth).toBe(0);

    await post(
      env,
      "/api/expenses",
      alice.cookie,
      expensePayload(familyId, alice.memberId, {
        amountMinor: 400,
        merchant: "Coffee",
        parentExpenseId: parent.expense.id,
      }),
    );
    await post(
      env,
      "/api/expenses",
      alice.cookie,
      expensePayload(familyId, alice.memberId, {
        amountMinor: 600,
        merchant: "Lunch",
        parentExpenseId: parent.expense.id,
      }),
    );

    const list = (await (
      await get(env, `/api/expenses?familyId=${familyId}`, alice.cookie)
    ).json()) as {
      expenses: {
        id: string;
        childCount: number;
        childrenTotalMinor: number;
        merchant: string | null;
      }[];
      totalMinor: number;
    };
    // Roots only — the two children are hidden from the default list.
    expect(list.expenses).toHaveLength(1);
    expect(list.expenses[0].id).toBe(parent.expense.id);
    expect(list.expenses[0].childCount).toBe(2);
    expect(list.expenses[0].childrenTotalMinor).toBe(1000);
    // Leaf-only total (children), not double-counting the 0 parent.
    expect(list.totalMinor).toBe(1000);

    const detail = (await (
      await get(env, `/api/expenses/${parent.expense.id}`, alice.cookie)
    ).json()) as {
      expense: { childCount: number; childrenTotalMinor: number };
      children: { merchant: string | null }[];
    };
    expect(detail.expense.childCount).toBe(2);
    expect(detail.expense.childrenTotalMinor).toBe(1000);
    expect(detail.children.map((c) => c.merchant).sort()).toEqual(["Coffee", "Lunch"]);
  });

  it("refuses nesting deeper than grandchild (depth 2)", async () => {
    const { env, familyId, alice } = setup();
    const root = (await (
      await post(
        env,
        "/api/expenses",
        alice.cookie,
        expensePayload(familyId, alice.memberId, { amountMinor: 0, merchant: "Root" }),
      )
    ).json()) as ExpenseBody;
    const child = (await (
      await post(
        env,
        "/api/expenses",
        alice.cookie,
        expensePayload(familyId, alice.memberId, {
          amountMinor: 0,
          merchant: "Child",
          parentExpenseId: root.expense.id,
        }),
      )
    ).json()) as ExpenseBody;
    const grand = (await (
      await post(
        env,
        "/api/expenses",
        alice.cookie,
        expensePayload(familyId, alice.memberId, {
          amountMinor: 100,
          merchant: "Grand",
          parentExpenseId: child.expense.id,
        }),
      )
    ).json()) as ExpenseBody & { expense: { nestDepth: number } };
    expect(grand.expense.nestDepth).toBe(2);

    const tooDeep = await post(
      env,
      "/api/expenses",
      alice.cookie,
      expensePayload(familyId, alice.memberId, {
        amountMinor: 50,
        parentExpenseId: grand.expense.id,
      }),
    );
    expect(tooDeep.status).toBe(400);
  });
});

describe("expenses: categories", () => {
  it("GET categories returns non-empty builtins", async () => {
    const { env, familyId, alice } = setup();
    const res = await get(env, `/api/expenses/categories?familyId=${familyId}`, alice.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      categories: { id: string; name: string; color: string | null }[];
      tree: { id: string; children: unknown[] }[];
    };
    expect(body.categories.length).toBeGreaterThan(5);
    expect(body.categories.some((c) => c.id.startsWith("builtin_"))).toBe(true);
    expect(body.categories.some((c) => c.color && c.color.startsWith("#"))).toBe(true);
    const groceries = body.tree.find((t) => t.id === "builtin_groceries");
    expect(groceries?.children.length).toBeGreaterThan(0);
  });

  it("lets a non-admin member create a family category", async () => {
    const { env, familyId, alice } = setup();
    const res = await post(env, "/api/expenses/categories", alice.cookie, {
      familyId,
      name: "School lunch",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { category: { name: string; builtin: boolean } };
    expect(body.category.name).toBe("School lunch");
    expect(body.category.builtin).toBe(false);
  });
});
