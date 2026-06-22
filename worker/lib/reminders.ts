/**
 * Pure reminder-windowing logic — no I/O, fully unit-testable.
 *
 * The cron scans documents/events whose deadline is approaching and emits at
 * most ONE reminder per (subject, recipient, window, channel). The window
 * selection below is the heart of that: as a deadline counts down it crosses
 * progressively tighter windows (e.g. 30 → 7 → 1), and we fire the *tightest*
 * window the subject currently falls within. Combined with the per-window
 * dedupe in `reminders_log` / `event_reminders_log`, this yields exactly one
 * notification per window crossing — never a burst when a doc is created late.
 */

export const DEFAULT_WINDOWS = [30, 7, 1];

/** Largest horizon we scan for upcoming deadlines (days). Bounds the query. */
export const REMINDER_SCAN_DAYS = 90;

const DAY_MS = 86_400_000;

/** UTC-midnight of the instant `nowMs`, in epoch ms. */
function utcMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Whole days from today (UTC midnight) until an ISO `yyyy-mm-dd` date.
 * Negative = already past. Returns null for malformed input.
 * Mirrors src/lib/expiry.ts so the badge and the reminder agree.
 */
export function daysUntilIso(iso: string, nowMs: number): number | null {
  const parts = iso.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [y, m, d] = parts;
  const targetUtc = Date.UTC(y, m - 1, d);
  return Math.round((targetUtc - utcMidnight(nowMs)) / DAY_MS);
}

/** Whole days from today (UTC midnight) until a unix-seconds instant. */
export function daysUntilUnix(startAtSecs: number, nowMs: number): number {
  const targetUtc = utcMidnight(startAtSecs * 1000);
  return Math.round((targetUtc - utcMidnight(nowMs)) / DAY_MS);
}

/**
 * The single window that should fire for a deadline `daysUntil` away, given a
 * recipient's configured `windows`. Returns the tightest window the deadline
 * falls within, or null if it's still beyond every window.
 *
 *   daysUntil=25, windows=[30,7,1] → 30  (within 30 only)
 *   daysUntil=5,  windows=[30,7,1] → 7   (within 30 & 7 → tightest = 7)
 *   daysUntil=0,  windows=[30,7,1] → 1   (within all → tightest = 1)
 *   daysUntil=-3, windows=[30,7,1] → 1   (expired → still the tightest)
 *   daysUntil=45, windows=[30,7,1] → null
 */
export function dueReminderWindow(
  daysUntil: number,
  windows: number[],
): number | null {
  const applicable = windows.filter((w) => daysUntil <= w);
  if (applicable.length === 0) return null;
  return Math.min(...applicable);
}

/**
 * Parse the stored `windows_json` into a sane, sorted-descending, de-duped
 * list of positive integer day-windows. Falls back to DEFAULT_WINDOWS on any
 * malformed / empty input so a corrupt pref never silences reminders.
 */
export function parseWindows(json: string | null | undefined): number[] {
  if (!json) return [...DEFAULT_WINDOWS];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [...DEFAULT_WINDOWS];
  }
  if (!Array.isArray(raw)) return [...DEFAULT_WINDOWS];
  const cleaned = Array.from(
    new Set(
      raw
        .filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0),
    ),
  ).sort((a, b) => b - a);
  return cleaned.length > 0 ? cleaned : [...DEFAULT_WINDOWS];
}

/** Human label + body for an expiry reminder, phrased by urgency. */
export function expiryReminderText(
  title: string,
  daysUntil: number,
): { title: string; body: string } {
  if (daysUntil < 0) {
    return {
      title: `Expired: ${title}`,
      body: `"${title}" expired ${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? "" : "s"} ago. Renew it as soon as possible.`,
    };
  }
  if (daysUntil === 0) {
    return { title: `Expires today: ${title}`, body: `"${title}" expires today.` };
  }
  return {
    title: `Expiring soon: ${title}`,
    body: `"${title}" expires in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.`,
  };
}

/**
 * Next annual occurrence of a recurring date (e.g. a birthday/anniversary) as
 * `yyyy-mm-dd`, relative to `nowMs` (UTC). Returns this year's date if it hasn't
 * passed, otherwise next year's. Feb-29 falls back to Feb-28 in non-leap years.
 * Returns null for malformed input.
 */
export function nextOccurrenceIso(baseIso: string, nowMs: number): string | null {
  const parts = baseIso.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [, m, d] = parts;
  const year = new Date(nowMs).getUTCFullYear();

  const build = (y: number): string => {
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // last day of month m
    const day = Math.min(d, lastDay);
    return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  const thisYear = build(year);
  return (daysUntilIso(thisYear, nowMs) ?? -1) >= 0 ? thisYear : build(year + 1);
}

/** Human label + body for an occasion (birthday/anniversary/custom) reminder. */
export function occasionReminderText(
  title: string,
  type: "birthday" | "anniversary" | "custom",
  daysUntil: number,
): { title: string; body: string } {
  const noun =
    type === "birthday"
      ? "🎂 Birthday"
      : type === "anniversary"
        ? "💍 Anniversary"
        : "📌 Reminder";
  if (daysUntil <= 0) {
    return { title: `${noun} today: ${title}`, body: `${title} is today. 🎉` };
  }
  if (daysUntil === 1) {
    return { title: `${noun} tomorrow: ${title}`, body: `${title} is tomorrow.` };
  }
  return {
    title: `${noun} in ${daysUntil} days: ${title}`,
    body: `${title} is coming up in ${daysUntil} days.`,
  };
}

/** Human label + body for an upcoming event reminder. */
export function eventReminderText(
  title: string,
  daysUntil: number,
): { title: string; body: string } {
  if (daysUntil <= 0) {
    return { title: `Today: ${title}`, body: `"${title}" is happening today.` };
  }
  return {
    title: `Upcoming: ${title}`,
    body: `"${title}" is in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.`,
  };
}
