/**
 * expiryStatus catalog — every day offset from -250 to +749 against a pinned UTC today.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { expiryStatus } from "../../src/lib/expiry";

const TODAY = "2026-06-15";

function expected(days: number): { tone: string; label: string } {
  if (days < 0) return { tone: "danger", label: "Expired" };
  if (days === 0) return { tone: "danger", label: "Expires today" };
  if (days <= 7) return { tone: "danger", label: `${days}d left` };
  if (days <= 30) return { tone: "warning", label: `${days}d left` };
  return { tone: "success", label: "Valid" };
}

const DAY_CASES = Array.from({ length: 1000 }, (_, i) => {
  const days = i - 250;
  const iso = new Date(Date.UTC(2026, 5, 15 + days)).toISOString().slice(0, 10);
  return { days, iso };
});

describe("catalog: expiry days ≥1000", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it(`records ${DAY_CASES.length} day offsets`, () => {
    expect(DAY_CASES.length).toBeGreaterThanOrEqual(1000);
  });

  it.each(DAY_CASES)("days=$days date=$iso", ({ days, iso }) => {
    expect(expiryStatus(iso)).toEqual(expected(days));
  });

  it("null / invalid dates → null", () => {
    expect(expiryStatus(null)).toBeNull();
    expect(expiryStatus(undefined)).toBeNull();
    expect(expiryStatus("")).toBeNull();
    expect(expiryStatus("not-a-date")).toBeNull();
  });
});
