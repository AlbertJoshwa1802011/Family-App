/**
 * S4 — Double-booking detection and free/busy.
 *
 * Before this, scheduling two events over the same person at the same time
 * succeeded silently. Detection is deliberately ADVISORY: the response carries
 * a `conflicts` array and the write still succeeds, because the organizer is an
 * adult who can see the clash and decide. Blocking would be wrong — families
 * double-book on purpose all the time.
 *
 * Half-open intervals throughout: an event starting exactly when another ends
 * is back-to-back, not a clash.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { overlaps, spanOf, DEFAULT_DURATION } from "../worker/lib/conflicts";
import { seedCast, request, createEvent, SOON, type Cast } from "./helpers/family";

// ── Unit: the interval maths, independent of any database ────────────────────

describe("S4.1 overlap maths", () => {
  const at = (h: number) => 1_800_000_000 + h * 3600;

  it("detects a plain overlap", () => {
    expect(
      overlaps({ startAt: at(9), endAt: at(11) }, { startAt: at(10), endAt: at(12) }),
    ).toBe(true);
  });

  it("treats touching intervals as back-to-back, not a clash", () => {
    expect(
      overlaps({ startAt: at(9), endAt: at(10) }, { startAt: at(10), endAt: at(11) }),
    ).toBe(false);
  });

  it("is symmetric", () => {
    const a = { startAt: at(9), endAt: at(11) };
    const b = { startAt: at(10), endAt: at(12) };
    expect(overlaps(a, b)).toBe(overlaps(b, a));
  });

  it("detects full containment", () => {
    expect(
      overlaps({ startAt: at(9), endAt: at(17) }, { startAt: at(10), endAt: at(11) }),
    ).toBe(true);
  });

  it("gives an event with no endAt a default duration", () => {
    const span = spanOf({ startAt: at(9) });
    expect(span.end - span.start).toBe(DEFAULT_DURATION);
  });

  it("ignores an endAt that precedes startAt rather than inverting the span", () => {
    const span = spanOf({ startAt: at(9), endAt: at(8) });
    expect(span.end).toBeGreaterThan(span.start);
  });

  it("expands an all-day event to its whole UTC day", () => {
    const span = spanOf({ startAt: at(9), allDay: true });
    expect(span.end - span.start).toBe(86_400);
    expect(span.start % 86_400).toBe(0);
  });

  it("clashes an all-day event with a timed one on the same day", () => {
    expect(
      overlaps({ startAt: at(0), allDay: true }, { startAt: at(14), endAt: at(15) }),
    ).toBe(true);
  });

  it("does not clash an all-day event with the next day", () => {
    expect(
      overlaps({ startAt: at(0), allDay: true }, { startAt: at(25), endAt: at(26) }),
    ).toBe(false);
  });
});

// ── Integration: conflicts reported through the API ──────────────────────────

let c: Cast;
beforeEach(() => {
  c = seedCast();
});

interface CreateResult {
  status: number;
  conflicts: { eventId: string; title: string; memberIds: string[] }[];
}

async function createRaw(
  cookie: string,
  body: Record<string, unknown>,
): Promise<CreateResult> {
  const res = await request(c.t, "POST", "/api/events", cookie, {
    familyId: c.familyId,
    startAt: SOON,
    ...body,
  });
  const json = (await res.json()) as { conflicts?: CreateResult["conflicts"] };
  return { status: res.status, conflicts: json.conflicts ?? [] };
}

describe("S4.2 conflicts are reported, never blocking", () => {
  it("flags a second event over the same member", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      title: "Football practice",
      attendeeMemberIds: [c.teen.memberId],
    });
    const r = await createRaw(c.mum.cookie, {
      title: "Dentist",
      startAt: SOON + 600,
      endAt: SOON + 1800,
      attendeeMemberIds: [c.teen.memberId],
    });

    expect(r.status).toBe(201); // advisory: the booking still happens
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].title).toBe("Football practice");
    expect(r.conflicts[0].memberIds).toEqual([c.teen.memberId]);
  });

  it("reports no conflict when the two events share nobody", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      title: "Dad's work call",
      attendeeMemberIds: [c.dad.memberId],
    });
    const r = await createRaw(c.mum.cookie, {
      title: "Timmy's dentist",
      startAt: SOON + 600,
      attendeeMemberIds: [c.timmy.id],
    });
    expect(r.conflicts).toHaveLength(0);
  });

  it("reports no conflict for an event with no attendees at all", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    const r = await createRaw(c.mum.cookie, { title: "Family notice", startAt: SOON });
    expect(r.conflicts).toHaveLength(0);
  });

  it("treats back-to-back events as fine", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      title: "First",
      startAt: SOON,
      endAt: SOON + 3600,
      attendeeMemberIds: [c.teen.memberId],
    });
    const r = await createRaw(c.mum.cookie, {
      title: "Second",
      startAt: SOON + 3600,
      endAt: SOON + 7200,
      attendeeMemberIds: [c.teen.memberId],
    });
    expect(r.conflicts).toHaveLength(0);
  });

  it("names every shared member of one clashing event", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      title: "Family lunch",
      attendeeMemberIds: [c.teen.memberId, c.mum.memberId],
    });
    const r = await createRaw(c.dad.cookie, {
      title: "Overlapping",
      startAt: SOON + 600,
      attendeeMemberIds: [c.teen.memberId, c.mum.memberId],
    });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].memberIds.sort()).toEqual(
      [c.teen.memberId, c.mum.memberId].sort(),
    );
  });

  it("a cancelled event holds nobody's time", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    await request(c.t, "POST", `/api/events/${ev.id}/cancel`, c.dad.cookie);
    const r = await createRaw(c.mum.cookie, {
      title: "Replacement",
      startAt: SOON,
      attendeeMemberIds: [c.teen.memberId],
    });
    expect(r.conflicts).toHaveLength(0);
  });

  it("a trashed event holds nobody's time", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    await request(c.t, "DELETE", `/api/events/${ev.id}`, c.dad.cookie);
    const r = await createRaw(c.mum.cookie, {
      title: "Replacement",
      startAt: SOON,
      attendeeMemberIds: [c.teen.memberId],
    });
    expect(r.conflicts).toHaveLength(0);
  });

  it("a declined attendee is free again", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.teen.cookie, {
      status: "declined",
    });
    const r = await createRaw(c.mum.cookie, {
      title: "Something else",
      startAt: SOON,
      attendeeMemberIds: [c.teen.memberId],
    });
    expect(r.conflicts).toHaveLength(0);
  });

  it("an event never conflicts with itself when rescheduled", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    const res = await request(c.t, "PATCH", `/api/events/${ev.id}`, c.dad.cookie, {
      startAt: SOON + 60,
      endAt: SOON + 3660,
    });
    const body = (await res.json()) as { conflicts: unknown[] };
    expect(body.conflicts).toHaveLength(0);
  });

  it("rescheduling INTO a clash reports it", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      title: "Fixed appointment",
      startAt: SOON + 86_400,
      endAt: SOON + 86_400 + 3600,
      attendeeMemberIds: [c.teen.memberId],
    });
    const mover = await createEvent(c.t, c.dad.cookie, c.familyId, {
      title: "Movable",
      attendeeMemberIds: [c.teen.memberId],
    });
    const res = await request(c.t, "PATCH", `/api/events/${mover.id}`, c.dad.cookie, {
      startAt: SOON + 86_400 + 600,
      endAt: SOON + 86_400 + 1800,
    });
    const body = (await res.json()) as { conflicts: { title: string }[] };
    expect(body.conflicts.map((x) => x.title)).toContain("Fixed appointment");
  });

  it("does not look across family boundaries", async () => {
    await createEvent(c.t, c.stranger.cookie, c.otherFamilyId, {
      title: "Other family event",
      attendeeMemberIds: [c.stranger.memberId],
    });
    const r = await createRaw(c.dad.cookie, {
      title: "Ours",
      attendeeMemberIds: [c.teen.memberId],
    });
    expect(r.conflicts).toHaveLength(0);
  });
});

describe("S4.3 free/busy", () => {
  it("returns each member's busy blocks in the range", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      title: "Busy block",
      attendeeMemberIds: [c.teen.memberId],
    });
    const res = await request(
      c.t,
      "GET",
      `/api/events/availability?familyId=${c.familyId}&from=${SOON - 86_400}&to=${SOON + 86_400}`,
      c.dad.cookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      busy: { memberId: string; title: string }[];
      byMember: Record<string, unknown[]>;
    };
    expect(body.busy).toHaveLength(1);
    expect(body.byMember[c.teen.memberId]).toHaveLength(1);
  });

  it("omits events outside the range", async () => {
    await createEvent(c.t, c.dad.cookie, c.familyId, {
      startAt: SOON + 30 * 86_400,
      endAt: SOON + 30 * 86_400 + 3600,
      attendeeMemberIds: [c.teen.memberId],
    });
    const res = await request(
      c.t,
      "GET",
      `/api/events/availability?familyId=${c.familyId}&from=${SOON - 86_400}&to=${SOON + 86_400}`,
      c.dad.cookie,
    );
    const body = (await res.json()) as { busy: unknown[] };
    expect(body.busy).toHaveLength(0);
  });

  it("omits declined attendances — saying no frees the slot", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
    await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.teen.cookie, {
      status: "declined",
    });
    const res = await request(
      c.t,
      "GET",
      `/api/events/availability?familyId=${c.familyId}&from=${SOON - 86_400}&to=${SOON + 86_400}`,
      c.dad.cookie,
    );
    const body = (await res.json()) as { busy: unknown[] };
    expect(body.busy).toHaveLength(0);
  });

  it("requires familyId, from and to", async () => {
    expect(
      (await request(c.t, "GET", "/api/events/availability", c.dad.cookie)).status,
    ).toBe(400);
    expect(
      (
        await request(
          c.t,
          "GET",
          `/api/events/availability?familyId=${c.familyId}`,
          c.dad.cookie,
        )
      ).status,
    ).toBe(400);
  });

  it("rejects an inverted range", async () => {
    const res = await request(
      c.t,
      "GET",
      `/api/events/availability?familyId=${c.familyId}&from=${SOON}&to=${SOON - 100}`,
      c.dad.cookie,
    );
    expect(res.status).toBe(400);
  });

  it("is family-scoped: an outsider gets 404", async () => {
    const res = await request(
      c.t,
      "GET",
      `/api/events/availability?familyId=${c.familyId}&from=0&to=${SOON + 86_400}`,
      c.stranger.cookie,
    );
    expect(res.status).toBe(404);
  });

  it("requires a session", async () => {
    const res = await request(
      c.t,
      "GET",
      `/api/events/availability?familyId=${c.familyId}&from=0&to=1`,
      "",
    );
    expect(res.status).toBe(401);
  });
});
