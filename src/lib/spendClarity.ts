/**
 * Pure helpers for the Spending page — the Money Manager-style clarity layer.
 *
 * Family Vault already stores expenses, categories, and income sources.
 * These functions turn that into a calendar heat-map and a donut so a
 * month is readable at a glance. No new dependencies.
 */

export interface DaySpend {
  date: string;
  totalMinor: number;
  count: number;
}

export interface CalendarCell {
  date: string | null;
  day: number | null;
  totalMinor: number;
  count: number;
  /** 0 empty, 1–4 heat. */
  intensity: 0 | 1 | 2 | 3 | 4;
}

export interface CategorySpend {
  categoryId: string | null;
  name: string;
  color: string | null;
  totalMinor: number;
  count: number;
}

export interface DonutSlice {
  key: string;
  name: string;
  color: string;
  totalMinor: number;
  share: number;
  /** Stroke dash length on a circle of the given circumference. */
  dash: number;
  offset: number;
}

const FALLBACK_COLOR = "#64748b";

/** Monday-first index: Mon=0 … Sun=6. */
export function mondayIndex(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const utcDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // Sun=0
  return (utcDay + 6) % 7;
}

export function daysInMonth(monthStart: string): number {
  const [y, m] = monthStart.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isoDateInMonth(monthStart: string, day: number): string {
  const [y, m] = monthStart.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function heat(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  if (ratio <= 0.15) return 1;
  if (ratio <= 0.4) return 2;
  if (ratio <= 0.7) return 3;
  return 4;
}

/**
 * Build a Monday-first month grid (leading blanks, then 28–31 days).
 * Intensity is relative to the busiest day in that month.
 */
export function calendarCells(
  monthStart: string,
  byDay: DaySpend[],
): CalendarCell[] {
  const spend = new Map(byDay.map((d) => [d.date, d]));
  const last = daysInMonth(monthStart);
  const max = Math.max(...byDay.map((d) => d.totalMinor), 0);
  const lead = mondayIndex(isoDateInMonth(monthStart, 1));
  const cells: CalendarCell[] = [];

  for (let i = 0; i < lead; i++) {
    cells.push({ date: null, day: null, totalMinor: 0, count: 0, intensity: 0 });
  }
  for (let day = 1; day <= last; day++) {
    const date = isoDateInMonth(monthStart, day);
    const row = spend.get(date);
    const totalMinor = row?.totalMinor ?? 0;
    cells.push({
      date,
      day,
      totalMinor,
      count: row?.count ?? 0,
      intensity: heat(totalMinor, max),
    });
  }
  return cells;
}

const CIRCUMFERENCE = 2 * Math.PI * 36;

/**
 * Donut slices for a category breakdown. Angles are encoded as SVG stroke
 * dash/offset on a circle of radius 36 (circumference CIRCUMFERENCE).
 */
export function donutSlices(
  rows: CategorySpend[],
  totalMinor: number,
  circumference = CIRCUMFERENCE,
): DonutSlice[] {
  if (totalMinor <= 0) return [];
  let cursor = 0;
  return rows
    .filter((r) => r.totalMinor > 0)
    .map((r) => {
      const share = r.totalMinor / totalMinor;
      const dash = share * circumference;
      const slice: DonutSlice = {
        key: r.categoryId ?? "none",
        name: r.name,
        color: r.color && r.color.length > 0 ? r.color : FALLBACK_COLOR,
        totalMinor: r.totalMinor,
        share,
        dash,
        offset: -cursor,
      };
      cursor += dash;
      return slice;
    });
}

export { CIRCUMFERENCE as DONUT_CIRCUMFERENCE };

/** Query value for uncategorized expenses on GET /expenses. */
export const UNCATEGORIZED_QUERY = "none";

export function categoryQueryValue(categoryId: string | null): string {
  return categoryId ?? UNCATEGORIZED_QUERY;
}
