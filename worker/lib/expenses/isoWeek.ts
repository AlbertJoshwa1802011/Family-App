/**
 * ISO week helpers for expense summary buckets.
 * All calendar math is UTC to match expiry/date conventions.
 */

/** ISO week key `"YYYY-Www"` for an ISO date string `yyyy-mm-dd`. */
export function isoWeekKey(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  // Thursday of the current week determines the ISO week-year.
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7; // Mon=1 … Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  const isoYear = date.getUTCFullYear();
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
