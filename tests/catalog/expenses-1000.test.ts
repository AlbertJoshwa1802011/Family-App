/**
 * Expenses module catalog — amountMinor 0..499 × visibility family|private = 1000.
 * categoryId null is allowed (add is not blocked without a category).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { catalogReq, seedFamilySession, utcIsoFromDay, type FamilySession } from "./helpers";

type ExpenseCase = {
  amountMinor: number;
  visibility: "family" | "private";
};

const EXPENSE_CASES: ExpenseCase[] = [];
for (let amountMinor = 0; amountMinor < 500; amountMinor++) {
  EXPENSE_CASES.push({ amountMinor, visibility: "family" });
  EXPENSE_CASES.push({ amountMinor, visibility: "private" });
}

const INVALID: { name: string; body: Record<string, unknown> }[] = [
  { name: "negative amount", body: { amountMinor: -1 } },
  { name: "amount float", body: { amountMinor: 1.25 } },
  { name: "amount string", body: { amountMinor: "100" } },
  { name: "bad currency", body: { currency: "usd" } },
  { name: "wrong currency", body: { currency: "INR" } },
  { name: "bad date", body: { expenseDate: "01-09-2026" } },
  { name: "missing familyId", body: { familyId: "" } },
  { name: "missing paidBy", body: { paidByMemberId: "" } },
  { name: "split not none", body: { splitType: "equal" } },
  { name: "bad visibility", body: { visibility: "secret" } },
];

describe("catalog: expenses ≥1000", () => {
  let s: FamilySession;

  beforeAll(() => {
    s = seedFamilySession({ bypassRateLimit: true });
  });

  it(`records ${EXPENSE_CASES.length} create combinations`, () => {
    expect(EXPENSE_CASES.length).toBeGreaterThanOrEqual(1000);
  });

  it.each(EXPENSE_CASES)(
    "POST amountMinor=$amountMinor visibility=$visibility",
    async (c) => {
      const res = await catalogReq(s.env, "POST", "/api/expenses", {
        cookie: s.actor.cookie,
        body: {
          familyId: s.familyId,
          paidByMemberId: s.actor.memberId,
          amountMinor: c.amountMinor,
          currency: "USD",
          expenseDate: utcIsoFromDay(c.amountMinor % 28),
          categoryId: null,
          visibility: c.visibility,
        },
      });
      expect(res.status).toBe(201);
      const json = (await res.json()) as {
        expense: {
          amountMinor: number;
          visibility: string;
          categoryId: string | null;
          currency: string;
        };
      };
      expect(json.expense.amountMinor).toBe(c.amountMinor);
      expect(json.expense.visibility).toBe(c.visibility);
      expect(json.expense.categoryId).toBeNull();
      expect(json.expense.currency).toBe("USD");
    },
  );

  it.each(INVALID)("POST invalid: $name → 400 validation_error", async (c) => {
    const res = await catalogReq(s.env, "POST", "/api/expenses", {
      cookie: s.actor.cookie,
      body: {
        familyId: s.familyId,
        paidByMemberId: s.actor.memberId,
        amountMinor: 100,
        currency: "USD",
        expenseDate: "2026-09-01",
        categoryId: null,
        ...c.body,
      },
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("validation_error");
  });

  it("outsider cannot read a family-visible expense from another family", async () => {
    const created = await catalogReq(s.env, "POST", "/api/expenses", {
      cookie: s.actor.cookie,
      body: {
        familyId: s.familyId,
        paidByMemberId: s.actor.memberId,
        amountMinor: 42,
        currency: "USD",
        expenseDate: "2026-09-02",
        visibility: "family",
      },
    });
    const { expense } = (await created.json()) as { expense: { id: string } };
    const res = await catalogReq(s.env, "GET", `/api/expenses/${expense.id}`, {
      cookie: s.outsider.cookie,
    });
    expect(res.status).toBe(404);
  });
});
