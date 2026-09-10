/**
 * Display helpers for integer minor-unit money.
 *
 * Decision (E1): default 2 decimal places; zero-decimal currencies
 * (JPY, KRW, VND, CLP) use exponent 0. Stored amounts remain integer minors.
 */

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP"]);

export function currencyExponent(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

export function formatMoney(
  amountMinor: number,
  currency: string,
  locale = undefined as string | undefined,
): string {
  const exp = currencyExponent(currency);
  const major = amountMinor / 10 ** exp;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(major);
  } catch {
    return `${major.toFixed(exp)} ${currency}`;
  }
}

/** Major-unit string for edit forms (no currency symbol; preserves fraction digits). */
export function formatMajorFromMinor(
  amountMinor: number,
  currency: string,
): string {
  const exp = currencyExponent(currency);
  const major = amountMinor / 10 ** exp;
  return major.toFixed(exp);
}

/** Parse a user-typed major-unit string ("450", "450.5", "1,234.56") → minor int. */
export function parseMajorToMinor(
  input: string,
  currency: string,
): number | null {
  const cleaned = input.replace(/,/g, "").trim();
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const exp = currencyExponent(currency);
  const [whole, frac = ""] = cleaned.replace(/^-/, "").split(".");
  if (frac.length > exp) return null;
  const fracPadded = (frac + "0".repeat(exp)).slice(0, exp);
  const minor = Number(whole) * 10 ** exp + Number(fracPadded || "0");
  if (!Number.isSafeInteger(minor)) return null;
  return cleaned.startsWith("-") ? -minor : minor;
}

export function todayIsoDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** First/last ISO dates of the calendar month containing `isoDate`. */
export function monthRange(isoDate: string): { from: string; to: string } {
  const [y, m] = isoDate.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${y}-${String(m).padStart(2, "0")}-01`,
    to: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
  };
}
