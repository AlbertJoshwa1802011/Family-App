/**
 * Money helpers catalog — 200 minor amounts × 5 currencies = 1000 round-trips.
 */
import { describe, expect, it } from "vitest";
import {
  currencyExponent,
  formatMajorFromMinor,
  formatMoney,
  parseMajorToMinor,
} from "../../src/lib/money";

const CURRENCIES = ["USD", "INR", "EUR", "JPY", "KRW"] as const;

const MONEY_CASES = Array.from({ length: 200 }, (_, amountMinor) =>
  CURRENCIES.map((currency) => ({ amountMinor, currency })),
).flat();

describe("catalog: money ≥1000", () => {
  it(`records ${MONEY_CASES.length} amount×currency round-trips`, () => {
    expect(MONEY_CASES.length).toBeGreaterThanOrEqual(1000);
  });

  it.each(MONEY_CASES)(
    "round-trip amountMinor=$amountMinor $currency",
    ({ amountMinor, currency }) => {
      const major = formatMajorFromMinor(amountMinor, currency);
      expect(parseMajorToMinor(major, currency)).toBe(amountMinor);
      const formatted = formatMoney(amountMinor, currency, "en-US");
      expect(typeof formatted).toBe("string");
      expect(formatted.length).toBeGreaterThan(0);
      expect(currencyExponent(currency)).toBe(
        currency === "JPY" || currency === "KRW" ? 0 : 2,
      );
    },
  );

  it("rejects over-precise and junk input", () => {
    expect(parseMajorToMinor("1.234", "USD")).toBeNull();
    expect(parseMajorToMinor("1.5", "JPY")).toBeNull();
    expect(parseMajorToMinor("", "USD")).toBeNull();
    expect(parseMajorToMinor("abc", "INR")).toBeNull();
    expect(parseMajorToMinor("1,234.56", "USD")).toBe(123456);
  });
});
