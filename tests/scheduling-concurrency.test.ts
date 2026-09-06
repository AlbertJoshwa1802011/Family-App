/**
 * S5 — Two members editing the same event at once.
 *
 * Previously both writers got 200 and the later one silently won: whoever
 * saved second overwrote the other's change with no signal to either party.
 * PATCH now accepts the `version` the client last read and rejects a write
 * built on a stale view with 409. A timestamp cannot do this job: updatedAt has
 * one-second granularity, so two members saving inside the same second would
 * both look current — hence a monotonic counter.
 *
 * The precondition is OPT-IN so existing clients keep working; the tests pin
 * both behaviours so neither can be changed by accident.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { seedCast, request, createEvent, SOON, type Cast } from "./helpers/family";

let c: Cast;
beforeEach(() => {
  c = seedCast();
});

async function readEvent(id: string, cookie: string) {
  const res = await request(c.t, "GET", `/api/events/${id}`, cookie);
  const { event } = (await res.json()) as {
    event: { title: string; startAt: number; version: number; status: string };
  };
  return event;
}

describe("S5.1 optimistic concurrency", () => {
  it("rejects a write based on a stale read", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
    const stale = await readEvent(ev.id, c.dad.cookie);

    // Mum saves first, moving the event forward.
    const first = await request(c.t, "PATCH", `/api/events/${ev.id}`, c.mum.cookie, {
      title: "Mum's title",
      expectedVersion: stale.version,
    });
    expect(first.status).toBe(200);

    // Dad still holds the version he read before Mum saved.
    const second = await request(c.t, "PATCH", `/api/events/${ev.id}`, c.dad.cookie, {
      title: "Dad's title",
      expectedVersion: stale.version,
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      error: "conflict",
      reason: "event_modified",
    });
  });

  it("the loser's change is not applied", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
    const stale = await readEvent(ev.id, c.dad.cookie);

    await request(c.t, "PATCH", `/api/events/${ev.id}`, c.mum.cookie, {
      title: "Mum's title",
      expectedVersion: stale.version,
    });
    await request(c.t, "PATCH", `/api/events/${ev.id}`, c.dad.cookie, {
      title: "Dad's title",
      expectedVersion: stale.version,
    });

    expect((await readEvent(ev.id, c.dad.cookie)).title).toBe("Mum's title");
  });

  it("hands back the current version so the client can merge and retry", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
    const stale = await readEvent(ev.id, c.dad.cookie);

    await request(c.t, "PATCH", `/api/events/${ev.id}`, c.mum.cookie, {
      title: "Mum's title",
      expectedVersion: stale.version,
    });
    const conflicted = await request(c.t, "PATCH", `/api/events/${ev.id}`, c.dad.cookie, {
      title: "Dad's title",
      expectedVersion: stale.version,
    });
    const body = (await conflicted.json()) as { currentVersion: number };

    // Retrying with the version the server reported succeeds.
    const retry = await request(c.t, "PATCH", `/api/events/${ev.id}`, c.dad.cookie, {
      title: "Dad's title",
      expectedVersion: body.currentVersion,
    });
    expect(retry.status).toBe(200);
    expect((await readEvent(ev.id, c.dad.cookie)).title).toBe("Dad's title");
  });

  it("a fresh read always succeeds", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
    const fresh = await readEvent(ev.id, c.dad.cookie);
    const res = await request(c.t, "PATCH", `/api/events/${ev.id}`, c.dad.cookie, {
      title: "Fine",
      expectedVersion: fresh.version,
    });
    expect(res.status).toBe(200);
  });

  it("omitting the precondition keeps last-write-wins for old clients", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
    const [a, b] = await Promise.all([
      request(c.t, "PATCH", `/api/events/${ev.id}`, c.dad.cookie, { title: "A" }),
      request(c.t, "PATCH", `/api/events/${ev.id}`, c.mum.cookie, { title: "B" }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(["A", "B"]).toContain((await readEvent(ev.id, c.dad.cookie)).title);
  });

  it("authorization is checked before the precondition", async () => {
    // A plain member with a stale version must get 403, not a 409 that leaks
    // whether the event changed.
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
    const res = await request(c.t, "PATCH", `/api/events/${ev.id}`, c.teen.cookie, {
      title: "x",
      expectedVersion: 1,
    });
    expect(res.status).toBe(403);
  });

  it("rejects a non-numeric precondition with validation_error", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
    const res = await request(c.t, "PATCH", `/api/events/${ev.id}`, c.dad.cookie, {
      expectedVersion: "yesterday",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "validation_error" });
  });
});

describe("S5.2 racing different operations", () => {
  it("concurrent attendee adds both survive", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
    await Promise.all([
      request(c.t, "POST", `/api/events/${ev.id}/attendees`, c.dad.cookie, {
        memberIds: [c.teen.memberId],
      }),
      request(c.t, "POST", `/api/events/${ev.id}/attendees`, c.mum.cookie, {
        memberIds: [c.timmy.id],
      }),
    ]);

    const det = await request(c.t, "GET", `/api/events/${ev.id}`, c.dad.cookie);
    const { attendees } = (await det.json()) as { attendees: { memberId: string }[] };
    expect(attendees.map((a) => a.memberId).sort()).toEqual(
      [c.teen.memberId, c.timmy.id].sort(),
    );
  });

  it("a rename does not wipe the guest list", async () => {
    // Regression: .partial() on a schema carrying .default([]) filled
    // attendeeMemberIds on every patch, so the handler's replace-semantics
    // deleted every attendee whenever anyone edited the title.
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId, c.mum.memberId],
    });
    await request(c.t, "PATCH", `/api/events/${ev.id}`, c.dad.cookie, {
      title: "Renamed only",
    });

    const det = await request(c.t, "GET", `/api/events/${ev.id}`, c.dad.cookie);
    const { attendees } = (await det.json()) as { attendees: unknown[] };
    expect(attendees).toHaveLength(2);
  });

  it("a rename does not reset type or allDay", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      type: "appointment",
      allDay: true,
    });
    await request(c.t, "PATCH", `/api/events/${ev.id}`, c.dad.cookie, {
      title: "Renamed only",
    });
    const after = await request(c.t, "GET", `/api/events/${ev.id}`, c.dad.cookie);
    const { event } = (await after.json()) as {
      event: { type: string; allDay: boolean };
    };
    expect(event.type).toBe("appointment");
    expect(event.allDay).toBe(true);
  });

  it("moving startAt alone cannot leave endAt before it", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      startAt: SOON,
      endAt: SOON + 3600,
    });
    const res = await request(c.t, "PATCH", `/api/events/${ev.id}`, c.dad.cookie, {
      startAt: SOON + 86_400,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "validation_error" });
  });

  it("an RSVP racing a delete does not leave an orphan answer", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    await request(c.t, "DELETE", `/api/events/${ev.id}`, c.dad.cookie);
    const rsvp = await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.teen.cookie, {
      status: "accepted",
    });
    expect(rsvp.status).toBe(404);
  });

  it("cancel then reschedule: the event stays cancelled", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
    await request(c.t, "POST", `/api/events/${ev.id}/cancel`, c.dad.cookie);
    await request(c.t, "PATCH", `/api/events/${ev.id}`, c.dad.cookie, {
      startAt: SOON + 3600,
      endAt: SOON + 7200,
    });
    expect((await readEvent(ev.id, c.dad.cookie)).status).toBe("cancelled");
  });

  it("cancelling twice does not notify twice", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    await request(c.t, "POST", `/api/events/${ev.id}/cancel`, c.dad.cookie);
    const second = await request(c.t, "POST", `/api/events/${ev.id}/cancel`, c.dad.cookie);
    // Already cancelled → the handler only matches 'active' rows.
    expect(second.status).toBe(404);

    const res = await request(c.t, "GET", "/api/notifications", c.teen.cookie);
    const { notifications } = (await res.json()) as { notifications: { type: string }[] };
    expect(notifications.filter((n) => n.type === "event_cancelled")).toHaveLength(1);
  });
});
