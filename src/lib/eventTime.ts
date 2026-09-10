const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const MONTH_YEAR_FMT = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});

export function formatEventDate(startAt: number): string {
  return DATE_FMT.format(new Date(startAt * 1000));
}

export function formatEventTime(
  startAt: number,
  endAt: number | null | undefined,
  allDay: boolean,
): string {
  const start = new Date(startAt * 1000);
  if (allDay) return DATE_FMT.format(start);
  const startStr = TIME_FMT.format(start);
  if (!endAt) return `${DATE_FMT.format(start)} · ${startStr}`;
  const endStr = TIME_FMT.format(new Date(endAt * 1000));
  return `${DATE_FMT.format(start)} · ${startStr} – ${endStr}`;
}

export function formatMonthYear(startAt: number): string {
  return MONTH_YEAR_FMT.format(new Date(startAt * 1000));
}

/** Returns the month+year string used for grouping (e.g. "June 2026"). */
export function eventMonthKey(startAt: number): string {
  const d = new Date(startAt * 1000);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

/**
 * Palette for an event type. `tint` is a raw CSS colour (not a class) so it can
 * be fed to the liquid-glass `--lq-tint` variable; `bg`/`text`/`dot` stay as
 * Tailwind classes for non-glass surfaces.
 */
export function eventTypeColor(
  type: string,
): { bg: string; text: string; dot: string; tint: string } {
  switch (type) {
    case "gathering":
      return {
        bg: "bg-orange-500/15",
        text: "text-orange-300",
        dot: "bg-orange-400",
        tint: "#fb923c",
      };
    case "appointment":
      return {
        bg: "bg-info/15",
        text: "text-info",
        dot: "bg-info",
        tint: "var(--color-info)",
      };
    case "milestone":
      return {
        bg: "bg-purple-500/15",
        text: "text-purple-300",
        dot: "bg-purple-400",
        tint: "#c084fc",
      };
    default:
      return {
        bg: "bg-fg-subtle/15",
        text: "text-fg-muted",
        dot: "bg-fg-subtle",
        tint: "var(--color-fg-subtle)",
      };
  }
}
