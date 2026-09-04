import { describe, expect, it } from "vitest";
import {
  calendarCells,
  categoryQueryValue,
  daysInMonth,
  donutSlices,
  DONUT_CIRCUMFERENCE,
  isoDateInMonth,
  mondayIndex,
} from "../src/lib/spendClarity";

describe("spendClarity calendar", () => {
  it("maps Sunday–Saturday onto a Monday-first index", () => {
    // 2026-09-01 is a Tuesday → one leading blank in a Monday grid.
    expect(mondayIndex("2026-09-01")).toBe(1);
    // 2026-08-02 is a Sunday.
    expect(mondayIndex("2026-08-02")).toBe(6);
    expect(daysInMonth("2026-09-01")).toBe(30);
    expect(isoDateInMonth("2026-09-01", 9)).toBe("2026-09-09");
  });

  it("pads leading blanks and heats relative to the busiest day", () => {
    const cells = calendarCells("2026-09-01", [
      { date: "2026-09-01", totalMinor: 100, count: 1 },
      { date: "2026-09-10", totalMinor: 1000, count: 2 },
    ]);
    expect(cells[0]).toMatchObject({ date: null, day: null, intensity: 0 });
    expect(cells[1]).toMatchObject({
      date: "2026-09-01",
      day: 1,
      totalMinor: 100,
      intensity: 1,
    });
    const tenth = cells.find((c) => c.date === "2026-09-10");
    expect(tenth).toMatchObject({ day: 10, totalMinor: 1000, intensity: 4 });
    expect(cells.filter((c) => c.date)).toHaveLength(30);
  });
});

describe("spendClarity donut", () => {
  it("encodes shares as dash lengths that sum to the circumference", () => {
    const slices = donutSlices(
      [
        { categoryId: "a", name: "Food", color: "#f00", totalMinor: 750, count: 3 },
        { categoryId: null, name: "Uncategorized", color: null, totalMinor: 250, count: 1 },
      ],
      1000,
    );
    expect(slices).toHaveLength(2);
    expect(slices[0].share).toBe(0.75);
    expect(slices[0].dash).toBeCloseTo(DONUT_CIRCUMFERENCE * 0.75);
    expect(slices[1].key).toBe("none");
    expect(slices[1].color).toBe("#64748b");
    expect(slices[0].dash + slices[1].dash).toBeCloseTo(DONUT_CIRCUMFERENCE);
    expect(slices[1].offset).toBeCloseTo(-slices[0].dash);
  });

  it("returns no slices when the month is empty", () => {
    expect(donutSlices([], 0)).toEqual([]);
  });

  it("maps a null category to the none query value", () => {
    expect(categoryQueryValue(null)).toBe("none");
    expect(categoryQueryValue("builtin_food")).toBe("builtin_food");
  });
});
