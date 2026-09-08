import { describe, expect, it } from "vitest";
import { buildCalendar, icsEscape } from "../worker/lib/ics";
import {
  toGcalBody,
  calendarStatusMessage,
  toWebcalUrl,
} from "../worker/lib/googleCalendar";
import {
  classifyGoogleApiError,
  scopeListIncludes,
  replaceGrantedScopes,
  userHasScope,
  userCalendarReady,
  cacheUserGoogleAccessToken,
  accessKey,
  scopesKey,
  refreshKey,
} from "../worker/lib/google";
import type { Env } from "../worker/types";

describe("icsEscape", () => {
  it("escapes commas, semicolons and newlines", () => {
    expect(icsEscape("Hi, there;\nbye")).toBe("Hi\\, there\\;\\nbye");
  });
});

describe("buildCalendar", () => {
  it("emits a VCALENDAR with the event title", () => {
    const ics = buildCalendar({
      nowSecs: 1_800_000_000,
      name: "Family Vault",
      events: [
        {
          uid: "evt-1",
          title: "Dinner",
          startAt: 1_800_000_000,
          endAt: 1_800_003_600,
          allDay: false,
        },
      ],
    });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("SUMMARY:Dinner");
    expect(ics).toContain("UID:evt-1@familyvault");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("emits VALUE=DATE for all-day events", () => {
    const ics = buildCalendar({
      nowSecs: 1_800_000_000,
      name: "Family Vault",
      events: [
        {
          uid: "evt-2",
          title: "Holiday",
          startAt: 1_800_000_000,
          endAt: null,
          allDay: true,
        },
      ],
    });
    expect(ics).toContain("DTSTART;VALUE=DATE:");
    expect(ics).toContain("SUMMARY:Holiday");
  });
});

describe("toGcalBody", () => {
  it("uses dateTime for timed events", () => {
    const body = toGcalBody({
      id: "e1",
      title: "Play",
      description: "n",
      location: "Hall",
      startAt: 1_800_000_000,
      endAt: 1_800_003_600,
      allDay: false,
      googleCalendarEventId: null,
    });
    expect(body.summary).toBe("Play");
    expect((body.start as { dateTime: string }).dateTime).toContain("T");
  });

  it("uses date for all-day events", () => {
    const body = toGcalBody({
      id: "e1",
      title: "Holiday",
      description: null,
      location: null,
      startAt: 1_800_000_000,
      endAt: null,
      allDay: true,
      googleCalendarEventId: null,
    });
    expect((body.start as { date: string }).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("classifyGoogleApiError", () => {
  it("treats Calendar/People ACCESS_NOT_CONFIGURED as api_disabled", () => {
    expect(
      classifyGoogleApiError(
        403,
        '{"error":{"errors":[{"reason":"accessNotConfigured"}],"message":"Google Calendar API has not been used in project 123 before or it is disabled."}}',
      ),
    ).toBe("api_disabled");
    expect(
      classifyGoogleApiError(403, "People API has not been used in project X"),
    ).toBe("api_disabled");
  });

  it("treats other 403s as missing OAuth scope", () => {
    expect(classifyGoogleApiError(403, "no calendar scope")).toBe("auth");
    expect(classifyGoogleApiError(401, "invalid token")).toBe("auth");
    expect(classifyGoogleApiError(500, "boom")).toBe("other");
  });
});

describe("calendarStatusMessage", () => {
  it("tells the user to enable the Calendar API", () => {
    expect(calendarStatusMessage("needs_api_enabled")).toMatch(/Calendar API/i);
  });

  it("tells the user the event is on Google when synced", () => {
    expect(calendarStatusMessage("synced")).toMatch(/Google Calendar/i);
  });

  it("points needs_reconnect at Connect Google Calendar in the app", () => {
    expect(calendarStatusMessage("needs_reconnect")).toMatch(/Connect Google Calendar/i);
  });

  it("does not push users to external TEMPLATE links", () => {
    expect(calendarStatusMessage("failed")).not.toMatch(/Add to Google Calendar|TEMPLATE/i);
    expect(calendarStatusMessage("skipped_no_token")).toMatch(/Connect Google Calendar/i);
  });
});

describe("toWebcalUrl", () => {
  it("rewrites https feed URLs for Apple Calendar", () => {
    expect(toWebcalUrl("https://fam.example/api/calendar/feed/abc.ics")).toBe(
      "webcal://fam.example/api/calendar/feed/abc.ics",
    );
  });
});

describe("scope helpers", () => {
  function memKv(store: Map<string, string>): KVNamespace {
    return {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
      delete: async (key: string) => {
        store.delete(key);
      },
    } as unknown as KVNamespace;
  }

  function envWithKv(store: Map<string, string>): Env {
    return {
      ASSETS: {} as Fetcher,
      DB: {} as D1Database,
      KV: memKv(store),
      APP_URL: "https://vault.example",
    };
  }

  it("scopeListIncludes matches full and short forms", () => {
    expect(
      scopeListIncludes(
        ["https://www.googleapis.com/auth/calendar.events"],
        "https://www.googleapis.com/auth/calendar.events",
      ),
    ).toBe(true);
    expect(scopeListIncludes(["calendar.events"], "https://www.googleapis.com/auth/calendar.events")).toBe(
      true,
    );
  });

  it("replaceGrantedScopes overwrites stale calendar flags", async () => {
    const store = new Map<string, string>();
    const env = envWithKv(store);
    const userId = "u1";
    store.set(
      scopesKey(userId),
      JSON.stringify([
        "openid",
        "https://www.googleapis.com/auth/calendar.events",
      ]),
    );
    await replaceGrantedScopes(env, userId, "openid email");
    expect(await userHasScope(env, userId, "https://www.googleapis.com/auth/calendar.events")).toBe(
      false,
    );
  });

  it("userCalendarReady requires both scope and refresh token", async () => {
    const store = new Map<string, string>();
    const env = envWithKv(store);
    const userId = "u1";
    await replaceGrantedScopes(
      env,
      userId,
      "https://www.googleapis.com/auth/calendar.events",
    );
    expect(await userCalendarReady(env, userId)).toBe(false);
    store.set(refreshKey(userId), "rt");
    expect(await userCalendarReady(env, userId)).toBe(true);
  });

  it("cacheUserGoogleAccessToken writes the access key", async () => {
    const store = new Map<string, string>();
    const env = envWithKv(store);
    await cacheUserGoogleAccessToken(env, "u1", "ya29.fresh", 3600);
    expect(store.get(accessKey("u1"))).toBe("ya29.fresh");
  });
});
