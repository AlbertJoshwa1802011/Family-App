import { describe, expect, it } from "vitest";
import {
  addMonths,
  cycleFor,
  dueDatesBetween,
  incomeMonthlyEquivalent,
  isoWeekKey,
  monthlyEquivalent,
  periodKeyFor,
  recentCycles,
  remainingInstallments,
  weeksIn,
} from "../worker/lib/finance/periods";

describe("addMonths", () => {
  it("clamps to the shorter target month instead of rolling over", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29"); // leap year
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });

  it("crosses year boundaries", () => {
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });
});

describe("cycleFor", () => {
  it("is the calendar month when payday is the 1st", () => {
    expect(cycleFor("2026-08-14", 1)).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
      key: "2026-08",
    });
  });

  it("runs payday-to-payday when payday is mid-month", () => {
    // On the 26th, the cycle that started on the 25th is live.
    expect(cycleFor("2026-08-26", 25)).toEqual({
      from: "2026-08-25",
      to: "2026-09-24",
      key: "2026-08",
    });
  });

  it("reaches back into the previous month before payday", () => {
    // On the 3rd with payday 25, we're still spending August's pay.
    expect(cycleFor("2026-09-03", 25)).toEqual({
      from: "2026-08-25",
      to: "2026-09-24",
      key: "2026-08",
    });
  });

  it("handles a payday on the cycle's first day", () => {
    expect(cycleFor("2026-08-25", 25).from).toBe("2026-08-25");
  });

  it("clamps an out-of-range payday into a month every month has", () => {
    expect(cycleFor("2026-08-14", 31).from).toBe("2026-07-28");
    expect(cycleFor("2026-08-14", 0).from).toBe("2026-08-01");
  });
});

describe("recentCycles", () => {
  it("returns N cycles oldest-first, ending with the current one", () => {
    const cycles = recentCycles("2026-08-14", 3, 1);
    expect(cycles.map((c) => c.key)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });
});

describe("weeksIn", () => {
  it("slices a month into weeks without spilling past the end", () => {
    const weeks = weeksIn("2026-08-01", "2026-08-31");
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual({ from: "2026-08-01", to: "2026-08-07", index: 1 });
    expect(weeks[4]).toEqual({ from: "2026-08-29", to: "2026-08-31", index: 5 });
  });
});

describe("monthly equivalents", () => {
  it("annualises weekly rather than assuming 4 weeks a month", () => {
    // 100/week is 433/month (52/12), not 400 — the naive figure is ~8% low.
    expect(monthlyEquivalent(100, "weekly")).toBe(433);
    expect(monthlyEquivalent(1200, "yearly")).toBe(100);
    expect(monthlyEquivalent(300, "quarterly")).toBe(100);
    expect(monthlyEquivalent(500, "monthly")).toBe(500);
  });

  it("treats one-off income as no recurring baseline", () => {
    expect(incomeMonthlyEquivalent(5000, "one_off")).toBe(0);
    expect(incomeMonthlyEquivalent(1000, "biweekly")).toBe(2167);
  });
});

describe("dueDatesBetween", () => {
  it("lists monthly due dates inside the window", () => {
    const dates = dueDatesBetween(
      { cadence: "monthly", startDate: "2026-01-10", dayOfMonth: 10 },
      "2026-03-01",
      "2026-05-31",
    );
    expect(dates).toEqual(["2026-03-10", "2026-04-10", "2026-05-10"]);
  });

  it("clamps a 31st due date to short months", () => {
    const dates = dueDatesBetween(
      { cadence: "monthly", startDate: "2026-01-31", dayOfMonth: 31 },
      "2026-02-01",
      "2026-04-30",
    );
    expect(dates).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("stops at endDate", () => {
    const dates = dueDatesBetween(
      { cadence: "monthly", startDate: "2026-01-05", endDate: "2026-03-31", dayOfMonth: 5 },
      "2026-01-01",
      "2026-12-31",
    );
    expect(dates).toEqual(["2026-01-05", "2026-02-05", "2026-03-05"]);
  });

  it("stops after totalInstallments even with no endDate", () => {
    const dates = dueDatesBetween(
      { cadence: "monthly", startDate: "2026-01-05", dayOfMonth: 5, totalInstallments: 3 },
      "2026-01-01",
      "2026-12-31",
    );
    expect(dates).toEqual(["2026-01-05", "2026-02-05", "2026-03-05"]);
  });

  it("never emits a date before the schedule starts", () => {
    const dates = dueDatesBetween(
      { cadence: "monthly", startDate: "2026-06-10", dayOfMonth: 10 },
      "2026-01-01",
      "2026-07-31",
    );
    expect(dates).toEqual(["2026-06-10", "2026-07-10"]);
  });

  it("handles quarterly and yearly steps", () => {
    expect(
      dueDatesBetween(
        { cadence: "quarterly", startDate: "2026-01-15", dayOfMonth: 15 },
        "2026-01-01",
        "2026-12-31",
      ),
    ).toEqual(["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"]);

    expect(
      dueDatesBetween(
        { cadence: "yearly", startDate: "2026-03-01", dayOfMonth: 1 },
        "2026-01-01",
        "2028-12-31",
      ),
    ).toEqual(["2026-03-01", "2027-03-01", "2028-03-01"]);
  });

  it("lands weekly schedules on the requested weekday", () => {
    // 2026-08-03 is a Monday.
    const dates = dueDatesBetween(
      { cadence: "weekly", startDate: "2026-08-03", dayOfWeek: 1 },
      "2026-08-01",
      "2026-08-31",
    );
    expect(dates).toEqual(["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31"]);
  });

  it("returns nothing when the window precedes the schedule", () => {
    expect(
      dueDatesBetween(
        { cadence: "monthly", startDate: "2027-01-01", dayOfMonth: 1 },
        "2026-01-01",
        "2026-12-31",
      ),
    ).toEqual([]);
  });
});

describe("remainingInstallments", () => {
  it("counts down a fixed-term EMI", () => {
    const emi = {
      cadence: "monthly" as const,
      startDate: "2026-01-05",
      dayOfMonth: 5,
      totalInstallments: 60,
    };
    expect(remainingInstallments(emi, "2026-01-05")).toBe(59);
    expect(remainingInstallments(emi, "2026-06-05")).toBe(54);
    expect(remainingInstallments(emi, "2031-12-31")).toBe(0);
  });

  it("is null for an open-ended commitment", () => {
    expect(
      remainingInstallments(
        { cadence: "monthly", startDate: "2026-01-05", dayOfMonth: 5 },
        "2026-06-01",
      ),
    ).toBeNull();
  });
});

describe("period keys", () => {
  it("keys each cadence distinctly", () => {
    expect(periodKeyFor("monthly", "2026-08-14")).toBe("2026-08");
    expect(periodKeyFor("quarterly", "2026-08-14")).toBe("2026-Q3");
    expect(periodKeyFor("yearly", "2026-08-14")).toBe("2026");
    expect(periodKeyFor("weekly", "2026-08-14")).toBe(isoWeekKey("2026-08-14"));
  });

  it("computes ISO week numbers", () => {
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
    expect(isoWeekKey("2026-08-14")).toBe("2026-W33");
  });
});
