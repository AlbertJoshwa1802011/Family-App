/**
 * Finance incomes catalog — amountMinor 1..500 × visibility family|private = 1000.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { catalogReq, seedFamilySession, type FamilySession } from "./helpers";

const CADENCES = ["monthly", "weekly", "biweekly", "yearly", "one_off"] as const;

type IncomeCase = {
  amountMinor: number;
  visibility: "family" | "private";
  cadence: (typeof CADENCES)[number];
};

const INCOME_CASES: IncomeCase[] = [];
for (let amountMinor = 1; amountMinor <= 500; amountMinor++) {
  INCOME_CASES.push({
    amountMinor,
    visibility: "family",
    cadence: CADENCES[amountMinor % CADENCES.length],
  });
  INCOME_CASES.push({
    amountMinor,
    visibility: "private",
    cadence: CADENCES[(amountMinor + 1) % CADENCES.length],
  });
}

const INVALID: { name: string; body: Record<string, unknown> }[] = [
  { name: "zero amount", body: { amountMinor: 0 } },
  { name: "negative amount", body: { amountMinor: -5 } },
  { name: "bad currency", body: { currency: "usd" } },
  { name: "wrong currency", body: { currency: "EUR" } },
  { name: "bad cadence", body: { cadence: "daily" } },
  { name: "bad startDate", body: { startDate: "15-01-2026" } },
  { name: "empty label", body: { label: "" } },
];

describe("catalog: finance incomes ≥1000", () => {
  let s: FamilySession;

  beforeAll(() => {
    s = seedFamilySession();
  });

  it(`records ${INCOME_CASES.length} create combinations`, () => {
    expect(INCOME_CASES.length).toBeGreaterThanOrEqual(1000);
  });

  it.each(INCOME_CASES)(
    "POST amount=$amountMinor vis=$visibility cadence=$cadence",
    async (c) => {
      const res = await catalogReq(s.env, "POST", "/api/finance/incomes", {
        cookie: s.actor.cookie,
        body: {
          familyId: s.familyId,
          label: `Income ${c.amountMinor} ${c.visibility}`,
          amountMinor: c.amountMinor,
          currency: "USD",
          cadence: c.cadence,
          startDate: "2026-01-15",
          visibility: c.visibility,
        },
      });
      expect(res.status).toBe(201);
      const json = (await res.json()) as {
        income: {
          amountMinor: number;
          visibility: string;
          cadence: string;
          currency: string;
        };
      };
      expect(json.income.amountMinor).toBe(c.amountMinor);
      expect(json.income.visibility).toBe(c.visibility);
      expect(json.income.cadence).toBe(c.cadence);
      expect(json.income.currency).toBe("USD");
    },
  );

  it.each(INVALID)("POST invalid: $name → 400 validation_error", async (c) => {
    const res = await catalogReq(s.env, "POST", "/api/finance/incomes", {
      cookie: s.actor.cookie,
      body: {
        familyId: s.familyId,
        label: "Pay",
        amountMinor: 1000,
        currency: "USD",
        startDate: "2026-01-15",
        ...c.body,
      },
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("validation_error");
  });
});
