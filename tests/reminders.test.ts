/**
 * Unit tests for the pure reminder-windowing logic (worker/lib/reminders.ts).
 *
 * Fixtures use Date.UTC(...) so they are timezone-stable regardless of where
 * CI runs. "Today" is pinned to 2026-06-09 (UTC midnight) throughout.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOWS,
  daysUntilIso,
  daysUntilUnix,
  dueReminderWindow,
  eventReminderText,
  expiryReminderText,
  parseWindows,
} from "../worker/lib/reminders";

const TODAY = Date.UTC(2026, 5, 9); // 2026-06-09 00:00 UTC, in ms

// ── daysUntilIso ─────────────────────────────────────────────────────────────

describe("daysUntilIso", () => {
  it("returns 0 for today", () => {
    expect(daysUntilIso("2026-06-09", TODAY)).toBe(0);
  });

  it("returns positive days for a future date", () => {
    expect(daysUntilIso("2026-06-19", TODAY)).toBe(10);
    expect(daysUntilIso("2026-07-09", TODAY)).toBe(30);
  });

  it("returns negative days for a past (expired) date", () => {
    expect(daysUntilIso("2026-06-08", TODAY)).toBe(-1);
    expect(daysUntilIso("2026-05-10", TODAY)).toBe(-30);
  });

  it("is stable across the local-midnight boundary (UTC compare)", () => {
    // 23:30 UTC on 2026-06-09 — still 'today', so a date of 06-10 is 1 day out.
    const lateNight = Date.UTC(2026, 5, 9, 23, 30);
    expect(daysUntilIso("2026-06-10", lateNight)).toBe(1);
    expect(daysUntilIso("2026-06-09", lateNight)).toBe(0);
  });

  it("returns null for malformed input", () => {
    expect(daysUntilIso("not-a-date", TODAY)).toBeNull();
    expect(daysUntilIso("2026-06", TODAY)).toBeNull();
    expect(daysUntilIso("", TODAY)).toBeNull();
  });
});

// ── daysUntilUnix ────────────────────────────────────────────────────────────

describe("daysUntilUnix", () => {
  it("counts whole days to a unix-seconds instant", () => {
    const inTenDays = Math.floor(Date.UTC(2026, 5, 19, 15, 0) / 1000);
    expect(daysUntilUnix(inTenDays, TODAY)).toBe(10);
  });

  it("returns 0 for an event later today", () => {
    const laterToday = Math.floor(Date.UTC(2026, 5, 9, 18, 0) / 1000);
    expect(daysUntilUnix(laterToday, TODAY)).toBe(0);
  });

  it("returns negative for a past event", () => {
    const yesterday = Math.floor(Date.UTC(2026, 5, 8, 9, 0) / 1000);
    expect(daysUntilUnix(yesterday, TODAY)).toBe(-1);
  });
});

// ── dueReminderWindow ────────────────────────────────────────────────────────

describe("dueReminderWindow", () => {
  const W = [30, 7, 1];

  it("fires the 30-window when only 30 applies", () => {
    expect(dueReminderWindow(25, W)).toBe(30);
    expect(dueReminderWindow(8, W)).toBe(30);
  });

  it("fires the tightest applicable window", () => {
    expect(dueReminderWindow(7, W)).toBe(7);
    expect(dueReminderWindow(5, W)).toBe(7);
    expect(dueReminderWindow(1, W)).toBe(1);
    expect(dueReminderWindow(0, W)).toBe(1);
  });

  it("treats expired (negative) as the tightest window", () => {
    expect(dueReminderWindow(-3, W)).toBe(1);
  });

  it("returns null when still beyond every window", () => {
    expect(dueReminderWindow(45, W)).toBeNull();
    expect(dueReminderWindow(31, W)).toBeNull();
  });

  it("returns null for empty windows", () => {
    expect(dueReminderWindow(5, [])).toBeNull();
  });

  it("models a countdown firing each window exactly once", () => {
    // As days tick down, the *selected* window changes only at each crossing,
    // so paired with per-window dedupe each window fires once.
    expect(dueReminderWindow(30, W)).toBe(30); // first cross into 30
    expect(dueReminderWindow(20, W)).toBe(30); // same window → deduped
    expect(dueReminderWindow(7, W)).toBe(7); // cross into 7
    expect(dueReminderWindow(2, W)).toBe(7); // same window → deduped
    expect(dueReminderWindow(1, W)).toBe(1); // cross into 1
  });
});

// ── parseWindows ─────────────────────────────────────────────────────────────

describe("parseWindows", () => {
  it("defaults on null/undefined/empty", () => {
    expect(parseWindows(null)).toEqual(DEFAULT_WINDOWS);
    expect(parseWindows(undefined)).toEqual(DEFAULT_WINDOWS);
    expect(parseWindows("")).toEqual(DEFAULT_WINDOWS);
  });

  it("defaults on malformed JSON", () => {
    expect(parseWindows("{not json")).toEqual(DEFAULT_WINDOWS);
    expect(parseWindows('"a string"')).toEqual(DEFAULT_WINDOWS);
    expect(parseWindows("42")).toEqual(DEFAULT_WINDOWS);
  });

  it("sorts descending, de-dupes, and drops invalid entries", () => {
    expect(parseWindows("[7, 30, 1]")).toEqual([30, 7, 1]);
    expect(parseWindows("[7, 7, 30, 30]")).toEqual([30, 7]);
    expect(parseWindows("[3, -1, 0, 1.5, 14]")).toEqual([14, 3]);
  });

  it("falls back to defaults if nothing valid survives", () => {
    expect(parseWindows("[-1, 0, 2.5]")).toEqual(DEFAULT_WINDOWS);
    expect(parseWindows("[]")).toEqual(DEFAULT_WINDOWS);
  });

  it("returns a fresh array (not the shared default reference)", () => {
    const a = parseWindows(null);
    a.push(999);
    expect(parseWindows(null)).toEqual(DEFAULT_WINDOWS);
  });
});

// ── reminder text ────────────────────────────────────────────────────────────

describe("expiryReminderText", () => {
  it("phrases an expired document", () => {
    const t = expiryReminderText("Passport", -2);
    expect(t.title).toContain("Expired");
    expect(t.body).toContain("2 days ago");
  });

  it("phrases an expiring-today document", () => {
    const t = expiryReminderText("Passport", 0);
    expect(t.title).toContain("today");
  });

  it("phrases a future document with singular/plural days", () => {
    expect(expiryReminderText("Visa", 1).body).toContain("1 day");
    expect(expiryReminderText("Visa", 5).body).toContain("5 days");
  });
});

describe("eventReminderText", () => {
  it("phrases a today event", () => {
    expect(eventReminderText("Dentist", 0).title).toContain("Today");
  });

  it("phrases an upcoming event", () => {
    expect(eventReminderText("Trip", 3).body).toContain("3 days");
    expect(eventReminderText("Trip", 1).body).toContain("1 day");
  });
});
