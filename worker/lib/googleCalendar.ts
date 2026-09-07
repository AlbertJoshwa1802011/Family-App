/**
 * Google Calendar write-sync for family events.
 *
 * Uses the signed-in user's OAuth refresh token (KV `user:refresh_token:{id}`).
 * Missing token / missing calendar.events scope is not fatal — event CRUD
 * still succeeds and the UI can offer a reconnect.
 */
import type { Env } from "../types";
import type { Db } from "../db/client";
import { schema } from "../db/client";
import { eq } from "drizzle-orm";
import {
  GOOGLE_SCOPES,
  classifyGoogleApiError,
  clearUserGoogleAccessCache,
  getUserGoogleAccessToken,
  scopesKey,
  userHasScope,
} from "./google";

const CAL_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export type CalendarSyncStatus =
  | "synced"
  | "skipped_no_token"
  | "needs_reconnect"
  | "needs_api_enabled"
  | "failed";

export interface CalendarEventInput {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: number;
  endAt: number | null;
  allDay: boolean;
  googleCalendarEventId: string | null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function utcDate(secs: number): string {
  const d = new Date(secs * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function rfc3339(secs: number): string {
  return new Date(secs * 1000).toISOString();
}

function toGcalBody(ev: CalendarEventInput): Record<string, unknown> {
  const allDay = Boolean(ev.allDay);
  const endSecs = ev.endAt && ev.endAt > ev.startAt ? ev.endAt : ev.startAt + 3600;
  if (allDay) {
    const start = utcDate(ev.startAt);
    const endDay = new Date(Date.UTC(
      Number(start.slice(0, 4)),
      Number(start.slice(5, 7)) - 1,
      Number(start.slice(8, 10)) + 1,
    ));
    return {
      summary: ev.title,
      description: ev.description ?? undefined,
      location: ev.location ?? undefined,
      start: { date: start },
      end: { date: utcDate(Math.floor(endDay.getTime() / 1000)) },
    };
  }
  return {
    summary: ev.title,
    description: ev.description ?? undefined,
    location: ev.location ?? undefined,
    start: { dateTime: rfc3339(ev.startAt) },
    end: { dateTime: rfc3339(endSecs) },
  };
}

/** Google Calendar "add event" deep link — works without Calendar API OAuth. */
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
    ? `${utcDate(ev.startAt).replace(/-/g, "")}/${utcDate(endSecs).replace(/-/g, "")}`
    : `${rfc3339(ev.startAt).replace(/[-:]/g, "").replace(/\.\d{3}/, "")}/${rfc3339(endSecs).replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates,
  });
  if (ev.description) params.set("details", ev.description);
  if (ev.location) params.set("location", ev.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Convert an https ICS feed URL into a webcal:// URL for Apple Calendar. */
export function toWebcalUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https:/i, "webcal:").replace(/^http:/i, "webcal:");
}

export function calendarStatusMessage(status: CalendarSyncStatus): string {
  switch (status) {
    case "synced":
      return "Saved to Google Calendar — it should show on your phone now.";
    case "skipped_no_token":
      return "Not on your phone yet. Tap Connect Google Calendar, or use Add to Google / Apple below.";
    case "needs_reconnect":
      return "Google Calendar permission is missing. Tap Connect Google Calendar, accept calendar access, then Sync — or use Add to Google / Apple below.";
    case "needs_api_enabled":
      return "Enable Google Calendar API on the Cloud project (docs/OPS.md §6), then tap Sync — or use Add to Google / Apple below.";
    case "failed":
      return "Automatic Google Calendar sync failed. Use Add to Google Calendar or Add to Apple Calendar below.";
  }
}

async function gcalFetch(
  token: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/**
 * Create or patch the Google Calendar event. Returns the remote id when
 * synced, plus a status the API can echo to the SPA.
 */
export interface CalendarSyncResult {
  status: CalendarSyncStatus;
  googleCalendarEventId: string | null;
  message: string;
  /** Deep link that adds the event without Calendar API OAuth. */
  googleTemplateUrl?: string;
  /** Session-authenticated .ics download for Apple Calendar / Outlook. */
  icsUrl?: string;
}

function result(
  status: CalendarSyncStatus,
  googleCalendarEventId: string | null,
  ev?: CalendarEventInput,
): CalendarSyncResult {
  const base: CalendarSyncResult = {
    status,
    googleCalendarEventId,
    message: calendarStatusMessage(status),
  };
  if (ev) {
    base.googleTemplateUrl = googleCalendarTemplateUrl(ev);
    base.icsUrl = `/api/calendar/events/${ev.id}/ics`;
  }
  return base;
}

export async function upsertGoogleCalendarEvent(
  env: Env,
  db: Db,
  userId: string,
  ev: CalendarEventInput,
): Promise<CalendarSyncResult> {
  try {
    const input: CalendarEventInput = { ...ev, allDay: Boolean(ev.allDay) };
    let token = await getUserGoogleAccessToken(env, userId);
    if (!token) return result("skipped_no_token", input.googleCalendarEventId, input);

    // If we already know this login never granted calendar.events, fail fast
    // with a reconnect prompt instead of a opaque Google 403.
    const scopesKnown = Boolean(await env.KV.get(scopesKey(userId)));
    if (
      scopesKnown &&
      !(await userHasScope(env, userId, GOOGLE_SCOPES.calendarEvents))
    ) {
      return result("needs_reconnect", input.googleCalendarEventId, input);
    }

    const body = JSON.stringify(toGcalBody(input));

    async function write(accessToken: string): Promise<Response> {
      if (input.googleCalendarEventId) {
        let res = await gcalFetch(
          accessToken,
          `${CAL_API}/${encodeURIComponent(input.googleCalendarEventId)}`,
          { method: "PATCH", body },
        );
        if (res.status === 404) {
          res = await gcalFetch(accessToken, CAL_API, { method: "POST", body });
        }
        return res;
      }
      return gcalFetch(accessToken, CAL_API, { method: "POST", body });
    }

    let res = await write(token);
    // Stale access token without calendar.events — clear cache and retry once.
    if (res.status === 401) {
      await clearUserGoogleAccessCache(env, userId);
      token = await getUserGoogleAccessToken(env, userId);
      if (!token) return result("skipped_no_token", input.googleCalendarEventId, input);
      res = await write(token);
    }

    if (res.status === 401 || res.status === 403) {
      const errBody = await res.text();
      const kind = classifyGoogleApiError(res.status, errBody);
      console.error(`[gcal] upsert ${res.status}: ${errBody.slice(0, 200)}`);
      if (kind === "api_disabled") {
        return result("needs_api_enabled", input.googleCalendarEventId, input);
      }
      return result("needs_reconnect", input.googleCalendarEventId, input);
    }
    if (!res.ok) {
      console.error(`[gcal] upsert ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return result("failed", input.googleCalendarEventId, input);
    }
    const created = (await res.json()) as { id?: string };
    const remoteId = created.id ?? input.googleCalendarEventId;
    if (remoteId && remoteId !== input.googleCalendarEventId) {
      await db
        .update(schema.events)
        .set({ googleCalendarEventId: remoteId })
        .where(eq(schema.events.id, input.id));
    }
    return result("synced", remoteId ?? null, input);
  } catch (err) {
    console.error("[gcal] upsert failed:", err);
    return result("failed", ev.googleCalendarEventId, { ...ev, allDay: Boolean(ev.allDay) });
  }
}

export async function deleteGoogleCalendarEvent(
  env: Env,
  userId: string,
  googleCalendarEventId: string | null,
): Promise<void> {
  if (!googleCalendarEventId) return;
  try {
    const token = await getUserGoogleAccessToken(env, userId);
    if (!token) return;
    const res = await gcalFetch(
      token,
      `${CAL_API}/${encodeURIComponent(googleCalendarEventId)}`,
      { method: "DELETE" },
    );
    if (!res.ok && res.status !== 404) {
      console.error(`[gcal] delete ${res.status}`);
    }
  } catch (err) {
    console.error("[gcal] delete failed:", err);
  }
}

export { toGcalBody };
