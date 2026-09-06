/**
 * S3 — Who may do what to a shared family calendar.
 *
 * Previously every event handler used requireFamilyMember's default minRole of
 * "member" and never looked at createdBy, so any member could delete anyone
 * else's event: a teenager could remove a parent's hospital appointment and
 * only the audit log would know.
 *
 * The rule now: CREATING is open to every active member — anyone may put
 * something on the family calendar. CHANGING what someone else scheduled needs
 * to be the creator, or an admin/owner. Answering an invitation is always the
 * attendee's own right and is covered in rsvp.test.ts.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { seedCast, request, createEvent, SOON, type Cast } from "./helpers/family";

let c: Cast;
beforeEach(() => {
  c = seedCast();
});

/** An event created by the TEEN, so "creator" and "plain member" differ. */
async function teensEvent() {
  return createEvent(c.t, c.teen.cookie, c.familyId, { title: "Teen's band practice" });
}

describe("S3.1 creating is open to every active member", () => {
  it("a plain member may create an event", async () => {
    const res = await request(c.t, "POST", "/api/events", c.teen.cookie, {
      familyId: c.familyId,
      title: "Study group",
      startAt: SOON,
    });
    expect(res.status).toBe(201);
  });

  it("an invited-but-inactive member may not", async () => {
    const res = await request(c.t, "POST", "/api/events", c.gran.cookie, {
      familyId: c.familyId,
      title: "Nope",
      startAt: SOON,
    });
    expect(res.status).toBe(404);
  });

  it("a removed member may not", async () => {
    const res = await request(c.t, "POST", "/api/events", c.expelled.cookie, {
      familyId: c.familyId,
      title: "Nope",
      startAt: SOON,
    });
    expect(res.status).toBe(404);
  });

  it("another family's member may not", async () => {
    const res = await request(c.t, "POST", "/api/events", c.stranger.cookie, {
      familyId: c.familyId,
      title: "Nope",
      startAt: SOON,
    });
    expect(res.status).toBe(404);
  });
});

describe("S3.2 the creator keeps control of their own event", () => {
  it("may reschedule it", async () => {
    const ev = await teensEvent();
    const res = await request(c.t, "PATCH", `/api/events/${ev.id}`, c.teen.cookie, {
      startAt: SOON + 3600,
      endAt: SOON + 7200,
    });
    expect(res.status).toBe(200);
  });

  it("may cancel it", async () => {
    const ev = await teensEvent();
    expect(
      (await request(c.t, "POST", `/api/events/${ev.id}/cancel`, c.teen.cookie)).status,
    ).toBe(200);
  });

  it("may delete it", async () => {
    const ev = await teensEvent();
    expect(
      (await request(c.t, "DELETE", `/api/events/${ev.id}`, c.teen.cookie)).status,
    ).toBe(200);
  });

  it("may manage its guest list", async () => {
    const ev = await teensEvent();
    expect(
      (
        await request(c.t, "POST", `/api/events/${ev.id}/attendees`, c.teen.cookie, {
          memberIds: [c.mum.memberId],
        })
      ).status,
    ).toBe(200);
  });
});

describe("S3.3 a plain member may NOT touch someone else's event", () => {
  /** Dad's event; teen is a plain member and not the creator. */
  async function dadsEvent() {
    return createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.teen.memberId],
    });
  }

  it("cannot reschedule it", async () => {
    const ev = await dadsEvent();
    const res = await request(c.t, "PATCH", `/api/events/${ev.id}`, c.teen.cookie, {
      startAt: SOON + 99_999,
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden" });
  });

  it("cannot cancel it", async () => {
    const ev = await dadsEvent();
    expect(
      (await request(c.t, "POST", `/api/events/${ev.id}/cancel`, c.teen.cookie)).status,
    ).toBe(403);
  });

  it("cannot delete it", async () => {
    const ev = await dadsEvent();
    expect(
      (await request(c.t, "DELETE", `/api/events/${ev.id}`, c.teen.cookie)).status,
    ).toBe(403);
  });

  it("cannot add attendees to it", async () => {
    const ev = await dadsEvent();
    const res = await request(c.t, "POST", `/api/events/${ev.id}/attendees`, c.teen.cookie, {
      memberIds: [c.mum.memberId],
    });
    expect(res.status).toBe(403);
  });

  it("cannot remove an attendee from it", async () => {
    const ev = await dadsEvent();
    const res = await request(
      c.t,
      "DELETE",
      `/api/events/${ev.id}/attendees/${c.teen.memberId}`,
      c.teen.cookie,
    );
    expect(res.status).toBe(403);
  });

  it("a rejected mutation changes nothing", async () => {
    const ev = await dadsEvent();
    await request(c.t, "PATCH", `/api/events/${ev.id}`, c.teen.cookie, {
      title: "hijacked",
      startAt: SOON + 99_999,
    });
    const det = await request(c.t, "GET", `/api/events/${ev.id}`, c.dad.cookie);
    const { event } = (await det.json()) as { event: { title: string; startAt: number } };
    expect(event.title).toBe("Dentist");
    expect(event.startAt).toBe(SOON);
  });

  it("but CAN still read it — the calendar is shared", async () => {
    const ev = await dadsEvent();
    expect(
      (await request(c.t, "GET", `/api/events/${ev.id}`, c.teen.cookie)).status,
    ).toBe(200);
  });
});

describe("S3.4 admins and owners moderate the whole calendar", () => {
  it("an admin may reschedule a member's event", async () => {
    const ev = await teensEvent();
    const res = await request(c.t, "PATCH", `/api/events/${ev.id}`, c.mum.cookie, {
      startAt: SOON + 3600,
      endAt: SOON + 7200,
    });
    expect(res.status).toBe(200);
  });

  it("an owner may delete a member's event", async () => {
    const ev = await teensEvent();
    expect(
      (await request(c.t, "DELETE", `/api/events/${ev.id}`, c.dad.cookie)).status,
    ).toBe(200);
  });

  it("an owner may cancel a member's event", async () => {
    const ev = await teensEvent();
    expect(
      (await request(c.t, "POST", `/api/events/${ev.id}/cancel`, c.dad.cookie)).status,
    ).toBe(200);
  });
});

describe("S3.5 outsiders and inactive members see nothing", () => {
  const cases = [
    { name: "invited (not yet active)", who: () => c.gran },
    { name: "removed", who: () => c.expelled },
    { name: "another family", who: () => c.stranger },
  ];

  for (const { name, who } of cases) {
    it(`${name}: every event route returns 404`, async () => {
      const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
      const cookie = who().cookie;

      expect((await request(c.t, "GET", `/api/events/${ev.id}`, cookie)).status).toBe(404);
      expect(
        (await request(c.t, "PATCH", `/api/events/${ev.id}`, cookie, { title: "x" })).status,
      ).toBe(404);
      expect((await request(c.t, "DELETE", `/api/events/${ev.id}`, cookie)).status).toBe(404);
      expect(
        (await request(c.t, "POST", `/api/events/${ev.id}/cancel`, cookie)).status,
      ).toBe(404);
      expect(
        (
          await request(c.t, "GET", `/api/events?familyId=${c.familyId}`, cookie)
        ).status,
      ).toBe(404);
    });
  }
});

describe("S3.6 the client is told what it may do", () => {
  it("canEdit is true for the creator", async () => {
    const ev = await teensEvent();
    const res = await request(c.t, "GET", `/api/events/${ev.id}`, c.teen.cookie);
    expect(await res.json()).toMatchObject({ canEdit: true });
  });

  it("canEdit is true for an admin who did not create it", async () => {
    const ev = await teensEvent();
    const res = await request(c.t, "GET", `/api/events/${ev.id}`, c.mum.cookie);
    expect(await res.json()).toMatchObject({ canEdit: true });
  });

  it("canEdit is false for a plain member who did not create it", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
    const res = await request(c.t, "GET", `/api/events/${ev.id}`, c.teen.cookie);
    expect(await res.json()).toMatchObject({ canEdit: false });
  });
});
