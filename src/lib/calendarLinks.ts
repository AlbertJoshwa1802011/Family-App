/** Client-side helpers for adding Family Vault events to phone calendars. */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function utcDateCompact(secs: number): string {
  const d = new Date(secs * 1000);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function utcDateTimeCompact(secs: number): string {
  const d = new Date(secs * 1000);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Google Calendar TEMPLATE link — adds the event without Calendar API OAuth. */
export function googleCalendarTemplateUrl(ev: {
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: number;
  endAt?: number | null;
  allDay: boolean;
}): string {
  const endSecs =
    ev.endAt && ev.endAt > ev.startAt
      ? ev.endAt
      : ev.allDay
        ? ev.startAt + 86400
        : ev.startAt + 3600;
  const dates = ev.allDay
    ? `${utcDateCompact(ev.startAt)}/${utcDateCompact(endSecs)}`
    : `${utcDateTimeCompact(ev.startAt)}/${utcDateTimeCompact(endSecs)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates,
  });
  if (ev.description) params.set("details", ev.description);
  if (ev.location) params.set("location", ev.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function toWebcalUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https:/i, "webcal:").replace(/^http:/i, "webcal:");
}
