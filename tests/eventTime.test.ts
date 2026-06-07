/**
 * Tests for src/lib/eventTime.ts
 * Covers all formatting functions and event type color mapping.
 */
import { describe, expect, it } from "vitest";
import {
  eventMonthKey,
  eventTypeColor,
  formatEventDate,
  formatEventTime,
  formatMonthYear,
} from "../src/lib/eventTime";

// Fixed UTC timestamps for deterministic output (computed via Date.UTC to avoid hardcoding errors).
// Month is 0-indexed in Date.UTC: June = 5
const JUN_14_09_00_UTC = Date.UTC(2026, 5, 14, 9, 0, 0) / 1000;
const JUN_14_10_30_UTC = Date.UTC(2026, 5, 14, 10, 30, 0) / 1000;
const JUL_01_00_00_UTC = Date.UTC(2026, 6, 1, 0, 0, 0) / 1000;
const JUN_01_00_00_UTC = Date.UTC(2026, 5, 1, 0, 0, 0) / 1000;

describe("formatEventDate", () => {
  it("returns a non-empty string for any valid timestamp", () => {
    const result = formatEventDate(JUN_14_09_00_UTC);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("includes the day number in the formatted string", () => {
    const result = formatEventDate(JUN_14_09_00_UTC);
    expect(result).toContain("14");
  });
});

describe("formatEventTime", () => {
  it("returns date-only string for all-day events (no time)", () => {
    const result = formatEventTime(JUN_14_09_00_UTC, null, true);
    // Should not contain colon (time separator)
    expect(result).not.toMatch(/\d:\d/);
  });

  it("all-day events ignore endAt", () => {
    const withEnd = formatEventTime(JUN_14_09_00_UTC, JUN_14_10_30_UTC, true);
    const withoutEnd = formatEventTime(JUN_14_09_00_UTC, null, true);
    expect(withEnd).toBe(withoutEnd);
  });

  it("timed event with endAt shows time range with dash separator", () => {
    const result = formatEventTime(JUN_14_09_00_UTC, JUN_14_10_30_UTC, false);
    expect(result).toContain("–");
  });

  it("timed event without endAt shows date and single time", () => {
    const result = formatEventTime(JUN_14_09_00_UTC, null, false);
    expect(result).not.toContain("–");
  });

  it("timed event includes both date and time portion", () => {
    const result = formatEventTime(JUN_14_09_00_UTC, null, false);
    // Contains the · separator between date and time
    expect(result).toContain("·");
  });

  it("handles endAt === null explicitly", () => {
    expect(() =>
      formatEventTime(JUN_14_09_00_UTC, null, false),
    ).not.toThrow();
  });

  it("handles endAt === undefined (same as null)", () => {
    expect(() =>
      formatEventTime(JUN_14_09_00_UTC, undefined, false),
    ).not.toThrow();
  });
});

describe("formatMonthYear", () => {
  it("returns a non-empty string", () => {
    const result = formatMonthYear(JUN_14_09_00_UTC);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("includes the year in the formatted string", () => {
    const result = formatMonthYear(JUN_14_09_00_UTC);
    expect(result).toContain("2026");
  });
});

describe("eventMonthKey", () => {
  it("returns a consistent key string", () => {
    const key = eventMonthKey(JUN_14_09_00_UTC);
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });

  it("two timestamps in the same calendar month produce the same key", () => {
    const mid = eventMonthKey(JUN_14_09_00_UTC);
    const start = eventMonthKey(JUN_01_00_00_UTC);
    expect(mid).toBe(start);
  });

  it("timestamps in different months produce different keys", () => {
    const julyKey = eventMonthKey(JUL_01_00_00_UTC);
    const juneKey = eventMonthKey(JUN_14_09_00_UTC);
    expect(julyKey).not.toBe(juneKey);
  });

  it("key format is year-month (deterministic, not locale-dependent)", () => {
    // The key should be stable regardless of locale since it uses JS date internals
    const key = eventMonthKey(JUN_14_09_00_UTC);
    // Key is "year-month_index", e.g. "2026-5" for June (0-indexed month)
    expect(key).toMatch(/^\d{4}-\d+$/);
  });
});

describe("eventTypeColor", () => {
  it("returns an object with bg, text, and dot keys for all known types", () => {
    const types = ["gathering", "appointment", "milestone", "other"];
    for (const type of types) {
      const colors = eventTypeColor(type);
      expect(colors).toHaveProperty("bg");
      expect(colors).toHaveProperty("text");
      expect(colors).toHaveProperty("dot");
      expect(typeof colors.bg).toBe("string");
      expect(typeof colors.text).toBe("string");
      expect(typeof colors.dot).toBe("string");
    }
  });

  it("gathering returns orange-toned colors", () => {
    const colors = eventTypeColor("gathering");
    expect(colors.dot).toContain("orange");
  });

  it("appointment returns info/blue-toned colors", () => {
    const colors = eventTypeColor("appointment");
    expect(colors.dot).toContain("info");
  });

  it("milestone returns purple-toned colors", () => {
    const colors = eventTypeColor("milestone");
    expect(colors.dot).toContain("purple");
  });

  it("unknown type returns neutral/muted colors (fallback)", () => {
    const colors = eventTypeColor("unknown-type");
    expect(colors.bg).not.toContain("orange");
    expect(colors.bg).not.toContain("info");
    expect(colors.bg).not.toContain("purple");
  });

  it("all color strings are non-empty Tailwind class strings", () => {
    const colors = eventTypeColor("gathering");
    expect(colors.bg.length).toBeGreaterThan(0);
    expect(colors.text.length).toBeGreaterThan(0);
    expect(colors.dot.length).toBeGreaterThan(0);
  });
});
