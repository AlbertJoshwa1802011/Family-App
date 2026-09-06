/**
 * S1 — Scheduling something FOR another person.
 *
 * This is the app's core promise: one member arranges something on another
 * member's behalf, and that person finds out. Before these tests the only
 * in-app notifications came from the daily cron and chat @mentions, so being
 * added to an event produced silence until a reminder window happened to open.
 *
 * Every test here asserts on what the OTHER member sees, never on the
 * organizer's own response body.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  seedCast,
  request,
  createEvent,
  notificationsFor,
  notificationsOfType,
  SOON,
  type Cast,
} from "./helpers/family";

let c: Cast;
beforeEach(() => {
  c = seedCast();
});

describe("S1.1 inviting", () => {
  it("notifies each attendee that they were added", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      title: "Grandpa's 80th",
      attendeeMemberIds: [c.teen.memberId, c.mum.memberId],
    });

    for (const actor of [c.teen, c.mum]) {
      const n = await notificationsOfType(c.t, actor.cookie, "event_invite");
      expect(n).toHaveLength(1);
      expect(n[0].title).toContain("Grandpa's 80th");
      expect(n[0].title).toContain("Dad");
    }
  });

  it("never notifies the organizer about their own action", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.dad.memberId, c.teen.memberId],
    });
    expect(await notificationsFor(c.t, c.dad.cookie)).toHaveLength(0);
    expect(await notificationsOfType(c.t, c.teen.cookie, "event_invite")).toHaveLength(1);
  });

  it("links the notification to the event so it is one tap away", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    const [n] = await notificationsOfType(c.t, c.teen.cookie, "event_invite");
    expect(n.link).toBe(`/calendar/events/${ev.id}`);
  });

  it("carries the date, and the location when there is one", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      location: "Royal Free Hospital",
      attendeeMemberIds: [c.teen.memberId],
    });
    const [n] = await notificationsOfType(c.t, c.teen.cookie, "event_invite");
    expect(n.body).toContain("Royal Free Hospital");
  });

  it("creates no notification for an event with no attendees", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId);
    expect(await notificationsFor(c.t, c.teen.cookie)).toHaveLength(0);
    expect(await notificationsFor(c.t, c.mum.cookie)).toHaveLength(0);
  });

  it("does not notify a dependent — they have no account to notify", async () => {
    const res = await request(c.t, "POST", "/api/events", c.dad.cookie, {
      familyId: c.familyId,
      title: "Timmy's dentist",
      startAt: SOON,
      attendeeMemberIds: [c.timmy.id],
    });
    // The scheduling still succeeds; there is simply nobody to tell.
    expect(res.status).toBe(201);
  });

  it("does not notify invited-but-inactive or removed members", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.gran.memberId, c.expelled.memberId, c.teen.memberId],
    });
    expect(await notificationsFor(c.t, c.gran.cookie)).toHaveLength(0);
    expect(await notificationsFor(c.t, c.expelled.cookie)).toHaveLength(0);
    expect(await notificationsOfType(c.t, c.teen.cookie, "event_invite")).toHaveLength(1);
  });

  it("de-duplicates a member listed twice: one row, one notification", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId, c.teen.memberId],
    });
    expect(await notificationsOfType(c.t, c.teen.cookie, "event_invite")).toHaveLength(1);

    const det = await request(c.t, "GET", `/api/events/${ev.id}`, c.dad.cookie);
    const { attendees } = (await det.json()) as { attendees: unknown[] };
    expect(attendees).toHaveLength(1);
  });
});

describe("S1.2 adding attendees later", () => {
  it("notifies only the newly added member", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    const res = await request(c.t, "POST", `/api/events/${ev.id}/attendees`, c.dad.cookie, {
      memberIds: [c.mum.memberId],
    });
    expect(res.status).toBe(200);

    expect(await notificationsOfType(c.t, c.mum.cookie, "event_invite")).toHaveLength(1);
    // Teen was already on the list — no second ping.
    expect(await notificationsOfType(c.t, c.teen.cookie, "event_invite")).toHaveLength(1);
  });

  it("re-adding an existing attendee notifies nobody a second time", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    const res = await request(c.t, "POST", `/api/events/${ev.id}/attendees`, c.dad.cookie, {
      memberIds: [c.teen.memberId],
    });
    const body = (await res.json()) as { added: number };
    expect(body.added).toBe(0);
    expect(await notificationsOfType(c.t, c.teen.cookie, "event_invite")).toHaveLength(1);
  });

  it("tells a member when they are removed from the guest list", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    await request(
      c.t,
      "DELETE",
      `/api/events/${ev.id}/attendees/${c.teen.memberId}`,
      c.dad.cookie,
    );
    const n = await notificationsOfType(c.t, c.teen.cookie, "event_uninvited");
    expect(n).toHaveLength(1);
  });
});

describe("S1.3 rescheduling", () => {
  it("tells every attendee, with the old time and the new one", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      title: "Dentist",
      attendeeMemberIds: [c.teen.memberId, c.mum.memberId],
    });
    // Move both ends: startAt alone would land past the stored endAt, which the
    // server correctly rejects.
    const res = await request(c.t, "PATCH", `/api/events/${ev.id}`, c.dad.cookie, {
      startAt: SOON + 86_400,
      endAt: SOON + 86_400 + 3600,
    });
    expect(res.status).toBe(200);

    const n = await notificationsOfType(c.t, c.teen.cookie, "event_rescheduled");
    expect(n).toHaveLength(1);
    expect(n[0].title).toContain("Dentist");
    expect(n[0].body).toContain("changed it from");
    expect(await notificationsOfType(c.t, c.mum.cookie, "event_rescheduled")).toHaveLength(1);
  });

  it("tells the creator when someone ELSE moves their event", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    // Mum is an admin, so she may move Dad's event — but Dad must hear about it.
    await request(c.t, "PATCH", `/api/events/${ev.id}`, c.mum.cookie, {
      startAt: SOON + 7200,
      endAt: SOON + 10_800,
    });
    expect(await notificationsOfType(c.t, c.dad.cookie, "event_rescheduled")).toHaveLength(1);
  });

  it("does not fire when the time did not actually change", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    await request(c.t, "PATCH", `/api/events/${ev.id}`, c.dad.cookie, {
      title: "Dentist (rearranged room)",
      startAt: SOON, // identical
    });
    expect(await notificationsOfType(c.t, c.teen.cookie, "event_rescheduled")).toHaveLength(0);
  });

  it("a title-only edit notifies nobody", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    await request(c.t, "PATCH", `/api/events/${ev.id}`, c.dad.cookie, { title: "New title" });
    expect(await notificationsOfType(c.t, c.teen.cookie, "event_rescheduled")).toHaveLength(0);
  });

  it("replacing the attendee list notifies joiners and leavers differently", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    await request(c.t, "PATCH", `/api/events/${ev.id}`, c.dad.cookie, {
      attendeeMemberIds: [c.mum.memberId],
    });
    expect(await notificationsOfType(c.t, c.mum.cookie, "event_invite")).toHaveLength(1);
    expect(await notificationsOfType(c.t, c.teen.cookie, "event_uninvited")).toHaveLength(1);
  });

  it("keeps an existing RSVP when the attendee list is rewritten", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.teen.cookie, {
      status: "accepted",
    });
    // Dad adds Mum; Teen stays on the list and must not be reset to 'invited'.
    await request(c.t, "PATCH", `/api/events/${ev.id}`, c.dad.cookie, {
      attendeeMemberIds: [c.teen.memberId, c.mum.memberId],
    });

    const det = await request(c.t, "GET", `/api/events/${ev.id}`, c.dad.cookie);
    const { attendees } = (await det.json()) as {
      attendees: { memberId: string; rsvp: string }[];
    };
    expect(attendees.find((a) => a.memberId === c.teen.memberId)?.rsvp).toBe("accepted");
    expect(attendees.find((a) => a.memberId === c.mum.memberId)?.rsvp).toBe("invited");
  });
});

describe("S1.4 cancelling and deleting", () => {
  it("cancelling tells every attendee once", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      title: "Picnic",
      attendeeMemberIds: [c.teen.memberId, c.mum.memberId],
    });
    await request(c.t, "POST", `/api/events/${ev.id}/cancel`, c.dad.cookie);

    for (const actor of [c.teen, c.mum]) {
      const n = await notificationsOfType(c.t, actor.cookie, "event_cancelled");
      expect(n).toHaveLength(1);
      expect(n[0].title).toContain("Picnic");
    }
  });

  it("deleting (trashing) also tells the attendees", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    await request(c.t, "DELETE", `/api/events/${ev.id}`, c.dad.cookie);
    expect(await notificationsOfType(c.t, c.teen.cookie, "event_cancelled")).toHaveLength(1);
  });

  it("a cancelled event stays visible — cancel is not delete", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
    await request(c.t, "POST", `/api/events/${ev.id}/cancel`, c.dad.cookie);
    const res = await request(c.t, "GET", `/api/events/${ev.id}`, c.teen.cookie);
    expect(res.status).toBe(200);
    const { event } = (await res.json()) as { event: { status: string } };
    expect(event.status).toBe("cancelled");
  });
});
