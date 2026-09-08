/**
 * Google Calendar write-sync for family events.
 *
 * Uses the signed-in user's OAuth tokens (KV refresh + cached access).
 * Create/update always attempt a Calendar API write in-app — never via
 * external Google TEMPLATE redirects. Delete/cancel remove the remote event
 * from the creator's primary calendar.
 */
import type { Env } from "../types";
import type { Db } from "../db/client";
import { schema } from "../db/client";
import { eq } from "drizzle-orm";
import {
  GOOGLE_SCOPES,
  classifyGoogleApiError,
  clearUserGoogleAccessCache,
  dropGrantedScope,
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

/** Convert an https ICS feed URL into a webcal:// URL for Apple Calendar. */
export function toWebcalUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https:/i, "webcal:").replace(/^http:/i, "webcal:");
}

export function calendarStatusMessage(status: CalendarSyncStatus): string {
  switch (status) {
    case "synced":
      return "Saved to your Google Calendar automatically.";
    case "skipped_no_token":
      return "Connect Google Calendar in Settings once — new events then save to Google automatically.";
    case "needs_reconnect":
      return "Google Calendar permission expired. Tap Connect Google Calendar in the app, accept access, then save again.";
    case "needs_api_enabled":
      return "Enable Google Calendar API on the Cloud project (docs/OPS.md §6), then reconnect Calendar in Settings.";
    case "failed":
      return "Could not write to Google Calendar. Tap Sync to retry, or reconnect Calendar in Settings.";
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

export interface CalendarSyncResult {
  status: CalendarSyncStatus;
  googleCalendarEventId: string | null;
  message: string;
}

function result(
  status: CalendarSyncStatus,
  googleCalendarEventId: string | null,
): CalendarSyncResult {
  return {
    status,
    googleCalendarEventId,
    message: calendarStatusMessage(status),
  };
}

async function withFreshToken(
  env: Env,
  userId: string,
  write: (token: string) => Promise<Response>,
): Promise<{ res: Response; token: string } | { error: CalendarSyncStatus }> {
  let token = await getUserGoogleAccessToken(env, userId);
  if (!token) return { error: "skipped_no_token" };

  let res = await write(token);
  // Stale cached access token (often minted for Drive before calendar.events)
  // returns 401 or insufficient-scope 403 — clear and retry once from refresh.
  if (res.status === 401 || res.status === 403) {
    const peek = await res.clone().text();
    const kind = classifyGoogleApiError(res.status, peek);
    if (kind === "auth") {
      await clearUserGoogleAccessCache(env, userId);
      token = await getUserGoogleAccessToken(env, userId);
      if (!token) return { error: "skipped_no_token" };
      res = await write(token);
    }
  }
  return { res, token };
}

export async function upsertGoogleCalendarEvent(
  env: Env,
  db: Db,
  userId: string,
  ev: CalendarEventInput,
): Promise<CalendarSyncResult> {
  try {
    const input: CalendarEventInput = { ...ev, allDay: Boolean(ev.allDay) };

    const scopesKnown = Boolean(await env.KV.get(scopesKey(userId)));
    if (
      scopesKnown &&
      !(await userHasScope(env, userId, GOOGLE_SCOPES.calendarEvents))
    ) {
      return result("needs_reconnect", input.googleCalendarEventId);
    }

    const body = JSON.stringify(toGcalBody(input));

    const outcome = await withFreshToken(env, userId, async (accessToken) => {
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
    });

    if ("error" in outcome) {
      return result(outcome.error, input.googleCalendarEventId);
    }

    const { res } = outcome;
    if (res.status === 401 || res.status === 403) {
      const errBody = await res.text();
      const kind = classifyGoogleApiError(res.status, errBody);
      console.error(`[gcal] upsert ${res.status}: ${errBody.slice(0, 200)}`);
      if (kind === "api_disabled") {
        return result("needs_api_enabled", input.googleCalendarEventId);
      }
      // Live token lacks calendar — drop the stale KV flag so Settings matches.
      await dropGrantedScope(env, userId, GOOGLE_SCOPES.calendarEvents);
      return result("needs_reconnect", input.googleCalendarEventId);
    }
    if (!res.ok) {
      console.error(`[gcal] upsert ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return result("failed", input.googleCalendarEventId);
    }
    const created = (await res.json()) as { id?: string };
    const remoteId = created.id ?? input.googleCalendarEventId;
    if (remoteId && remoteId !== input.googleCalendarEventId) {
      await db
        .update(schema.events)
        .set({ googleCalendarEventId: remoteId })
        .where(eq(schema.events.id, input.id));
    }
    return result("synced", remoteId ?? null);
  } catch (err) {
    console.error("[gcal] upsert failed:", err);
    return result("failed", ev.googleCalendarEventId);
  }
}

/**
 * Delete the Google Calendar copy. Prefer the event *creator's* userId — the
 * event lives on their primary calendar. Returns true when remote is gone
 * (or never existed / already 404).
 */
export async function deleteGoogleCalendarEvent(
  env: Env,
  userId: string,
  googleCalendarEventId: string | null,
): Promise<boolean> {
  if (!googleCalendarEventId) return true;
  try {
    const outcome = await withFreshToken(env, userId, (accessToken) =>
      gcalFetch(
        accessToken,
        `${CAL_API}/${encodeURIComponent(googleCalendarEventId)}`,
        { method: "DELETE" },
      ),
    );
    if ("error" in outcome) {
      console.error(`[gcal] delete skipped: ${outcome.error}`);
      return false;
    }
    const { res } = outcome;
    if (res.ok || res.status === 404) return true;
    console.error(`[gcal] delete ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return false;
  } catch (err) {
    console.error("[gcal] delete failed:", err);
    return false;
  }
}

export { toGcalBody };
