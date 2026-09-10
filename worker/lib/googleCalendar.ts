/**
 * Google Calendar API helpers.
 *
 * Family Vault is the source of truth. We push create/update/cancel into each
 * recipient's primary calendar using the Calendar Events API. Best-effort —
 * callers must never fail a D1 write because Google Calendar is unreachable.
 */

import type { Env } from "../types";
import {
  clearGoogleAccessTokenCache,
  getGoogleAccessToken,
  GoogleAuthError,
} from "./googleAuth";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly insufficientScope = false,
  ) {
    super(message);
    this.name = "GoogleCalendarError";
  }
}

export interface FamilyVaultEventForGCal {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: number;
  endAt: number | null;
  allDay: boolean | null;
  status: "active" | "cancelled" | "trashed";
}

export interface GCalEventBody {
  summary: string;
  description?: string;
  location?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
  status?: "confirmed" | "cancelled";
  source?: { title: string; url: string };
  extendedProperties?: { private: Record<string, string> };
}

function unixToIsoZ(secs: number): string {
  return new Date(secs * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** UTC calendar date yyyy-mm-dd from unix seconds. */
function unixToUtcDate(secs: number): string {
  return new Date(secs * 1000).toISOString().slice(0, 10);
}

/** Google all-day DTEND is exclusive — next calendar day after `iso`. */
function nextUtcDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function buildGCalEventBody(
  ev: FamilyVaultEventForGCal,
  appUrl: string,
): GCalEventBody {
  const link = `${appUrl.replace(/\/$/, "")}/calendar/events/${ev.id}`;
  const descriptionParts = [
    ev.description?.trim() || null,
    `Family Vault: ${link}`,
  ].filter(Boolean);

  const body: GCalEventBody = {
    summary: ev.title,
    description: descriptionParts.join("\n\n"),
    status: ev.status === "cancelled" ? "cancelled" : "confirmed",
    source: { title: "Family Vault", url: link },
    extendedProperties: {
      private: { familyVaultEventId: ev.id },
    },
    start: {},
    end: {},
  };
  if (ev.location) body.location = ev.location;

  if (ev.allDay) {
    const startDate = unixToUtcDate(ev.startAt);
    const endDate = ev.endAt
      ? nextUtcDate(unixToUtcDate(ev.endAt))
      : nextUtcDate(startDate);
    body.start = { date: startDate };
    body.end = { date: endDate };
  } else {
    const start = unixToIsoZ(ev.startAt);
    const end = unixToIsoZ(ev.endAt ?? ev.startAt + 3600);
    body.start = { dateTime: start };
    body.end = { dateTime: end };
  }

  return body;
}

async function withAccessToken<T>(
  env: Env,
  userId: string,
  fn: (token: string) => Promise<T>,
): Promise<T> {
  try {
    return await fn(await getGoogleAccessToken(env, userId));
  } catch (e) {
    // Stale cached token or scope change — clear cache and retry once.
    if (
      e instanceof GoogleCalendarError &&
      (e.statusCode === 401 || e.insufficientScope)
    ) {
      await clearGoogleAccessTokenCache(env, userId);
      return await fn(await getGoogleAccessToken(env, userId));
    }
    if (e instanceof GoogleAuthError) {
      throw new GoogleCalendarError(e.message, e.statusCode);
    }
    throw e;
  }
}

function classifyCalendarError(status: number, body: string): GoogleCalendarError {
  const insufficient =
    status === 403 &&
    (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|Insufficient Permission/i.test(
      body,
    ) ||
      /Request had insufficient authentication scopes/i.test(body));
  return new GoogleCalendarError(
    `Google Calendar API ${status}: ${body}`,
    status,
    insufficient,
  );
}

export async function insertGoogleCalendarEvent(
  env: Env,
  userId: string,
  body: GCalEventBody,
  calendarId = "primary",
): Promise<string> {
  return withAccessToken(env, userId, async (token) => {
    const res = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      throw classifyCalendarError(res.status, await res.text());
    }
    const json = (await res.json()) as { id: string };
    return json.id;
  });
}

export async function patchGoogleCalendarEvent(
  env: Env,
  userId: string,
  googleEventId: string,
  body: GCalEventBody,
  calendarId = "primary",
): Promise<void> {
  return withAccessToken(env, userId, async (token) => {
    const res = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      // Gone — treat as missing so the caller can re-insert.
      if (res.status === 404) {
        throw new GoogleCalendarError("Google event not found", 404);
      }
      throw classifyCalendarError(res.status, await res.text());
    }
  });
}

export async function deleteGoogleCalendarEvent(
  env: Env,
  userId: string,
  googleEventId: string,
  calendarId = "primary",
): Promise<void> {
  try {
    await withAccessToken(env, userId, async (token) => {
      const res = await fetch(
        `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      // 404/410 = already gone — success for our purposes.
      if (!res.ok && res.status !== 404 && res.status !== 410) {
        throw classifyCalendarError(res.status, await res.text());
      }
    });
  } catch (e) {
    if (e instanceof GoogleAuthError || e instanceof GoogleCalendarError) {
      // Best-effort cleanup — log and continue so D1 sync rows can still drop.
      console.warn(`Google Calendar delete skipped for ${userId}:`, e.message);
      return;
    }
    throw e;
  }
}
