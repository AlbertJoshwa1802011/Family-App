/**
 * Calendar maths for the money plan.
 *
 * Every function here is pure and works on ISO `yyyy-mm-dd` strings compared at
 * UTC midnight — the same rule as src/lib/expiry.ts. Local-time parsing caused a
 * real off-by-one bug in this codebase before; do not reintroduce it.
 */

export type Cadence = "weekly" | "monthly" | "quarterly" | "yearly";
export type IncomeCadence = "monthly" | "weekly" | "biweekly" | "yearly" | "one_off";

const DAY_MS = 86_400_000;

export function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * DAY_MS);
}

/** Inclusive day count between two ISO dates. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toUtc(toIso) - toUtc(fromIso)) / DAY_MS);
}

/** Last calendar day of the given year/month (month is 1-based). */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Add months to an ISO date, clamping the day to the target month's length so
 * that Jan 31 + 1 month is Feb 28/29 rather than rolling into March.
 */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth() + 1;
  const day = Math.min(d, lastDayOfMonth(ty, tm));
  return `${ty}-${String(tm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface Cycle {
  /** Inclusive first day. */
  from: string;
  /** Inclusive last day. */
  to: string;
  /** Stable key for dedupe and grouping, e.g. "2026-08". */
  key: string;
}

/**
 * The pay cycle containing `iso`.
 *
 * With payday = 1 this is the calendar month. With payday = 25, the cycle
 * running 25 Aug – 24 Sep is keyed "2026-08": a cycle is named for the month it
 * starts in, so "this month's money" means the money since you were last paid.
 */
export function cycleFor(iso: string, paydayDayOfMonth = 1): Cycle {
  const day = Math.min(Math.max(paydayDayOfMonth, 1), 28);
  const [y, m, d] = iso.split("-").map(Number);

  // If we're before this month's payday, the live cycle began last month.
  const startsThisMonth = d >= day;
  const startMonth = startsThisMonth ? m : m - 1;
  const start = new Date(Date.UTC(y, startMonth - 1, day));
  const from = fromUtc(start.getTime());
  const to = addDays(addMonths(from, 1), -1);

  return { from, to, key: from.slice(0, 7) };
}

/** The `count` cycles ending with the one containing `iso`, oldest first. */
export function recentCycles(iso: string, count: number, payday = 1): Cycle[] {
  const current = cycleFor(iso, payday);
  const out: Cycle[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const anchor = addMonths(current.from, -i);
    out.push(cycleFor(anchor, payday));
  }
  return out;
}

export interface Week {
  from: string;
  to: string;
  /** 1-based index within the cycle. */
  index: number;
}

/**
 * Split a cycle into 7-day slices from its first day. The final slice is
 * truncated at the cycle end, so weeks never bleed into the next pay period.
 */
export function weeksIn(from: string, to: string): Week[] {
  const out: Week[] = [];
  let cursor = from;
  let index = 1;
  while (toUtc(cursor) <= toUtc(to)) {
    const end = addDays(cursor, 6);
    out.push({
      from: cursor,
      to: toUtc(end) > toUtc(to) ? to : end,
      index,
    });
    cursor = addDays(cursor, 7);
    index++;
  }
  return out;
}

/** How many times a cadence occurs per year — used to normalise amounts. */
export function occurrencesPerYear(cadence: Cadence): number {
  switch (cadence) {
    case "weekly":
      return 52;
    case "monthly":
      return 12;
    case "quarterly":
      return 4;
    case "yearly":
      return 1;
  }
}

/**
 * A cadence's monthly-equivalent amount, for comparing commitments of different
 * rhythms on one scale. Weekly uses 52/12 rather than 4, which would understate
 * a weekly cost by roughly 8%.
 */
export function monthlyEquivalent(amountMinor: number, cadence: Cadence): number {
  return Math.round((amountMinor * occurrencesPerYear(cadence)) / 12);
}

export function incomeMonthlyEquivalent(
  amountMinor: number,
  cadence: IncomeCadence,
): number {
  switch (cadence) {
    case "weekly":
      return Math.round((amountMinor * 52) / 12);
    case "biweekly":
      return Math.round((amountMinor * 26) / 12);
    case "monthly":
      return amountMinor;
    case "yearly":
      return Math.round(amountMinor / 12);
    case "one_off":
      return 0; // Not recurring, so it never contributes to a monthly baseline.
  }
}

/** ISO week key, e.g. "2026-W33". Weeks start Monday (ISO-8601). */
export function isoWeekKey(iso: string): string {
  const date = new Date(toUtc(iso));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const year = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The dedupe/grouping key for one occurrence of a cadence. */
export function periodKeyFor(cadence: Cadence, iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  switch (cadence) {
    case "weekly":
      return isoWeekKey(iso);
    case "monthly":
      return iso.slice(0, 7);
    case "quarterly":
      return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    case "yearly":
      return String(y);
  }
}

export interface ScheduleSpec {
  cadence: Cadence;
  startDate: string;
  endDate?: string | null;
  dayOfMonth?: number | null;
  dayOfWeek?: number | null;
  totalInstallments?: number | null;
}

/**
 * Every due date for a schedule that falls within [from, to], inclusive.
 *
 * Monthly/quarterly/yearly land on `dayOfMonth`, clamped to the month's length
 * (a 31st due date falls on Feb 28). Weekly lands on `dayOfWeek` (0=Sunday).
 * A schedule stops at whichever comes first: `endDate` or `totalInstallments`.
 */
export function dueDatesBetween(
  spec: ScheduleSpec,
  from: string,
  to: string,
): string[] {
  const out: string[] = [];
  const hardEnd = spec.endDate && toUtc(spec.endDate) < toUtc(to) ? spec.endDate : to;
  if (toUtc(spec.startDate) > toUtc(hardEnd)) return out;

  if (spec.cadence === "weekly") {
    const targetDow = spec.dayOfWeek ?? new Date(toUtc(spec.startDate)).getUTCDay();
    let cursor = spec.startDate;
    // Advance to the first matching weekday on or after the start.
    while (new Date(toUtc(cursor)).getUTCDay() !== targetDow) cursor = addDays(cursor, 1);
    let n = 0;
    while (toUtc(cursor) <= toUtc(hardEnd)) {
      if (spec.totalInstallments && n >= spec.totalInstallments) break;
      if (toUtc(cursor) >= toUtc(from)) out.push(cursor);
      cursor = addDays(cursor, 7);
      n++;
    }
    return out;
  }

  const stepMonths =
    spec.cadence === "monthly" ? 1 : spec.cadence === "quarterly" ? 3 : 12;
  const startY = Number(spec.startDate.slice(0, 4));
  const startM = Number(spec.startDate.slice(5, 7));
  const day = spec.dayOfMonth ?? Number(spec.startDate.slice(8, 10));

  for (let n = 0; ; n++) {
    if (spec.totalInstallments && n >= spec.totalInstallments) break;
    const anchor = new Date(Date.UTC(startY, startM - 1 + n * stepMonths, 1));
    const y = anchor.getUTCFullYear();
    const m = anchor.getUTCMonth() + 1;
    const dd = Math.min(day, lastDayOfMonth(y, m));
    const due = `${y}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;

    if (toUtc(due) > toUtc(hardEnd)) break;
    if (toUtc(due) >= toUtc(from) && toUtc(due) >= toUtc(spec.startDate)) out.push(due);
    // Guard against a pathological loop on bad input.
    if (n > 2000) break;
  }
  return out;
}

/**
 * Installments still to run after `asOf`, or null when the schedule is open-ended.
 * Drives the "14 of 60 paid" readout on an EMI.
 */
export function remainingInstallments(
  spec: ScheduleSpec,
  asOf: string,
): number | null {
  if (!spec.totalInstallments) return null;
  const elapsed = dueDatesBetween(spec, spec.startDate, asOf).length;
  return Math.max(spec.totalInstallments - elapsed, 0);
}
