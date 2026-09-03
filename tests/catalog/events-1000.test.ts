/**
 * Events module catalog — create grid over title × type × allDay × location × start offset.
 * 10 × 4 × 2 × 2 × 7 = 1120 POST cases, plus Zod boundary cases.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { catalogReq, seedFamilySession, type FamilySession } from "./helpers";

const TITLES = [
  "Brunch",
  "Checkup",
  "Anniversary",
  "Call",
  "Dinner",
  "School",
  "Flight",
  "Meeting",
  "Birthday",
  "Picnic",
] as const;
const TYPES = ["gathering", "appointment", "milestone", "other"] as const;
const ALL_DAY = [false, true] as const;
const LOCS = [null, "Home"] as const;
const OFFSETS = [-90, -7, 0, 1, 7, 30, 365] as const;
const BASE = 1_800_000_000;

type EventCase = {
  id: number;
  title: string;
  type: (typeof TYPES)[number];
  allDay: boolean;
  location: string | null;
  startAt: number;
};

const EVENT_CASES: EventCase[] = [];
{
  let id = 0;
  for (const title of TITLES) {
    for (const type of TYPES) {
      for (const allDay of ALL_DAY) {
        for (const location of LOCS) {
          for (const off of OFFSETS) {
            EVENT_CASES.push({
              id,
              title: `${title} #${id}`,
              type,
              allDay,
              location,
              startAt: BASE + off * 86_400,
            });
            id += 1;
          }
        }
      }
    }
  }
}

const INVALID: { name: string; body: Record<string, unknown> }[] = [
  { name: "empty title", body: { title: "", startAt: BASE } },
  { name: "title too long", body: { title: "x".repeat(201), startAt: BASE } },
  { name: "startAt zero", body: { title: "x", startAt: 0 } },
  { name: "startAt negative", body: { title: "x", startAt: -1 } },
  { name: "startAt float", body: { title: "x", startAt: 1.5 } },
  { name: "startAt string", body: { title: "x", startAt: "soon" } },
  { name: "missing title", body: { startAt: BASE } },
  { name: "missing startAt", body: { title: "x" } },
  { name: "bad type", body: { title: "x", startAt: BASE, type: "party" } },
  { name: "endAt before startAt", body: { title: "x", startAt: BASE, endAt: BASE - 1 } },
  { name: "allDay string", body: { title: "x", startAt: BASE, allDay: "yes" } },
  { name: "description too long", body: { title: "x", startAt: BASE, description: "d".repeat(2001) } },
  { name: "location too long", body: { title: "x", startAt: BASE, location: "L".repeat(501) } },
  { name: "title null", body: { title: null, startAt: BASE } },
  { name: "attendees not array", body: { title: "x", startAt: BASE, attendeeMemberIds: "me" } },
];

describe("catalog: events ≥1000", () => {
  let s: FamilySession;

  beforeAll(() => {
    s = seedFamilySession();
  });

  it(`records ${EVENT_CASES.length} create combinations`, () => {
    expect(EVENT_CASES.length).toBeGreaterThanOrEqual(1000);
  });

  it.each(EVENT_CASES)(
    "POST #$id $title type=$type allDay=$allDay startAt=$startAt",
    async (c) => {
      const body: Record<string, unknown> = {
        familyId: s.familyId,
        title: c.title,
        startAt: c.startAt,
        type: c.type,
        allDay: c.allDay,
      };
      if (c.location) body.location = c.location;
      const res = await catalogReq(s.env, "POST", "/api/events", {
        cookie: s.actor.cookie,
        body,
      });
      expect(res.status).toBe(201);
      const json = (await res.json()) as {
        event: {
          title: string;
          type: string;
          allDay: boolean;
          location: string | null;
          startAt: number;
          status: string;
        };
      };
      expect(json.event.title).toBe(c.title);
      expect(json.event.type).toBe(c.type);
      expect(json.event.allDay).toBe(c.allDay);
      expect(json.event.startAt).toBe(c.startAt);
      expect(json.event.status).toBe("active");
      if (c.location) expect(json.event.location).toBe(c.location);
    },
  );

  it.each(INVALID)("POST invalid: $name → 400 validation_error", async (c) => {
    const res = await catalogReq(s.env, "POST", "/api/events", {
      cookie: s.actor.cookie,
      body: { familyId: s.familyId, ...c.body },
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; issues: unknown[] };
    expect(json.error).toBe("validation_error");
    expect(Array.isArray(json.issues)).toBe(true);
  });

  it("outsider GET of a created event is 404", async () => {
    const created = await catalogReq(s.env, "POST", "/api/events", {
      cookie: s.actor.cookie,
      body: { familyId: s.familyId, title: "Secret", startAt: BASE + 9, type: "other" },
    });
    const { event } = (await created.json()) as { event: { id: string } };
    const res = await catalogReq(s.env, "GET", `/api/events/${event.id}`, {
      cookie: s.outsider.cookie,
    });
    expect(res.status).toBe(404);
  });
});
