/**
 * Money handling — shared by the Worker and the SPA.
 *
 * THE RULE: money is stored, transported and summed as an INTEGER number of
 * minor units (paise, cents) together with its ISO-4217 currency code. Floats
 * never touch a stored amount: SQLite has no DECIMAL, and repeatedly summing
 * REAL values drifts. Conversion to a human decimal happens only at the edges —
 * parsing user input (`toMinorUnits`) and rendering (`formatMoney`).
 *
 * V1 does NO currency conversion. Totals are always grouped by currency;
 * callers must never add amounts of different currencies together.
 */

export interface CurrencyMeta {
  code: string;
  symbol: string;
  /** Number of decimal places, i.e. minor units per major unit = 10 ** exponent. */
  exponent: number;
  name: string;
  /** Locale used for grouping (e.g. INR groups in lakhs: ₹1,23,456.00). */
  locale: string;
}

export const CURRENCIES = {
  INR: { code: "INR", symbol: "₹", exponent: 2, name: "Indian Rupee", locale: "en-IN" },
  USD: { code: "USD", symbol: "$", exponent: 2, name: "US Dollar", locale: "en-US" },
  EUR: { code: "EUR", symbol: "€", exponent: 2, name: "Euro", locale: "en-IE" },
  GBP: { code: "GBP", symbol: "£", exponent: 2, name: "British Pound", locale: "en-GB" },
  AED: { code: "AED", symbol: "AED", exponent: 2, name: "UAE Dirham", locale: "en-AE" },
  SGD: { code: "SGD", symbol: "S$", exponent: 2, name: "Singapore Dollar", locale: "en-SG" },
  AUD: { code: "AUD", symbol: "A$", exponent: 2, name: "Australian Dollar", locale: "en-AU" },
  CAD: { code: "CAD", symbol: "C$", exponent: 2, name: "Canadian Dollar", locale: "en-CA" },
  CHF: { code: "CHF", symbol: "CHF", exponent: 2, name: "Swiss Franc", locale: "de-CH" },
  JPY: { code: "JPY", symbol: "¥", exponent: 0, name: "Japanese Yen", locale: "ja-JP" },
} as const satisfies Record<string, CurrencyMeta>;

export type CurrencyCode = keyof typeof CURRENCIES;

/** Default for new families. Configurable per family — never hard-code downstream. */
export const DEFAULT_CURRENCY: CurrencyCode = "INR";

export const SUPPORTED_CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export function isSupportedCurrency(code: string): code is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, code);
}

export function currencyMeta(code: string): CurrencyMeta {
  return isSupportedCurrency(code) ? CURRENCIES[code] : CURRENCIES[DEFAULT_CURRENCY];
}

export function currencyExponent(code: string): number {
  return currencyMeta(code).exponent;
}

/**
 * Largest amount we accept, in minor units (~9.0e12 = ₹90 billion). Keeps every
 * intermediate SUM() comfortably inside IEEE-754 safe-integer range even after
 * aggregating millions of rows.
 */
export const MAX_AMOUNT_MINOR = 9_000_000_000_000;

/**
 * Parse user input ("450", "450.75", "1,234.5", "₹ 450") into minor units.
 * Returns null for anything invalid — callers decide the error message.
 *
 * Deliberately string-based: `Math.round(450.75 * 100)` is 45075 today and a
 * latent rounding bug tomorrow (e.g. 1.005). Half-up rounding on the first
 * dropped digit.
 */
export function toMinorUnits(
  input: string | number,
  currency: string = DEFAULT_CURRENCY,
): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || Math.abs(input) >= 1e15) return null;
  }

  // Strip whitespace, thousands separators and any leading currency symbol.
  const cleaned = String(input)
    .trim()
    .replace(/[\s\u00a0,]/g, "")
    .replace(/^[^\d.-]+/, "");

  if (cleaned === "" || cleaned.startsWith("-")) return null;

  const parts = cleaned.split(".");
  if (parts.length > 2) return null;

  const [intPart, fracRaw = ""] = parts;
  if (!/^\d+$/.test(intPart)) return null;
  if (fracRaw !== "" && !/^\d+$/.test(fracRaw)) return null;
  // 15 digits keeps intPart * 10**exponent inside Number.MAX_SAFE_INTEGER.
  if (intPart.length > 15) return null;

  const exponent = currencyExponent(currency);
  const frac = fracRaw.padEnd(exponent + 1, "0");
  const kept = frac.slice(0, exponent);
  const nextDigit = Number(frac[exponent] ?? "0");

  let minor = Number(intPart) * 10 ** exponent + Number(kept === "" ? "0" : kept);
  if (nextDigit >= 5) minor += 1;

  if (!Number.isSafeInteger(minor) || minor > MAX_AMOUNT_MINOR) return null;
  return minor;
}

/** Minor units → a decimal number, for formatting only. Never for arithmetic. */
export function fromMinorUnits(
  minor: number,
  currency: string = DEFAULT_CURRENCY,
): number {
  return minor / 10 ** currencyExponent(currency);
}

/** True for a storable amount: a positive, safe integer within range. */
export function isValidAmountMinor(minor: unknown): minor is number {
  return (
    typeof minor === "number" &&
    Number.isSafeInteger(minor) &&
    minor > 0 &&
    minor <= MAX_AMOUNT_MINOR
  );
}

/**
 * Render minor units for display, e.g. 4507550 INR → "₹45,075.50".
 * `signDisplay: 'always'` is useful for deltas (+₹1,200 vs last month).
 */
export function formatMoney(
  minor: number,
  currency: string = DEFAULT_CURRENCY,
  opts: {
    /** Drop the decimal part — good for dense charts and big totals. */
    whole?: boolean;
    signDisplay?: "auto" | "always" | "never";
    locale?: string;
  } = {},
): string {
  const meta = currencyMeta(currency);
  const value = fromMinorUnits(minor, currency);
  const digits = opts.whole ? 0 : meta.exponent;

  try {
    return new Intl.NumberFormat(opts.locale ?? meta.locale, {
      style: "currency",
      currency: meta.code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      signDisplay: opts.signDisplay ?? "auto",
    }).format(value);
  } catch {
    // Unknown code or an Intl-less runtime — degrade, never throw at render.
    return `${meta.symbol}${value.toFixed(digits)}`;
  }
}

/**
 * Compact form for chart labels and stat tiles: ₹12.5K, ₹1.2L, ₹3.4Cr.
 * Indian currencies read in lakh/crore; everything else uses K/M/B.
 */
export function formatMoneyCompact(
  minor: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  const meta = currencyMeta(currency);
  const value = Math.abs(fromMinorUnits(minor, currency));
  const sign = minor < 0 ? "-" : "";

  const scales: { limit: number; div: number; suffix: string }[] =
    meta.code === "INR"
      ? [
          { limit: 1e7, div: 1e7, suffix: "Cr" },
          { limit: 1e5, div: 1e5, suffix: "L" },
          { limit: 1e3, div: 1e3, suffix: "K" },
        ]
      : [
          { limit: 1e9, div: 1e9, suffix: "B" },
          { limit: 1e6, div: 1e6, suffix: "M" },
          { limit: 1e3, div: 1e3, suffix: "K" },
        ];

  for (const { limit, div, suffix } of scales) {
    if (value >= limit) {
      const scaled = value / div;
      // 12.5K but 125K — one decimal only while it adds information.
      const text = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, "");
      return `${sign}${meta.symbol}${text}${suffix}`;
    }
  }

  return formatMoney(minor, currency, { whole: Number.isInteger(value) });
}

/** Percentage change from `previous` to `current`. Null when there's no baseline. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * Totals for a set of amounts that may span currencies.
 *
 * Analytics must NEVER silently add different currencies together. Callers get
 * a per-currency breakdown plus `mixed`, which tells the UI to show the totals
 * separately (or say aggregation is unavailable) instead of printing a
 * meaningless single number.
 */
export interface MultiCurrencyTotal {
  byCurrency: { currency: string; totalMinor: number; count: number }[];
  mixed: boolean;
  /** The single total, only when exactly one currency is present. */
  singleCurrency: { currency: string; totalMinor: number } | null;
}

export function totalByCurrency(
  rows: { currency: string; amountMinor: number }[],
): MultiCurrencyTotal {
  const map = new Map<string, { totalMinor: number; count: number }>();
  for (const row of rows) {
    const entry = map.get(row.currency) ?? { totalMinor: 0, count: 0 };
    entry.totalMinor += row.amountMinor;
    entry.count += 1;
    map.set(row.currency, entry);
  }

  const byCurrency = [...map.entries()]
    .map(([currency, v]) => ({ currency, ...v }))
    .sort((a, b) => b.totalMinor - a.totalMinor);

  return {
    byCurrency,
    mixed: byCurrency.length > 1,
    singleCurrency:
      byCurrency.length === 1
        ? { currency: byCurrency[0].currency, totalMinor: byCurrency[0].totalMinor }
        : null,
  };
}
