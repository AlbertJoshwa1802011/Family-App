/**
 * Pure reminder-windowing logic — no I/O, fully unit-testable.
 *
 * The cron scans documents/events whose deadline is approaching and emits at
 * most ONE reminder per (subject, recipient, window, channel). The window
 * selection below is the heart of that: as a deadline counts down it crosses
 * progressively tighter windows (e.g. 30 → 7 → 2 → 0), and we fire the
 * *tightest* window the subject currently falls within. Combined with the
 * per-window dedupe in `reminders_log` / `event_reminders_log`, this yields
 * exactly one notification per window crossing — never a burst when a doc is
 * created late.
 *
 * Window `0` is the day-of deadline. It must be distinct from "1 day before"
 * so that yesterday's lead-time email does not suppress today's "expires
 * today" email (the critical path when the user does not open the app).
 */

/** Default lead times: ~1 month, 1 week, 2 days, and day-of (0). */
export const DEFAULT_WINDOWS = [30, 7, 2, 0];

/** Task due-date windows: 7 days, 2 days, and day-of (plus overdue → 0). */
export const TASK_WINDOWS = [7, 2, 0];

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
 *   daysUntil=25, windows=[30,7,2,0] → 30  (within 30 only)
 *   daysUntil=5,  windows=[30,7,2,0] → 7   (within 30 & 7 → tightest = 7)
 *   daysUntil=2,  windows=[30,7,2,0] → 2
 *   daysUntil=0,  windows=[30,7,2,0] → 0   (day-of — distinct from lead-times)
 *   daysUntil=-3, windows=[30,7,2,0] → 0   (past due → day-of / catch-up)
 *   daysUntil=45, windows=[30,7,2,0] → null
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
 * Documents always include day-of (window 0). Lead-time prefs control how far
 * ahead we warn; the "expires today" email must still fire even if the user
 * customized windows and dropped 0 — otherwise a missed login means a missed
 * passport/license renewal.
 */
export function withDayOfWindow(windows: number[]): number[] {
  if (windows.includes(0)) return windows;
  return [...windows, 0].sort((a, b) => b - a);
}

/**
 * Parse the stored `windows_json` into a sane, sorted-descending, de-duped
 * list of non-negative integer day-windows (0 = day-of). Falls back to
 * DEFAULT_WINDOWS on any malformed / empty input so a corrupt pref never
 * silences reminders.
 *
 * Also upgrades the legacy default `[30,7,1]` (no day-of, no 2-day) to the
 * current default so existing Settings saves still get today's email.
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
      raw.filter(
        (n): n is number =>
          typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 365,
      ),
    ),
  ).sort((a, b) => b - a);
  if (cleaned.length === 0) return [...DEFAULT_WINDOWS];
  // Legacy shipped default lacked day-of (0) and the 2-day planning window.
  if (cleaned.length === 3 && cleaned[0] === 30 && cleaned[1] === 7 && cleaned[2] === 1) {
    return [...DEFAULT_WINDOWS];
  }
  return cleaned;
}

/** Human label + body for an expiry reminder, phrased by urgency. */
export function expiryReminderText(
  title: string,
  daysUntil: number,
): { title: string; body: string } {
  if (daysUntil < 0) {
    const ago = Math.abs(daysUntil);
    return {
      title: `Expired: ${title}`,
      body: `"${title}" expired ${ago} day${ago === 1 ? "" : "s"} ago. Renew or replace it as soon as possible so your family records stay current.`,
    };
  }
  if (daysUntil === 0) {
    return {
      title: `Expires today: ${title}`,
      body: `"${title}" expires today. Open Family Vault now to renew or update it before it lapses.`,
    };
  }
  if (daysUntil <= 2) {
    return {
      title: `Expiring in ${daysUntil} day${daysUntil === 1 ? "" : "s"}: ${title}`,
      body: `"${title}" expires in ${daysUntil} day${daysUntil === 1 ? "" : "s"}. Plan the renewal now so you are not caught out.`,
    };
  }
  return {
    title: `Expiring soon: ${title}`,
    body: `"${title}" expires in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.`,
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

/** Human label + body for a pending-task reminder. */
export function taskReminderText(
  title: string,
  daysUntil: number,
): { title: string; body: string } {
  if (daysUntil < 0) {
    const ago = Math.abs(daysUntil);
    return {
      title: `Overdue: ${title}`,
      body: `"${title}" was due ${ago} day${ago === 1 ? "" : "s"} ago.`,
    };
  }
  if (daysUntil === 0) {
    return { title: `Due today: ${title}`, body: `"${title}" is due today.` };
  }
  return {
    title: `Task due soon: ${title}`,
    body: `"${title}" is due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.`,
  };
}
