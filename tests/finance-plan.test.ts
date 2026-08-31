import { describe, expect, it } from "vitest";
import {
  buildPlan,
  commitmentsForCycle,
  incomeForCycle,
  monthsToAfford,
  type CommitmentInput,
  type IncomeInput,
} from "../worker/lib/finance/plan";
import { cycleFor } from "../worker/lib/finance/periods";

const CYCLE = cycleFor("2026-08-14", 1); // 2026-08-01 .. 2026-08-31

const salary: IncomeInput = {
  id: "i1",
  label: "Salary",
  amountMinor: 8_000_00,
  cadence: "monthly",
  startDate: "2026-01-01",
  active: true,
};

function commitment(over: Partial<CommitmentInput>): CommitmentInput {
  return {
    id: "c1",
    name: "Thing",
    kind: "other",
    amountKind: "fixed",
    amountMinor: 1000_00,
    cadence: "monthly",
    dayOfMonth: 5,
    startDate: "2026-01-05",
    status: "active",
    ...over,
  };
}

describe("incomeForCycle", () => {
  it("sums active recurring income at its monthly equivalent", () => {
    expect(incomeForCycle([salary], CYCLE)).toBe(800000);
  });

  it("ignores inactive and ended income", () => {
    expect(incomeForCycle([{ ...salary, active: false }], CYCLE)).toBe(0);
    expect(incomeForCycle([{ ...salary, endDate: "2026-07-31" }], CYCLE)).toBe(0);
  });

  it("counts a one-off only in the cycle it lands in", () => {
    const bonus: IncomeInput = {
      id: "i2",
      label: "Bonus",
      amountMinor: 500_00,
      cadence: "one_off",
      startDate: "2026-08-10",
      active: true,
    };
    expect(incomeForCycle([bonus], CYCLE)).toBe(50000);
    expect(incomeForCycle([{ ...bonus, startDate: "2026-09-10" }], CYCLE)).toBe(0);
  });
});

describe("commitmentsForCycle", () => {
  it("includes a monthly commitment due in the cycle", () => {
    const due = commitmentsForCycle([commitment({})], CYCLE, 800000);
    expect(due).toHaveLength(1);
    expect(due[0].amountMinor).toBe(100000);
    expect(due[0].dueDates).toEqual(["2026-08-05"]);
  });

  it("skips paused and completed commitments", () => {
    expect(commitmentsForCycle([commitment({ status: "paused" })], CYCLE, 800000)).toHaveLength(0);
    expect(commitmentsForCycle([commitment({ status: "completed" })], CYCLE, 800000)).toHaveLength(0);
  });

  it("resolves tithe as a percentage of the cycle's income", () => {
    const tithe = commitment({
      id: "tithe",
      kind: "giving",
      name: "Tithe",
      amountKind: "percent_of_income",
      percentBp: 1000, // 10%
      amountMinor: null,
    });
    const due = commitmentsForCycle([tithe], CYCLE, 800000);
    expect(due[0].amountMinor).toBe(80000); // 10% of 8000.00
  });

  it("multiplies a weekly commitment by its occurrences in the cycle", () => {
    const weekly = commitment({
      cadence: "weekly",
      dayOfWeek: 1, // Mondays
      startDate: "2026-08-03",
      amountMinor: 100_00,
    });
    const due = commitmentsForCycle([weekly], CYCLE, 800000);
    expect(due[0].dueDates).toHaveLength(5);
    expect(due[0].amountMinor).toBe(50000);
  });

  it("counts down EMI installments", () => {
    const emi = commitment({
      kind: "emi",
      startDate: "2026-01-05",
      totalInstallments: 60,
    });
    const due = commitmentsForCycle([emi], CYCLE, 800000);
    expect(due[0].totalInstallments).toBe(60);
    expect(due[0].remaining).toBe(52); // 8 paid Jan-Aug
  });

  it("drops a commitment whose term has finished", () => {
    const emi = commitment({ startDate: "2026-01-05", totalInstallments: 3 });
    expect(commitmentsForCycle([emi], CYCLE, 800000)).toHaveLength(0);
  });
});

describe("buildPlan", () => {
  const emi = commitment({ id: "emi", kind: "emi", name: "Car EMI", amountMinor: 1200_00 });
  const tithe = commitment({
    id: "tithe",
    kind: "giving",
    name: "Tithe",
    amountKind: "percent_of_income",
    percentBp: 1000,
    amountMinor: null,
  });

  it("computes the core identity: spendable = income - committed - savings", () => {
    const plan = buildPlan({
      cycle: CYCLE,
      today: "2026-08-14",
      incomes: [salary],
      commitments: [emi, tithe],
      expenses: [],
      settings: { savingsTargetKind: "amount", savingsTargetMinor: 1000_00 },
    });

    expect(plan.incomeMinor).toBe(800000);
    expect(plan.committedMinor).toBe(120000 + 80000); // EMI + 10% tithe
    expect(plan.givingMinor).toBe(80000);
    expect(plan.savingsTargetMinor).toBe(100000);
    expect(plan.spendableMinor).toBe(800000 - 200000 - 100000); // 500000
    expect(plan.remainingMinor).toBe(500000);
  });

  it("resolves a percentage savings target against income", () => {
    const plan = buildPlan({
      cycle: CYCLE,
      today: "2026-08-14",
      incomes: [salary],
      commitments: [],
      expenses: [],
      settings: { savingsTargetKind: "percent", savingsTargetPercentBp: 2000 },
    });
    expect(plan.savingsTargetMinor).toBe(160000); // 20% of 8000.00
  });

  it("subtracts spending and reports what's left", () => {
    const plan = buildPlan({
      cycle: CYCLE,
      today: "2026-08-14",
      incomes: [salary],
      commitments: [],
      expenses: [
        { id: "e1", amountMinor: 200_00, expenseDate: "2026-08-02", categoryId: "food" },
        { id: "e2", amountMinor: 300_00, expenseDate: "2026-08-09", categoryId: "food" },
        { id: "e3", amountMinor: 100_00, expenseDate: "2026-08-20", categoryId: "fuel" },
      ],
      settings: { savingsTargetKind: "none" },
    });
    expect(plan.spentMinor).toBe(60000);
    expect(plan.remainingMinor).toBe(800000 - 60000);
    expect(plan.projectedSavingsMinor).toBe(740000);
    expect(plan.byCategory[0]).toEqual({ categoryId: "food", totalMinor: 50000, count: 2 });
  });

  it("excludes auto-logged commitment expenses from discretionary spend", () => {
    const plan = buildPlan({
      cycle: CYCLE,
      today: "2026-08-14",
      incomes: [salary],
      commitments: [emi],
      expenses: [
        { id: "auto-emi", amountMinor: 1200_00, expenseDate: "2026-08-05", categoryId: null },
        { id: "e1", amountMinor: 200_00, expenseDate: "2026-08-06", categoryId: "food" },
      ],
      committedExpenseIds: new Set(["auto-emi"]),
      settings: { savingsTargetKind: "none" },
    });
    // The EMI is counted once, as a commitment — not again as spending.
    expect(plan.committedMinor).toBe(120000);
    expect(plan.spentMinor).toBe(20000);
  });

  it("ignores expenses outside the cycle", () => {
    const plan = buildPlan({
      cycle: CYCLE,
      today: "2026-08-14",
      incomes: [salary],
      commitments: [],
      expenses: [
        { id: "e1", amountMinor: 100_00, expenseDate: "2026-07-31", categoryId: null },
        { id: "e2", amountMinor: 100_00, expenseDate: "2026-09-01", categoryId: null },
      ],
      settings: { savingsTargetKind: "none" },
    });
    expect(plan.spentMinor).toBe(0);
  });

  it("buckets spending into weeks of the cycle", () => {
    const plan = buildPlan({
      cycle: CYCLE,
      today: "2026-08-14",
      incomes: [salary],
      commitments: [],
      expenses: [
        { id: "a", amountMinor: 100_00, expenseDate: "2026-08-01", categoryId: null },
        { id: "b", amountMinor: 200_00, expenseDate: "2026-08-09", categoryId: null },
        { id: "c", amountMinor: 300_00, expenseDate: "2026-08-30", categoryId: null },
      ],
      settings: { savingsTargetKind: "none" },
    });
    expect(plan.weeks).toHaveLength(5);
    expect(plan.weeks[0].spentMinor).toBe(10000);
    expect(plan.weeks[1].spentMinor).toBe(20000);
    expect(plan.weeks[4].spentMinor).toBe(30000);
  });

  it("spreads what's left over the days remaining", () => {
    const plan = buildPlan({
      cycle: CYCLE,
      today: "2026-08-22", // 10 days left, inclusive
      incomes: [salary],
      commitments: [],
      expenses: [{ id: "e", amountMinor: 7000_00, expenseDate: "2026-08-02", categoryId: null }],
      settings: { savingsTargetKind: "none" },
    });
    expect(plan.daysLeft).toBe(10);
    expect(plan.remainingMinor).toBe(100000);
    expect(plan.dailyAllowanceMinor).toBe(10000);
  });

  it("reports over-budget when spending exceeds the allowance", () => {
    const plan = buildPlan({
      cycle: CYCLE,
      today: "2026-08-14",
      incomes: [salary],
      commitments: [],
      expenses: [{ id: "e", amountMinor: 9000_00, expenseDate: "2026-08-02", categoryId: null }],
      settings: { savingsTargetKind: "none" },
    });
    expect(plan.remainingMinor).toBeLessThan(0);
    expect(plan.status).toBe("over");
    // A negative balance must not produce a negative daily allowance.
    expect(plan.dailyAllowanceMinor).toBe(0);
  });

  it("flags a tight month before it goes negative", () => {
    const plan = buildPlan({
      cycle: CYCLE,
      today: "2026-08-14",
      incomes: [salary],
      commitments: [],
      expenses: [{ id: "e", amountMinor: 7500_00, expenseDate: "2026-08-02", categoryId: null }],
      settings: { savingsTargetKind: "none" },
    });
    expect(plan.status).toBe("tight");
  });

  it("stays 'unplanned' until income is recorded", () => {
    const plan = buildPlan({
      cycle: CYCLE,
      today: "2026-08-14",
      incomes: [],
      commitments: [],
      expenses: [{ id: "e", amountMinor: 100_00, expenseDate: "2026-08-02", categoryId: null }],
      settings: { savingsTargetKind: "none" },
    });
    expect(plan.status).toBe("unplanned");
  });

  it("reports no days left once the cycle has passed", () => {
    const plan = buildPlan({
      cycle: CYCLE,
      today: "2026-09-15",
      incomes: [salary],
      commitments: [],
      expenses: [],
      settings: { savingsTargetKind: "none" },
    });
    expect(plan.daysLeft).toBe(0);
    expect(plan.dailyAllowanceMinor).toBeNull();
  });

  it("groups committed money by kind, largest first", () => {
    const plan = buildPlan({
      cycle: CYCLE,
      today: "2026-08-14",
      incomes: [salary],
      commitments: [emi, tithe],
      expenses: [],
      settings: { savingsTargetKind: "none" },
    });
    expect(plan.committedByKind[0]).toEqual({ kind: "emi", totalMinor: 120000 });
    expect(plan.committedByKind[1]).toEqual({ kind: "giving", totalMinor: 80000 });
  });
});

describe("monthsToAfford", () => {
  it("divides cost by monthly surplus, rounding up", () => {
    expect(monthsToAfford(1000_00, 300_00)).toBe(4);
    expect(monthsToAfford(900_00, 300_00)).toBe(3);
  });

  it("is null when nothing is being saved", () => {
    expect(monthsToAfford(1000_00, 0)).toBeNull();
    expect(monthsToAfford(1000_00, -50_00)).toBeNull();
  });
});
