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
