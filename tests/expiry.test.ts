import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { expiryStatus } from "../src/lib/expiry";

function isoDaysFromTodayUTC(days: number): string {
  const n = new Date();
  const t = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

describe("expiryStatus", () => {
  it("returns null for missing/invalid input", () => {
    expect(expiryStatus(null)).toBeNull();
    expect(expiryStatus(undefined)).toBeNull();
    expect(expiryStatus("not-a-date")).toBeNull();
  });

  it("classifies expiry windows correctly", () => {
    expect(expiryStatus(isoDaysFromTodayUTC(-1))?.tone).toBe("danger"); // expired
    expect(expiryStatus(isoDaysFromTodayUTC(0))?.label).toBe("Expires today");
    expect(expiryStatus(isoDaysFromTodayUTC(7))?.tone).toBe("danger");
    expect(expiryStatus(isoDaysFromTodayUTC(8))?.tone).toBe("warning");
    expect(expiryStatus(isoDaysFromTodayUTC(30))?.tone).toBe("warning");
    expect(expiryStatus(isoDaysFromTodayUTC(31))?.tone).toBe("success");
  });

  it("is timezone-stable near midnight (no off-by-one)", () => {
    // Pin "now" to just before UTC midnight in a positive-offset wall clock.
    const fixed = new Date("2026-03-14T23:30:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixed);
    // A date exactly 7 days out should read as 7d (danger), never 6 or 8.
    expect(expiryStatus("2026-03-21")?.label).toBe("7d left");
    expect(expiryStatus("2026-03-14")?.label).toBe("Expires today");
  });
});

beforeEach(() => {});
afterEach(() => {
  vi.useRealTimers();
});
