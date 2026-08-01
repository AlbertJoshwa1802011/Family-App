import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  MAX_AMOUNT_MINOR,
  currencyExponent,
  formatMoney,
  formatMoneyCompact,
  fromMinorUnits,
  isSupportedCurrency,
  isValidAmountMinor,
  percentChange,
  toMinorUnits,
  totalByCurrency,
} from "../shared/money";

describe("currency metadata", () => {
  it("defaults to INR", () => {
    expect(DEFAULT_CURRENCY).toBe("INR");
    expect(CURRENCIES.INR.exponent).toBe(2);
  });

  it("knows zero-decimal currencies", () => {
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("USD")).toBe(2);
  });

  it("recognises supported codes and rejects junk", () => {
    expect(isSupportedCurrency("INR")).toBe(true);
    expect(isSupportedCurrency("XYZ")).toBe(false);
    // Must not be fooled by inherited Object properties.
    expect(isSupportedCurrency("toString")).toBe(false);
    expect(isSupportedCurrency("constructor")).toBe(false);
  });

  it("falls back to the default currency for unknown codes", () => {
    expect(currencyExponent("XYZ")).toBe(2);
  });
});

describe("toMinorUnits", () => {
  it("parses whole and decimal amounts", () => {
    expect(toMinorUnits("450")).toBe(45000);
    expect(toMinorUnits("450.75")).toBe(45075);
    expect(toMinorUnits("0.05")).toBe(5);
    expect(toMinorUnits(450)).toBe(45000);
    expect(toMinorUnits(450.75)).toBe(45075);
  });

  it("pads short fractions", () => {
    expect(toMinorUnits("450.5")).toBe(45050);
  });

  it("tolerates separators and currency symbols", () => {
    expect(toMinorUnits("1,234.50")).toBe(123450);
    expect(toMinorUnits(" ₹450 ")).toBe(45000);
    expect(toMinorUnits("$12.30", "USD")).toBe(1230);
  });

  it("rounds half-up on the first dropped digit", () => {
    expect(toMinorUnits("450.754")).toBe(45075);
    expect(toMinorUnits("450.755")).toBe(45076);
    expect(toMinorUnits("450.999")).toBe(45100);
  });

  it("avoids binary float drift", () => {
    // Math.round(1.005 * 100) is 100 — the classic bug. String parsing is exact.
    expect(toMinorUnits("1.005")).toBe(101);
    expect(toMinorUnits("8.165")).toBe(817);
  });

  it("honours the currency exponent", () => {
    expect(toMinorUnits("1200", "JPY")).toBe(1200);
    expect(toMinorUnits("1200.6", "JPY")).toBe(1201);
  });

  it("rejects invalid input", () => {
    expect(toMinorUnits("")).toBeNull();
    expect(toMinorUnits("   ")).toBeNull();
    expect(toMinorUnits("abc")).toBeNull();
    expect(toMinorUnits("12.34.56")).toBeNull();
    expect(toMinorUnits("12e5")).toBeNull();
    expect(toMinorUnits(Number.NaN)).toBeNull();
    expect(toMinorUnits(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("rejects negative amounts — refunds are not negative expenses", () => {
    expect(toMinorUnits("-450")).toBeNull();
    expect(toMinorUnits(-450)).toBeNull();
  });

  it("rejects amounts beyond the safe range", () => {
    expect(toMinorUnits("999999999999999999")).toBeNull();
  });
});

describe("fromMinorUnits / isValidAmountMinor", () => {
  it("round-trips", () => {
    expect(fromMinorUnits(45075)).toBe(450.75);
    expect(fromMinorUnits(1200, "JPY")).toBe(1200);
  });

  it("accepts only positive safe integers in range", () => {
    expect(isValidAmountMinor(1)).toBe(true);
    expect(isValidAmountMinor(MAX_AMOUNT_MINOR)).toBe(true);
    expect(isValidAmountMinor(0)).toBe(false);
    expect(isValidAmountMinor(-1)).toBe(false);
    expect(isValidAmountMinor(1.5)).toBe(false);
    expect(isValidAmountMinor(MAX_AMOUNT_MINOR + 1)).toBe(false);
    expect(isValidAmountMinor("100")).toBe(false);
    expect(isValidAmountMinor(Number.NaN)).toBe(false);
  });
});

describe("formatMoney", () => {
  it("renders the symbol and both decimals", () => {
    const out = formatMoney(4507550, "INR");
    expect(out).toContain("₹");
    expect(out).toContain("45,075.50");
  });

  it("groups INR in lakhs", () => {
    // ₹12,34,567.00 — not ₹1,234,567.00
    expect(formatMoney(123456700, "INR")).toContain("12,34,567");
  });

  it("respects zero-decimal currencies", () => {
    expect(formatMoney(1200, "JPY")).not.toContain(".");
  });

  it("can drop decimals for dense surfaces", () => {
    expect(formatMoney(4507550, "INR", { whole: true })).not.toContain(".");
  });

  it("never throws on an unknown currency", () => {
    expect(() => formatMoney(1000, "XYZ")).not.toThrow();
  });
});

describe("formatMoneyCompact", () => {
  it("uses lakh/crore for INR", () => {
    expect(formatMoneyCompact(1250000, "INR")).toBe("₹12.5K");
    expect(formatMoneyCompact(20000000, "INR")).toBe("₹2L");
    // 5,000,000,000 paise = ₹5,00,00,000 = ₹5 crore
    expect(formatMoneyCompact(500000000, "INR")).toBe("₹50L");
    expect(formatMoneyCompact(5000000000, "INR")).toBe("₹5Cr");
  });

  it("uses K/M/B elsewhere", () => {
    expect(formatMoneyCompact(1250000, "USD")).toBe("$12.5K");
    expect(formatMoneyCompact(500000000, "USD")).toBe("$5M");
  });

  it("keeps small amounts fully readable", () => {
    expect(formatMoneyCompact(45000, "INR")).toContain("450");
  });
});

describe("percentChange", () => {
  it("computes month-over-month change", () => {
    expect(percentChange(110, 100)).toBeCloseTo(10);
    expect(percentChange(90, 100)).toBeCloseTo(-10);
  });

  it("returns null without a baseline — no divide-by-zero infinities", () => {
    expect(percentChange(500, 0)).toBeNull();
  });
});

describe("totalByCurrency", () => {
  it("totals a single currency", () => {
    const t = totalByCurrency([
      { currency: "INR", amountMinor: 1000 },
      { currency: "INR", amountMinor: 500 },
    ]);
    expect(t.mixed).toBe(false);
    expect(t.singleCurrency).toEqual({ currency: "INR", totalMinor: 1500 });
  });

  it("NEVER merges different currencies into one number", () => {
    const t = totalByCurrency([
      { currency: "INR", amountMinor: 1000 },
      { currency: "USD", amountMinor: 500 },
    ]);
    expect(t.mixed).toBe(true);
    expect(t.singleCurrency).toBeNull();
    expect(t.byCurrency).toHaveLength(2);
    expect(t.byCurrency.map((c) => c.currency).sort()).toEqual(["INR", "USD"]);
  });

  it("handles an empty set", () => {
    const t = totalByCurrency([]);
    expect(t.mixed).toBe(false);
    expect(t.singleCurrency).toBeNull();
    expect(t.byCurrency).toEqual([]);
  });
});
