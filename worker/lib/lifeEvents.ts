/**
 * Pure life-event (birthday / anniversary) windowing — no I/O.
 *
 * Dates are stored as ISO yyyy-mm-dd. Recurring events use month+day only;
 * the next occurrence is this year's date if still upcoming (or today), else next year.
 */

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function utcMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Next occurrence (UTC midnight ms) of a month-day from an ISO date, at/after today. */
export function nextOccurrenceMs(iso: string, nowMs: number): number | null {
  if (!ISO_DATE.test(iso)) return null;
  const [, mm, dd] = iso.split("-").map(Number);
  if (!mm || !dd || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  const today = utcMidnight(nowMs);
  const y = new Date(nowMs).getUTCFullYear();
  let candidate = Date.UTC(y, mm - 1, dd);
  if (candidate < today) candidate = Date.UTC(y + 1, mm - 1, dd);
  return candidate;
}

/** Whole days until the next occurrence of `iso`'s month-day. Null if malformed. */
export function daysUntilLifeEvent(iso: string, nowMs: number): number | null {
  const next = nextOccurrenceMs(iso, nowMs);
  if (next === null) return null;
  return Math.round((next - utcMidnight(nowMs)) / DAY_MS);
}

export type LifeEventKind = "birthday" | "anniversary";

export interface LifeEventCandidate {
  memberId: string;
  name: string;
  kind: LifeEventKind;
  /** Source ISO date (original year preserved for display of age if wanted). */
  sourceDate: string;
  /** Next occurrence as yyyy-mm-dd. */
  nextDate: string;
  daysUntil: number;
  occurrenceYear: number;
}

/**
 * Members whose birthday or anniversary falls within `withinDays` (inclusive of 0).
 */
export function upcomingLifeEvents(
  members: Array<{
    id: string;
    name: string;
    dateOfBirth?: string | null;
    anniversaryDate?: string | null;
  }>,
  nowMs: number,
  withinDays: number,
): LifeEventCandidate[] {
  const out: LifeEventCandidate[] = [];
  for (const m of members) {
    for (const [kind, source] of [
      ["birthday", m.dateOfBirth],
      ["anniversary", m.anniversaryDate],
    ] as const) {
      if (!source) continue;
      const days = daysUntilLifeEvent(source, nowMs);
      if (days === null || days < 0 || days > withinDays) continue;
      const nextMs = nextOccurrenceMs(source, nowMs)!;
      const d = new Date(nextMs);
      const nextDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      out.push({
        memberId: m.id,
        name: m.name,
        kind,
        sourceDate: source,
        nextDate,
        daysUntil: days,
        occurrenceYear: d.getUTCFullYear(),
      });
    }
  }
  out.sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
  return out;
}

/** Human weekday label for an ISO date (UTC), e.g. "Saturday". */
export function weekdayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
