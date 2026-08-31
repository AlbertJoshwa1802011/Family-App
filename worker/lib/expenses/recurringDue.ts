/**
 * Pure helpers for recurring-expense due windows and period keys.
 */

export type RecurringInterval = "monthly" | "weekly" | "yearly";

export type RecurringDueInput = {
  interval: RecurringInterval;
  startDate: string; // yyyy-mm-dd
  endDate: string | null;
  dayOfMonth: number | null; // 1-28 for monthly
  active: boolean;
};

function parseIso(dateStr: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Next occurrence on/after `fromDate` (UTC midnight of that calendar day).
 * Returns null if inactive, past endDate, or before start with no future slot
 * within reason.
 */
export function nextOccurrence(
  input: RecurringDueInput,
  fromDate: string,
): string | null {
  if (!input.active) return null;
  const from = parseIso(fromDate);
  const start = parseIso(input.startDate);
  if (!from || !start) return null;
  const end = input.endDate ? parseIso(input.endDate) : null;
  if (end && from > end) return null;

  if (input.interval === "monthly") {
    const dom = Math.min(28, Math.max(1, input.dayOfMonth ?? start.getUTCDate()));
    let y = from.getUTCFullYear();
    let m = from.getUTCMonth();
    let candidate = new Date(Date.UTC(y, m, dom));
    if (candidate < from) {
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
      candidate = new Date(Date.UTC(y, m, dom));
    }
    if (candidate < start) {
      // Jump to start month's dayOfMonth (or next).
      y = start.getUTCFullYear();
      m = start.getUTCMonth();
      candidate = new Date(Date.UTC(y, m, dom));
      if (candidate < start) {
        m += 1;
        if (m > 11) {
          m = 0;
          y += 1;
        }
        candidate = new Date(Date.UTC(y, m, dom));
      }
    }
    if (end && candidate > end) return null;
    return toIso(candidate);
  }

  if (input.interval === "weekly") {
    const targetDow = start.getUTCDay();
    let candidate = new Date(from.getTime());
    if (candidate < start) candidate = new Date(start.getTime());
    const delta = (targetDow - candidate.getUTCDay() + 7) % 7;
    candidate.setUTCDate(candidate.getUTCDate() + delta);
    if (candidate < start) {
      candidate.setUTCDate(candidate.getUTCDate() + 7);
    }
    if (end && candidate > end) return null;
    return toIso(candidate);
  }

  // yearly — same month/day as startDate
  const md = { m: start.getUTCMonth(), d: start.getUTCDate() };
  let y = from.getUTCFullYear();
  let candidate = new Date(Date.UTC(y, md.m, md.d));
  if (candidate < from || candidate < start) {
    y = Math.max(from.getUTCFullYear(), start.getUTCFullYear());
    candidate = new Date(Date.UTC(y, md.m, md.d));
    if (candidate < from || candidate < start) {
      candidate = new Date(Date.UTC(y + 1, md.m, md.d));
    }
  }
  if (end && candidate > end) return null;
  return toIso(candidate);
}

/**
 * True when the next occurrence falls within [today, today+horizonDays] inclusive.
 */
export function isDueWithinDays(
  input: RecurringDueInput,
  todayIso: string,
  horizonDays: number,
): { due: boolean; dueDate: string | null; daysUntil: number | null } {
  const dueDate = nextOccurrence(input, todayIso);
  if (!dueDate) return { due: false, dueDate: null, daysUntil: null };
  const today = parseIso(todayIso)!;
  const due = parseIso(dueDate)!;
  const daysUntil = daysBetween(today, due);
  return {
    due: daysUntil >= 0 && daysUntil <= horizonDays,
    dueDate,
    daysUntil,
  };
}

/** Dedupe key for a reminder send: month / ISO-week / year of the due date. */
export function periodKeyFor(
  interval: RecurringInterval,
  dueDate: string,
): string {
  if (interval === "weekly") {
    // Reuse ISO week format YYYY-Www
    const [y, m, d] = dueDate.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil(
      ((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
    );
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  if (interval === "yearly") return dueDate.slice(0, 4);
  return dueDate.slice(0, 7); // yyyy-mm
}
