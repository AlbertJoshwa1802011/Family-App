/**
 * Minimal iCalendar (RFC 5545) builder for family events.
 * Used for per-event downloads and the subscribable feed.
 */

export interface IcsEvent {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: number;
  endAt?: number | null;
  allDay: boolean;
  status?: "active" | "cancelled";
}

export interface IcsAllDayItem {
  uid: string;
  title: string;
  startDate: string; // yyyy-mm-dd
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(" " + rest);
  return parts.join("\r\n");
}

function utcStamp(secs: number): string {
  const d = new Date(secs * 1000);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function allDayStamp(iso: string): string {
  return iso.replace(/-/g, "");
}

function eventBlock(ev: IcsEvent, nowSecs: number): string {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${ev.uid}@familyvault`,
    `DTSTAMP:${utcStamp(nowSecs)}`,
    `SUMMARY:${icsEscape(ev.title)}`,
  ];
  if (ev.allDay) {
    const start = new Date(ev.startAt * 1000);
    const startIso = `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`;
    const endSecs = ev.endAt && ev.endAt > ev.startAt ? ev.endAt : ev.startAt + 86400;
    const end = new Date(endSecs * 1000);
    const endIso = `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`;
    lines.push(`DTSTART;VALUE=DATE:${allDayStamp(startIso)}`);
    lines.push(`DTEND;VALUE=DATE:${allDayStamp(endIso)}`);
  } else {
    lines.push(`DTSTART:${utcStamp(ev.startAt)}`);
    lines.push(`DTEND:${utcStamp(ev.endAt && ev.endAt > ev.startAt ? ev.endAt : ev.startAt + 3600)}`);
  }
  if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
  if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
  if (ev.status === "cancelled") lines.push("STATUS:CANCELLED");
  lines.push("END:VEVENT");
  return lines.map(fold).join("\r\n");
}

function expiryBlock(item: IcsAllDayItem, nowSecs: number): string {
  const next = new Date(item.startDate + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  const endIso = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
  const lines = [
    "BEGIN:VEVENT",
    `UID:${item.uid}@familyvault`,
    `DTSTAMP:${utcStamp(nowSecs)}`,
    `SUMMARY:${icsEscape(item.title)}`,
    `DTSTART;VALUE=DATE:${allDayStamp(item.startDate)}`,
    `DTEND;VALUE=DATE:${allDayStamp(endIso)}`,
    "END:VEVENT",
  ];
  return lines.map(fold).join("\r\n");
}

export function buildCalendar(opts: {
  events: IcsEvent[];
  expiries?: IcsAllDayItem[];
  nowSecs?: number;
  name?: string;
}): string {
  const nowSecs = opts.nowSecs ?? Math.floor(Date.now() / 1000);
  const blocks = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Family Vault//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${icsEscape(opts.name ?? "Family Vault")}`,
    ...opts.events.map((e) => eventBlock(e, nowSecs)),
    ...(opts.expiries ?? []).map((e) => expiryBlock(e, nowSecs)),
    "END:VCALENDAR",
  ];
  return blocks.join("\r\n") + "\r\n";
}

export { icsEscape };
