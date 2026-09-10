/**
 * S2 — RSVP.
 *
 * Being an attendee used to be a label the organizer applied to you: the
 * event_attendees row was (event_id, member_id) and nothing else, so "invited"
 * and "coming" were indistinguishable to reminders, the calendar and the ICS
 * feed. Attendance is now a state the attendee owns.
 *
 * The governing rule: answering is always YOUR right, even when you may not
 * touch the event itself. What is guarded is answering for someone else.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { seedCast, request, createEvent, notificationsOfType, SOON, type Cast } from "./helpers/family";

let c: Cast;
beforeEach(() => {
  c = seedCast();
});

async function eventWithGuests(overrides: Record<string, unknown> = {}) {
  return createEvent(c.t, c.dad.cookie, c.familyId, {
    attendeeMemberIds: [c.teen.memberId, c.mum.memberId],
    ...overrides,
  });
}

async function attendeesOf(eventId: string) {
  const res = await request(c.t, "GET", `/api/events/${eventId}`, c.dad.cookie);
  const body = (await res.json()) as {
    attendees: { memberId: string; rsvp: string; rsvpAt: number | null }[];
    rsvpSummary: Record<string, number>;
  };
  return body;
}

describe("S2.1 answering for yourself", () => {
  it("defaults a new attendee to 'invited'", async () => {
    const ev = await eventWithGuests();
    const { attendees } = await attendeesOf(ev.id);
    expect(attendees.every((a) => a.rsvp === "invited")).toBe(true);
  });

  it.each(["accepted", "declined", "tentative"] as const)(
    "records '%s' and stamps the time",
    async (status) => {
      const ev = await eventWithGuests();
      const res = await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.teen.cookie, {
        status,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, rsvp: status });

      const { attendees } = await attendeesOf(ev.id);
      const mine = attendees.find((a) => a.memberId === c.teen.memberId);
      expect(mine?.rsvp).toBe(status);
      expect(mine?.rsvpAt).toBeGreaterThan(0);
    },
  );

  it("only the answerer's own row changes", async () => {
    const ev = await eventWithGuests();
    await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.teen.cookie, {
      status: "declined",
    });
    const { attendees } = await attendeesOf(ev.id);
    expect(attendees.find((a) => a.memberId === c.mum.memberId)?.rsvp).toBe("invited");
  });

  it("keeps only the final answer when it is changed repeatedly", async () => {
    const ev = await eventWithGuests();
    for (const status of ["accepted", "declined", "tentative"] as const) {
      await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.teen.cookie, { status });
    }
    const { attendees } = await attendeesOf(ev.id);
    expect(attendees.filter((a) => a.memberId === c.teen.memberId)).toHaveLength(1);
    expect(attendees.find((a) => a.memberId === c.teen.memberId)?.rsvp).toBe("tentative");
  });

  it("tells the organizer how you answered", async () => {
    const ev = await eventWithGuests();
    await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.teen.cookie, {
      status: "declined",
    });
    const n = await notificationsOfType(c.t, c.dad.cookie, "event_rsvp");
    expect(n).toHaveLength(1);
    expect(n[0].title).toContain("declined");
  });

  it("reports a summary count so the UI needs no second pass", async () => {
    const ev = await eventWithGuests();
    await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.teen.cookie, {
      status: "accepted",
    });
    const { rsvpSummary } = await attendeesOf(ev.id);
    expect(rsvpSummary).toMatchObject({ accepted: 1, invited: 1, declined: 0, tentative: 0 });
  });
});

describe("S2.2 who may answer", () => {
  it("a member who may NOT edit the event can still RSVP", async () => {
    const ev = await eventWithGuests();
    // Teen cannot move Dad's event...
    const patch = await request(c.t, "PATCH", `/api/events/${ev.id}`, c.teen.cookie, {
      title: "hijacked",
    });
    expect(patch.status).toBe(403);
    // ...but answering is always theirs.
    const rsvp = await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.teen.cookie, {
      status: "accepted",
    });
    expect(rsvp.status).toBe(200);
  });

  it("a family member who is not on the guest list gets 403", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.mum.memberId],
    });
    const res = await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.teen.cookie, {
      status: "accepted",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "not_an_attendee" });
  });

  it("another family's member gets 404, not 403 — the event is invisible", async () => {
    const ev = await eventWithGuests();
    const res = await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.stranger.cookie, {
      status: "accepted",
    });
    expect(res.status).toBe(404);
  });

  it("a removed member cannot answer", async () => {
    const ev = await eventWithGuests();
    const res = await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.expelled.cookie, {
      status: "accepted",
    });
    expect(res.status).toBe(404);
  });

  it("you cannot answer on behalf of another adult", async () => {
    const ev = await eventWithGuests();
    const res = await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.teen.cookie, {
      status: "declined",
      memberId: c.mum.memberId,
    });
    expect(res.status).toBe(403);

    const { attendees } = await attendeesOf(ev.id);
    expect(attendees.find((a) => a.memberId === c.mum.memberId)?.rsvp).toBe("invited");
  });
});

describe("S2.3 dependents", () => {
  it("is auto-accepted when scheduled — a small child does not RSVP", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.timmy.id],
    });
    const { attendees } = await attendeesOf(ev.id);
    expect(attendees.find((a) => a.memberId === c.timmy.id)?.rsvp).toBe("accepted");
  });

  it("is auto-accepted when added later too", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
    await request(c.t, "POST", `/api/events/${ev.id}/attendees`, c.dad.cookie, {
      memberIds: [c.timmy.id],
    });
    const { attendees } = await attendeesOf(ev.id);
    expect(attendees.find((a) => a.memberId === c.timmy.id)?.rsvp).toBe("accepted");
  });

  it("a guardian may answer for the dependent", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.timmy.id],
    });
    const res = await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.mum.cookie, {
      status: "declined",
      memberId: c.timmy.id,
    });
    expect(res.status).toBe(200);
    const { attendees } = await attendeesOf(ev.id);
    expect(attendees.find((a) => a.memberId === c.timmy.id)?.rsvp).toBe("declined");
  });

  it("names the dependent in the organizer's notification", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.timmy.id],
    });
    await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.mum.cookie, {
      status: "declined",
      memberId: c.timmy.id,
    });
    const [n] = await notificationsOfType(c.t, c.dad.cookie, "event_rsvp");
    expect(n.title).toContain("Timmy");
  });
});

describe("S2.4 lifecycle and validation", () => {
  it("rejects an unknown status with the house validation shape", async () => {
    const ev = await eventWithGuests();
    const res = await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.teen.cookie, {
      status: "maybe-ish",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "validation_error" });
  });

  it("rejects a missing status", async () => {
    const ev = await eventWithGuests();
    const res = await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.teen.cookie, {});
    expect(res.status).toBe(400);
  });

  it("returns 409 on a cancelled event — nothing left to answer", async () => {
    const ev = await eventWithGuests();
    await request(c.t, "POST", `/api/events/${ev.id}/cancel`, c.dad.cookie);
    const res = await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.teen.cookie, {
      status: "accepted",
    });
    expect(res.status).toBe(409);
  });

  it("returns 404 on a trashed event", async () => {
    const ev = await eventWithGuests();
    await request(c.t, "DELETE", `/api/events/${ev.id}`, c.dad.cookie);
    const res = await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.teen.cookie, {
      status: "accepted",
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for an event that never existed", async () => {
    const res = await request(c.t, "POST", "/api/events/nope/rsvp", c.teen.cookie, {
      status: "accepted",
    });
    expect(res.status).toBe(404);
  });

  it("rejects a memberId from another family", async () => {
    const ev = await eventWithGuests();
    const res = await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.dad.cookie, {
      status: "accepted",
      memberId: c.stranger.memberId,
    });
    expect(res.status).toBe(400);
  });

  it("requires a session", async () => {
    const ev = await eventWithGuests();
    const res = await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, "", {
      status: "accepted",
    });
    expect(res.status).toBe(401);
  });
});
