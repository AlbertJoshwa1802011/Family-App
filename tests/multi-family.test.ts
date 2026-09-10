/**
 * S7 — One person, two families.
 *
 * The case the app got wrong: /families/me/members ignored which family you
 * were asking about and answered with whichever family you happened to join
 * first. A parent in both their own household and an extended-family group got
 * the wrong attendee picker, and the event create then failed server-side with
 * invalid_member_ids — a bug with no visible cause.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  seedCast,
  request,
  createEvent,
  notificationsOfType,
  SOON,
  type Cast,
} from "./helpers/family";
import { seedMember } from "./helpers/testEnv";

let c: Cast;
/** Dad's membership id inside the OTHER family. */
let dadInOther: string;

beforeEach(() => {
  c = seedCast();
  dadInOther = seedMember(c.t.sqlite, c.otherFamilyId, c.dad.userId, "member").id;
});

describe("S7.1 member listing is scoped to the family you ask about", () => {
  it("returns the requested family's members, not the first one joined", async () => {
    const res = await request(
      c.t,
      "GET",
      `/api/families/me/members?familyId=${c.otherFamilyId}`,
      c.dad.cookie,
    );
    const { members } = (await res.json()) as { members: { id: string }[] };
    const ids = members.map((m) => m.id);

    expect(ids).toContain(dadInOther);
    expect(ids).toContain(c.stranger.memberId);
    // Nobody from the first family may appear.
    expect(ids).not.toContain(c.teen.memberId);
    expect(ids).not.toContain(c.mum.memberId);
  });

  it("returns the first family's members when asked for that one", async () => {
    const res = await request(
      c.t,
      "GET",
      `/api/families/me/members?familyId=${c.familyId}`,
      c.dad.cookie,
    );
    const { members } = (await res.json()) as { members: { id: string }[] };
    const ids = members.map((m) => m.id);

    expect(ids).toContain(c.teen.memberId);
    expect(ids).not.toContain(c.stranger.memberId);
  });

  it("returns nothing for a family you do not belong to", async () => {
    const res = await request(
      c.t,
      "GET",
      `/api/families/me/members?familyId=${c.otherFamilyId}`,
      c.teen.cookie,
    );
    const { members } = (await res.json()) as { members: unknown[] };
    expect(members).toHaveLength(0);
  });

  it("returns nothing for a family id that does not exist", async () => {
    const res = await request(
      c.t,
      "GET",
      "/api/families/me/members?familyId=does-not-exist",
      c.dad.cookie,
    );
    const { members } = (await res.json()) as { members: unknown[] };
    expect(members).toHaveLength(0);
  });

  it("still answers without the param, for older clients", async () => {
    const res = await request(c.t, "GET", "/api/families/me/members", c.dad.cookie);
    expect(res.status).toBe(200);
  });
});

describe("S7.2 scheduling stays inside one family", () => {
  it("a member of two families can schedule in each", async () => {
    const a = await createEvent(c.t, c.dad.cookie, c.familyId, {
      title: "Home dinner",
      attendeeMemberIds: [c.teen.memberId],
    });
    const b = await createEvent(c.t, c.dad.cookie, c.otherFamilyId, {
      title: "Cousins' reunion",
      attendeeMemberIds: [c.stranger.memberId],
    });
    expect(a.id).not.toBe(b.id);
  });

  it("rejects an attendee from the other family", async () => {
    const res = await request(c.t, "POST", "/api/events", c.dad.cookie, {
      familyId: c.familyId,
      title: "Cross-family",
      startAt: SOON,
      attendeeMemberIds: [c.stranger.memberId],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_member_ids" });
  });

  it("each family's event list contains only its own events", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId, { title: "Home dinner" });
    await createEvent(c.t, c.dad.cookie, c.otherFamilyId, { title: "Cousins' reunion" });

    const res = await request(
      c.t,
      "GET",
      `/api/events?familyId=${c.familyId}`,
      c.dad.cookie,
    );
    const { events } = (await res.json()) as { events: { title: string }[] };
    expect(events.map((e) => e.title)).toEqual(["Home dinner"]);
  });

  it("notifications carry the family they belong to", async () => {
    await createEvent(c.t, c.dad.cookie, c.otherFamilyId, {
      title: "Cousins' reunion",
      attendeeMemberIds: [c.stranger.memberId],
    });
    const res = await request(c.t, "GET", "/api/notifications", c.stranger.cookie);
    const { notifications } = (await res.json()) as {
      notifications: { familyId: string }[];
    };
    expect(notifications[0].familyId).toBe(c.otherFamilyId);
  });

  it("the other family's members never see the first family's events", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
    const res = await request(c.t, "GET", `/api/events/${ev.id}`, c.stranger.cookie);
    expect(res.status).toBe(404);
  });
});

describe("S7.3 the attendee filter", () => {
  it("returns only the events that member attends", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      title: "Teen's thing",
      attendeeMemberIds: [c.teen.memberId],
    });
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      title: "Mum's thing",
      attendeeMemberIds: [c.mum.memberId],
    });

    const res = await request(
      c.t,
      "GET",
      `/api/events?familyId=${c.familyId}&member=${c.teen.memberId}`,
      c.teen.cookie,
    );
    const { events } = (await res.json()) as { events: { title: string }[] };
    expect(events.map((e) => e.title)).toEqual(["Teen's thing"]);
  });

  it("returns an empty list for a member who attends nothing", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.mum.memberId],
    });
    const res = await request(
      c.t,
      "GET",
      `/api/events?familyId=${c.familyId}&member=${c.teen.memberId}`,
      c.teen.cookie,
    );
    const { events } = (await res.json()) as { events: unknown[] };
    expect(events).toHaveLength(0);
  });

  it("works for a dependent, so a guardian can see the child's calendar", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      title: "Timmy's dentist",
      attendeeMemberIds: [c.timmy.id],
    });
    const res = await request(
      c.t,
      "GET",
      `/api/events?familyId=${c.familyId}&member=${c.timmy.id}`,
      c.dad.cookie,
    );
    const { events } = (await res.json()) as { events: { title: string }[] };
    expect(events.map((e) => e.title)).toEqual(["Timmy's dentist"]);
  });

  it("combines with the date range", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      title: "In range",
      attendeeMemberIds: [c.teen.memberId],
    });
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      title: "Far future",
      startAt: SOON + 300 * 86_400,
      endAt: SOON + 300 * 86_400 + 3600,
      attendeeMemberIds: [c.teen.memberId],
    });

    const res = await request(
      c.t,
      "GET",
      `/api/events?familyId=${c.familyId}&member=${c.teen.memberId}&from=${SOON - 86_400}&to=${SOON + 86_400}`,
      c.teen.cookie,
    );
    const { events } = (await res.json()) as { events: { title: string }[] };
    expect(events.map((e) => e.title)).toEqual(["In range"]);
  });

  it("cannot be used to peek into another family", async () => {
    const res = await request(
      c.t,
      "GET",
      `/api/events?familyId=${c.otherFamilyId}&member=${c.stranger.memberId}`,
      c.teen.cookie,
    );
    expect(res.status).toBe(404);
  });
});

describe("S7.4 notifications are per-user", () => {
  it("one member's invitation never lands in another's list", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    expect(await notificationsOfType(c.t, c.teen.cookie, "event_invite")).toHaveLength(1);
    expect(await notificationsOfType(c.t, c.mum.cookie, "event_invite")).toHaveLength(0);
  });
});
