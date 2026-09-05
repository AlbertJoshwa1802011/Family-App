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
import { classifyGoogleApiError, getUserGoogleAccessToken } from "./google";

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
  const endSecs = ev.endAt && ev.endAt > ev.startAt ? ev.endAt : ev.startAt + 3600;
  if (ev.allDay) {
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

export function calendarStatusMessage(status: CalendarSyncStatus): string {
  switch (status) {
    case "synced":
      return "Saved to Google Calendar.";
    case "skipped_no_token":
      return "Sign in again in Settings to grant Google Calendar access.";
    case "needs_reconnect":
      return "Reconnect Google Calendar in Settings (calendar.events).";
    case "needs_api_enabled":
      return "Enable Google Calendar API on the Cloud project, then tap Sync again.";
    case "failed":
      return "Google Calendar could not save this event. Try Sync again or download an .ics file.";
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
}

function result(
  status: CalendarSyncStatus,
  googleCalendarEventId: string | null,
): CalendarSyncResult {
  return { status, googleCalendarEventId, message: calendarStatusMessage(status) };
}

export async function upsertGoogleCalendarEvent(
  env: Env,
  db: Db,
  userId: string,
  ev: CalendarEventInput,
): Promise<CalendarSyncResult> {
  try {
    const token = await getUserGoogleAccessToken(env, userId);
    if (!token) return result("skipped_no_token", ev.googleCalendarEventId);

    const body = JSON.stringify(toGcalBody(ev));
    let res: Response;
    if (ev.googleCalendarEventId) {
      res = await gcalFetch(token, `${CAL_API}/${encodeURIComponent(ev.googleCalendarEventId)}`, {
        method: "PATCH",
        body,
      });
      if (res.status === 404) {
        res = await gcalFetch(token, CAL_API, { method: "POST", body });
      }
    } else {
      res = await gcalFetch(token, CAL_API, { method: "POST", body });
    }

    if (res.status === 401 || res.status === 403) {
      const errBody = await res.text();
      const kind = classifyGoogleApiError(res.status, errBody);
      console.error(`[gcal] upsert ${res.status}: ${errBody.slice(0, 200)}`);
      if (kind === "api_disabled") return result("needs_api_enabled", ev.googleCalendarEventId);
      return result("needs_reconnect", ev.googleCalendarEventId);
    }
    if (!res.ok) {
      console.error(`[gcal] upsert ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return result("failed", ev.googleCalendarEventId);
    }
    const created = (await res.json()) as { id?: string };
    const remoteId = created.id ?? ev.googleCalendarEventId;
    if (remoteId && remoteId !== ev.googleCalendarEventId) {
      await db
        .update(schema.events)
        .set({ googleCalendarEventId: remoteId })
        .where(eq(schema.events.id, ev.id));
    }
    return result("synced", remoteId ?? null);
  } catch (err) {
    console.error("[gcal] upsert failed:", err);
    return result("failed", ev.googleCalendarEventId);
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
