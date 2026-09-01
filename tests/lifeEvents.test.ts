/**
 * Pure life-event windowing (birthday / anniversary).
 */
import { describe, expect, it } from "vitest";
import {
  daysUntilLifeEvent,
  nextOccurrenceMs,
  upcomingLifeEvents,
  weekdayLabel,
} from "../worker/lib/lifeEvents";

/** Fixed "today": 2026-09-01 UTC. */
const NOW = Date.UTC(2026, 8, 1);

describe("daysUntilLifeEvent", () => {
  it("returns 0 when the month-day is today", () => {
    expect(daysUntilLifeEvent("1990-09-01", NOW)).toBe(0);
  });

  it("returns days until later this year", () => {
    expect(daysUntilLifeEvent("1990-09-05", NOW)).toBe(4);
  });

  it("rolls to next year when the date already passed", () => {
    // Aug 15 already passed → next is 2027-08-15.
    const days = daysUntilLifeEvent("1990-08-15", NOW);
    expect(days).toBeGreaterThan(300);
  });

  it("returns null for malformed dates", () => {
    expect(daysUntilLifeEvent("not-a-date", NOW)).toBeNull();
    expect(daysUntilLifeEvent("09-01", NOW)).toBeNull();
  });
});

describe("upcomingLifeEvents", () => {
  it("includes birthdays and anniversaries within the window", () => {
    const events = upcomingLifeEvents(
      [
        {
          id: "m1",
          name: "Priya",
          dateOfBirth: "1995-09-05",
          anniversaryDate: null,
        },
        {
          id: "m2",
          name: "Arun",
          dateOfBirth: null,
          anniversaryDate: "2018-09-03",
        },
        {
          id: "m3",
          name: "Far",
          dateOfBirth: "2000-12-01",
          anniversaryDate: null,
        },
      ],
      NOW,
      14,
    );

    expect(events.map((e) => `${e.name}:${e.kind}`)).toEqual([
      "Arun:anniversary",
      "Priya:birthday",
    ]);
    expect(events[0]!.daysUntil).toBe(2);
    expect(events[1]!.daysUntil).toBe(4);
    expect(events[0]!.occurrenceYear).toBe(2026);
  });

  it("excludes events beyond the window", () => {
    const events = upcomingLifeEvents(
      [{ id: "m1", name: "Priya", dateOfBirth: "1995-09-20", anniversaryDate: null }],
      NOW,
      7,
    );
    expect(events).toHaveLength(0);
  });
});

describe("weekdayLabel / nextOccurrenceMs", () => {
  it("labels Saturday for 2026-09-05", () => {
    expect(weekdayLabel("2026-09-05")).toBe("Saturday");
  });

  it("nextOccurrenceMs lands on UTC midnight of the next date", () => {
    const ms = nextOccurrenceMs("1990-09-05", NOW);
    expect(ms).toBe(Date.UTC(2026, 8, 5));
  });
});
