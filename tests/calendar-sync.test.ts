import { describe, expect, it } from "vitest";
import { buildCalendar, icsEscape } from "../worker/lib/ics";
import { toGcalBody } from "../worker/lib/googleCalendar";

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
