/**
 * iCalendar (RFC 5545) generation for calendar-app integration.
 * Pure functions — no I/O — so they're unit-testable.
 */

function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Unix seconds → ICS UTC datetime (yyyymmddThhmmssZ). */
function icsDateTime(unixSecs: number): string {
  return new Date(unixSecs * 1000)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** ISO yyyy-mm-dd → ICS all-day date (yyyymmdd). */
function icsDate(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

/** UTC yyyy-mm-dd from unix seconds. */
function unixToUtcDate(secs: number): string {
  return new Date(secs * 1000).toISOString().slice(0, 10);
}

/** Exclusive next-day date for all-day DTEND. */
function nextUtcDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Fold long lines at 75 octets per RFC 5545 §3.1 (simple char-based fold). */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return parts.join("\r\n");
}

export interface IcsEvent {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: number; // unix seconds
  endAt?: number | null;
  allDay: boolean;
  cancelled?: boolean;
  /** Monotonic edit counter — Apple/Google use this to replace stale copies. */
  sequence?: number;
  /** Unix seconds; written as LAST-MODIFIED. */
  updatedAt?: number;
}

export interface IcsAllDayItem {
  uid: string;
  title: string;
  date: string; // ISO yyyy-mm-dd
  description?: string | null;
}

function vevent(ev: IcsEvent, nowSecs: number): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${icsEscape(ev.uid)}`,
    `DTSTAMP:${icsDateTime(nowSecs)}`,
    `SUMMARY:${icsEscape(ev.title)}`,
  ];

  if (ev.allDay) {
    const day = unixToUtcDate(ev.startAt);
    const endDay = ev.endAt ? nextUtcDate(unixToUtcDate(ev.endAt)) : nextUtcDate(day);
    lines.push(`DTSTART;VALUE=DATE:${icsDate(day)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(endDay)}`);
  } else {
    lines.push(`DTSTART:${icsDateTime(ev.startAt)}`);
    lines.push(`DTEND:${icsDateTime(ev.endAt ?? ev.startAt + 3600)}`);
  }

  if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
  if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
  if (ev.cancelled) lines.push("STATUS:CANCELLED");
  lines.push(`SEQUENCE:${Math.max(0, ev.sequence ?? 0)}`);
  lines.push(`LAST-MODIFIED:${icsDateTime(ev.updatedAt ?? nowSecs)}`);

  lines.push("END:VEVENT");
  return lines;
}

function veventAllDay(item: IcsAllDayItem, nowSecs: number): string[] {
  return [
    "BEGIN:VEVENT",
    `UID:${icsEscape(item.uid)}`,
    `DTSTAMP:${icsDateTime(nowSecs)}`,
    `SUMMARY:${icsEscape(item.title)}`,
    `DTSTART;VALUE=DATE:${icsDate(item.date)}`,
    `DTEND;VALUE=DATE:${icsDate(nextUtcDate(item.date))}`,
    ...(item.description ? [`DESCRIPTION:${icsEscape(item.description)}`] : []),
    "SEQUENCE:0",
    `LAST-MODIFIED:${icsDateTime(nowSecs)}`,
    "END:VEVENT",
  ];
}

export function buildCalendar(opts: {
  name: string;
  events: IcsEvent[];
  allDayItems?: IcsAllDayItem[];
  nowSecs?: number;
  /** Hint clients to re-fetch often (Apple Calendar / Google subscribed feeds). */
  refreshMinutes?: number;
}): string {
  const now = opts.nowSecs ?? Math.floor(Date.now() / 1000);
  const refresh = Math.max(5, opts.refreshMinutes ?? 15);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Family Vault//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(opts.name)}`,
    // RFC 7986 + Google's X-PUBLISHED-TTL — ask clients to poll often.
    `REFRESH-INTERVAL;VALUE=DURATION:PT${refresh}M`,
    `X-PUBLISHED-TTL:PT${refresh}M`,
  ];

  for (const ev of opts.events) lines.push(...vevent(ev, now));
  for (const item of opts.allDayItems ?? []) lines.push(...veventAllDay(item, now));

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
