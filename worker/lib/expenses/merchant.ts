/**
 * Merchant normalization.
 *
 * `expenses.merchant` keeps exactly what the user typed. `expenses.merchant_key`
 * is the normalized handle everything else groups by — merchant rankings today,
 * merchant aliases and auto-categorization rules later. Keeping the key in a
 * column (rather than normalizing at query time) means the index does the work
 * and the future rules layer has a stable thing to attach to.
 *
 * Normalization is deliberately CONSERVATIVE. Aggressively stripping tokens
 * ("ltd", store numbers, city names) would merge genuinely different merchants,
 * and a wrong merge is much harder to notice — and to undo — than a missed one.
 * Provider-specific cleanup ("UPI/", "POS ", "AMZN Mktp*IN" → Amazon) belongs in
 * the alias/rules layer that ships with the importer, where a human can correct
 * it and the correction is remembered.
 */

const MAX_KEY_LENGTH = 120;

/**
 * "  KFC  Whitefield " → "kfc whitefield"
 * "AMZN Mktp*IN"       → "amzn mktp in"
 * "Café Noir"          → "cafe noir"
 *
 * Returns null when there is nothing meaningful left (empty, or punctuation
 * only) so the column stays NULL rather than holding an empty string.
 */
export function merchantKey(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const key = raw
    .normalize("NFKD")
    // Drop combining marks so "Café" and "Cafe" group together.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Everything that isn't a letter or digit becomes a separator.
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, MAX_KEY_LENGTH)
    .trim();

  return key === "" ? null : key;
}

/** Tidy the user-visible merchant string: collapse whitespace, trim, cap length. */
export function displayMerchant(
  raw: string | null | undefined,
  maxLength = 200,
): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, " ").trim().slice(0, maxLength);
  return cleaned === "" ? null : cleaned;
}
