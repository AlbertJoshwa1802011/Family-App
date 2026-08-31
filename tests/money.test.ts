import { describe, expect, it } from "vitest";
import {
  currencyExponent,
  formatMajorFromMinor,
  monthRange,
  parseMajorToMinor,
} from "../src/lib/money";
import {
  MoneyValidationError,
  splitEqual,
  splitPercentage,
  validateExact,
} from "../worker/lib/money";

describe("currency exponents", () => {
  it("uses 2 decimals by default and 0 for zero-decimal currencies", () => {
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("inr")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
  });
});

describe("parseMajorToMinor", () => {
  it("parses plain and grouped amounts", () => {
    expect(parseMajorToMinor("450", "USD")).toBe(45000);
    expect(parseMajorToMinor("450.5", "USD")).toBe(45050);
    expect(parseMajorToMinor("1,234.56", "USD")).toBe(123456);
  });

  it("respects zero-decimal currencies", () => {
    expect(parseMajorToMinor("1200", "JPY")).toBe(1200);
    expect(parseMajorToMinor("1200.5", "JPY")).toBeNull();
  });

  it("rejects junk and over-precise input", () => {
    expect(parseMajorToMinor("", "USD")).toBeNull();
    expect(parseMajorToMinor("abc", "USD")).toBeNull();
    expect(parseMajorToMinor("1.234", "USD")).toBeNull();
  });

  it("round-trips through formatMajorFromMinor", () => {
    const minor = parseMajorToMinor("99.90", "USD")!;
    expect(formatMajorFromMinor(minor, "USD")).toBe("99.90");
  });
});

describe("monthRange", () => {
  it("covers the whole month, including February in a leap year", () => {
    expect(monthRange("2026-08-14")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(monthRange("2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("split math", () => {
  it("splits equally and gives the remainder to the lowest memberId", () => {
    const shares = splitEqual(1000, ["b", "a", "c"]);
    expect(shares.reduce((s, x) => s + x.shareMinor, 0)).toBe(1000);
    const byId = Object.fromEntries(shares.map((s) => [s.memberId, s.shareMinor]));
    expect(byId.a).toBe(334); // 333 + the 1 remainder unit
    expect(byId.b).toBe(333);
    expect(byId.c).toBe(333);
  });

  it("splits by percentage in basis points", () => {
    const shares = splitPercentage(1000, [
      { memberId: "a", sharePercentBp: 2500 },
      { memberId: "b", sharePercentBp: 7500 },
    ]);
    expect(shares.reduce((s, x) => s + x.shareMinor, 0)).toBe(1000);
  });

  it("rejects percentages that don't sum to 100%", () => {
    expect(() =>
      splitPercentage(1000, [
        { memberId: "a", sharePercentBp: 2500 },
        { memberId: "b", sharePercentBp: 2500 },
      ]),
    ).toThrow(MoneyValidationError);
  });

  it("rejects exact shares that don't sum to the total", () => {
    expect(() =>
      validateExact(1000, [
        { memberId: "a", shareMinor: 400 },
        { memberId: "b", shareMinor: 400 },
      ]),
    ).toThrow(MoneyValidationError);
  });

  it("rejects a duplicate participant", () => {
    expect(() => splitEqual(1000, ["a", "a"])).toThrow(MoneyValidationError);
  });
});
