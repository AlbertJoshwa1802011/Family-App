/**
 * S6 — Who gets reminded about an event.
 *
 * The daily cron used to remind EVERY family member about every event, so an
 * event only Timmy attends woke the whole household. Reminders are now
 * attendee-scoped, mirroring how a private document only reminds its owner.
 *
 * The deliberate exception: an event with NO attendees is a family-wide affair
 * (a public holiday, a bin collection) and still reminds everyone.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { runExpiryReminders } from "../worker/cron";
import { seedCast, request, notificationsOfType, type Cast } from "./helpers/family";

let c: Cast;
beforeEach(() => {
  c = seedCast();
});

/** One day out, inside the default [30,7,1] reminder windows. */
const TOMORROW = Math.floor(Date.now() / 1000) + 86_400;

async function makeEvent(attendeeMemberIds: string[], title = "Reminder subject") {
  const res = await request(c.t, "POST", "/api/events", c.dad.cookie, {
    familyId: c.familyId,
    title,
    startAt: TOMORROW,
    attendeeMemberIds,
  });
  expect(res.status).toBe(201);
  const { event } = (await res.json()) as { event: { id: string } };
  return event;
}

/** Reminder notifications only — invites are created by the POST itself. */
async function reminders(cookie: string) {
  return notificationsOfType(c.t, cookie, "event");
}

describe("S6.1 attendee scoping", () => {
  it("reminds only the attendees", async () => {
    await makeEvent([c.teen.memberId]);
    await runExpiryReminders(c.t.env);

    expect(await reminders(c.teen.cookie)).toHaveLength(1);
    expect(await reminders(c.mum.cookie)).toHaveLength(0);
    expect(await reminders(c.dad.cookie)).toHaveLength(0);
  });

  it("reminds the whole family when there are no attendees", async () => {
    await makeEvent([]);
    await runExpiryReminders(c.t.env);

    for (const actor of [c.dad, c.mum, c.teen]) {
      expect(await reminders(actor.cookie)).toHaveLength(1);
    }
  });

  it("reminds several attendees independently", async () => {
    await makeEvent([c.teen.memberId, c.mum.memberId]);
    await runExpiryReminders(c.t.env);

    expect(await reminders(c.teen.cookie)).toHaveLength(1);
    expect(await reminders(c.mum.cookie)).toHaveLength(1);
    expect(await reminders(c.dad.cookie)).toHaveLength(0);
  });

  it("does not remind an attendee who declined", async () => {
    const ev = await makeEvent([c.teen.memberId, c.mum.memberId]);
    await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.teen.cookie, {
      status: "declined",
    });
    await runExpiryReminders(c.t.env);

    expect(await reminders(c.teen.cookie)).toHaveLength(0);
    expect(await reminders(c.mum.cookie)).toHaveLength(1);
  });

  it("still reminds an attendee who only said 'maybe'", async () => {
    const ev = await makeEvent([c.teen.memberId]);
    await request(c.t, "POST", `/api/events/${ev.id}/rsvp`, c.teen.cookie, {
      status: "tentative",
    });
    await runExpiryReminders(c.t.env);
    expect(await reminders(c.teen.cookie)).toHaveLength(1);
  });

  it("an event only a dependent attends reminds nobody, and does not crash the run", async () => {
    await makeEvent([c.timmy.id]);
    // The run must complete rather than throw on a member with a null userId.
    await expect(runExpiryReminders(c.t.env)).resolves.not.toThrow();

    for (const actor of [c.dad, c.mum, c.teen]) {
      expect(await reminders(actor.cookie)).toHaveLength(0);
    }
  });

  it("never reminds a removed member, even if they are still an attendee row", async () => {
    await makeEvent([c.expelled.memberId, c.teen.memberId]);
    await runExpiryReminders(c.t.env);

    expect(await reminders(c.expelled.cookie)).toHaveLength(0);
    expect(await reminders(c.teen.cookie)).toHaveLength(1);
  });
});

describe("S6.2 dedupe across runs", () => {
  it("does not remind twice in the same window", async () => {
    await makeEvent([c.teen.memberId]);
    await runExpiryReminders(c.t.env);
    await runExpiryReminders(c.t.env);
    expect(await reminders(c.teen.cookie)).toHaveLength(1);
  });

  it("a newly added attendee is reminded on the next run", async () => {
    const ev = await makeEvent([c.teen.memberId]);
    await runExpiryReminders(c.t.env);
    expect(await reminders(c.mum.cookie)).toHaveLength(0);

    await request(c.t, "POST", `/api/events/${ev.id}/attendees`, c.dad.cookie, {
      memberIds: [c.mum.memberId],
    });
    await runExpiryReminders(c.t.env);
    expect(await reminders(c.mum.cookie)).toHaveLength(1);
  });

  it("cancelled events stop reminding", async () => {
    const ev = await makeEvent([c.teen.memberId]);
    await request(c.t, "POST", `/api/events/${ev.id}/cancel`, c.dad.cookie);
    await runExpiryReminders(c.t.env);
    expect(await reminders(c.teen.cookie)).toHaveLength(0);
  });

  it("trashed events stop reminding", async () => {
    const ev = await makeEvent([c.teen.memberId]);
    await request(c.t, "DELETE", `/api/events/${ev.id}`, c.dad.cookie);
    await runExpiryReminders(c.t.env);
    expect(await reminders(c.teen.cookie)).toHaveLength(0);
  });

  it("does not leak reminders across families", async () => {
    await makeEvent([c.teen.memberId]);
    await runExpiryReminders(c.t.env);
    expect(await reminders(c.stranger.cookie)).toHaveLength(0);
  });
});
