import { Cake, CalendarHeart, Gift, type LucideIcon } from "lucide-react";

export type OccasionType = "birthday" | "anniversary" | "custom";

export interface OccasionTypeMeta {
  id: OccasionType;
  label: string;
  icon: LucideIcon;
  emoji: string;
}

export const OCCASION_TYPES: OccasionTypeMeta[] = [
  { id: "birthday", label: "Birthday", icon: Cake, emoji: "🎂" },
  { id: "anniversary", label: "Anniversary", icon: CalendarHeart, emoji: "💍" },
  { id: "custom", label: "Custom", icon: Gift, emoji: "📌" },
];

export function occasionTypeMeta(t: string): OccasionTypeMeta {
  return OCCASION_TYPES.find((o) => o.id === t) ?? OCCASION_TYPES[2];
}

const DAY_MS = 86_400_000;

function utcMidnightNow(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Next annual occurrence of `baseIso` (yyyy-mm-dd). Mirrors the worker's
 * nextOccurrenceIso so the UI and reminders agree. For non-recurring occasions
 * pass `recurring=false` to get the original date back.
 */
export function nextOccurrence(baseIso: string, recurring = true): string {
  const parts = baseIso.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return baseIso;
  const [, m, d] = parts;
  if (!recurring) return baseIso;
  const year = new Date().getUTCFullYear();
  const build = (y: number) => {
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const day = Math.min(d, lastDay);
    return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  const thisYear = build(year);
  return daysUntil(thisYear) >= 0 ? thisYear : build(year + 1);
}

/** Whole days from today (UTC midnight) until an ISO date. */
export function daysUntil(iso: string): number {
  const parts = iso.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return Infinity;
  const [y, m, d] = parts;
  return Math.round((Date.UTC(y, m - 1, d) - utcMidnightNow()) / DAY_MS);
}

/** Friendly countdown label, e.g. "Today 🎉", "Tomorrow", "in 12 days". */
export function countdownLabel(days: number): string {
  if (days <= 0) return "Today 🎉";
  if (days === 1) return "Tomorrow";
  if (days < 31) return `in ${days} days`;
  const months = Math.round(days / 30);
  return `in ${months} month${months === 1 ? "" : "s"}`;
}

/** "12 Aug" style label for an ISO date. */
export function shortDate(iso: string): string {
  const parts = iso.split("-").map(Number);
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
