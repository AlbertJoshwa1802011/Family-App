/**
 * Workspace-intelligence tranche: linked docs on events, travel buffer,
 * meeting notes, action-items→tasks, follow-ups, tags, resource links,
 * related-document ranking. Additive — existing event/task/note contracts stay.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createEvent,
  request,
  seedCast,
  SOON,
  type Cast,
} from "./helpers/family";
import { seedDocument } from "./helpers/testEnv";
import { executeAssistantTool } from "../worker/lib/assistantTools";
import { getDb } from "../worker/db/client";

describe("workspace intelligence (additive)", () => {
  let c: Cast;

  beforeEach(() => {
    c = seedCast();
  });

  it("creates an event with travelBufferMins + documentIds and returns them on GET", async () => {
    const doc = seedDocument(c.t.sqlite, {
      familyId: c.familyId,
      ownerUserId: c.dad.userId,
      title: "Insurance card",
    });

    const create = await request(c.t, "POST", "/api/events", c.dad.cookie, {
      familyId: c.familyId,
      title: "Hospital visit",
      startAt: SOON,
      endAt: SOON + 3600,
      type: "appointment",
      travelBufferMins: 45,
      documentIds: [doc.id],
      attendeeMemberIds: [c.mum.memberId],
    });
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created.event.travelBufferMins).toBe(45);
    expect(Array.isArray(created.conflicts)).toBe(true);

    const get = await request(
      c.t,
      "GET",
      `/api/events/${created.event.id}`,
      c.dad.cookie,
    );
    expect(get.status).toBe(200);
    const body = await get.json();
    expect(body.documents).toEqual([
      expect.objectContaining({ id: doc.id, title: "Insurance card" }),
    ]);
    expect(body.event.travelBufferMins).toBe(45);
  });

  it("PATCH replaces documentIds and clears travelBufferMins with null", async () => {
    const a = seedDocument(c.t.sqlite, {
      familyId: c.familyId,
      ownerUserId: c.dad.userId,
      title: "Doc A",
    });
    const b = seedDocument(c.t.sqlite, {
      familyId: c.familyId,
      ownerUserId: c.dad.userId,
      title: "Doc B",
    });
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      documentIds: [a.id],
      travelBufferMins: 20,
    });

    const patch = await request(
      c.t,
      "PATCH",
      `/api/events/${ev.id}`,
      c.dad.cookie,
      { documentIds: [b.id], travelBufferMins: null },
    );
    expect(patch.status).toBe(200);

    const get = await request(
      c.t,
      "GET",
      `/api/events/${ev.id}`,
      c.dad.cookie,
    );
    const body = await get.json();
    expect(body.documents.map((d: { id: string }) => d.id)).toEqual([b.id]);
    expect(body.event.travelBufferMins).toBeNull();
  });

  it("rejects cross-family documentIds on create", async () => {
    const outsiderDoc = seedDocument(c.t.sqlite, {
      familyId: c.otherFamilyId,
      ownerUserId: c.stranger.userId,
    });
    const res = await request(c.t, "POST", "/api/events", c.dad.cookie, {
      familyId: c.familyId,
      title: "Bad link",
      startAt: SOON,
      documentIds: [outsiderDoc.id],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_document_ids" });
  });

  it("creates meeting notes linked to an event and filters by eventId", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
    const create = await request(c.t, "POST", "/api/notes", c.dad.cookie, {
      familyId: c.familyId,
      kind: "meeting",
      eventId: ev.id,
      title: "Visit notes",
      body: "Bring reports",
      visibility: "family",
    });
    expect(create.status).toBe(201);
    const note = (await create.json()).note;
    expect(note.kind).toBe("meeting");
    expect(note.eventId).toBe(ev.id);

    const list = await request(
      c.t,
      "GET",
      `/api/notes?familyId=${c.familyId}&eventId=${ev.id}`,
      c.dad.cookie,
    );
    expect(list.status).toBe(200);
    const notes = (await list.json()).notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(note.id);
  });

  it("POST action-items creates tasks with relatedEventId", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
    const res = await request(
      c.t,
      "POST",
      `/api/events/${ev.id}/action-items`,
      c.dad.cookie,
      { titles: ["Book labs", "Share report"] },
    );
    expect(res.status).toBe(201);
    const { tasks } = await res.json();
    expect(tasks).toHaveLength(2);

    const list = await request(
      c.t,
      "GET",
      `/api/tasks?familyId=${c.familyId}`,
      c.dad.cookie,
    );
    const all = (await list.json()).tasks;
    const linked = all.filter(
      (t: { relatedEventId: string | null }) => t.relatedEventId === ev.id,
    );
    expect(linked).toHaveLength(2);
  });

  it("POST follow-up notifies attendees but not the actor", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId, {
      attendeeMemberIds: [c.mum.memberId, c.teen.memberId],
    });
    const res = await request(
      c.t,
      "POST",
      `/api/events/${ev.id}/follow-up`,
      c.dad.cookie,
      { message: "Please confirm next steps" },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notified).toBe(2);

    const mumInbox = await request(
      c.t,
      "GET",
      "/api/notifications",
      c.mum.cookie,
    );
    const mumNotes = (await mumInbox.json()).notifications;
    expect(
      mumNotes.some(
        (n: { type: string }) => n.type === "meeting_followup",
      ),
    ).toBe(true);

    const dadInbox = await request(
      c.t,
      "GET",
      "/api/notifications",
      c.dad.cookie,
    );
    const dadNotes = (await dadInbox.json()).notifications;
    expect(
      dadNotes.some(
        (n: { type: string }) => n.type === "meeting_followup",
      ),
    ).toBe(false);
  });

  it("tags CRUD + related documents ranking uses shared category/tags", async () => {
    const passport = seedDocument(c.t.sqlite, {
      familyId: c.familyId,
      ownerUserId: c.dad.userId,
      title: "Dad passport",
    });
    // seedDocument hardcodes category 'other' — set both to travel via SQL
    c.t.sqlite
      .prepare(`UPDATE documents SET category = 'travel' WHERE id = ?`)
      .run(passport.id);
    const visa = seedDocument(c.t.sqlite, {
      familyId: c.familyId,
      ownerUserId: c.dad.userId,
      title: "Schengen visa",
    });
    c.t.sqlite
      .prepare(`UPDATE documents SET category = 'travel' WHERE id = ?`)
      .run(visa.id);

    const tagRes = await request(c.t, "POST", "/api/tags", c.dad.cookie, {
      familyId: c.familyId,
      name: "Europe trip",
    });
    expect(tagRes.status).toBe(201);
    const tagId = (await tagRes.json()).tag.id;

    for (const docId of [passport.id, visa.id]) {
      const put = await request(
        c.t,
        "PUT",
        `/api/tags/documents/${docId}`,
        c.dad.cookie,
        { tagIds: [tagId] },
      );
      expect(put.status).toBe(200);
    }

    const related = await request(
      c.t,
      "GET",
      `/api/documents/${passport.id}/related`,
      c.dad.cookie,
    );
    expect(related.status).toBe(200);
    const hits = (await related.json()).related;
    expect(hits.some((h: { id: string }) => h.id === visa.id)).toBe(true);
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it("resource links: youtube on event + reject bad host", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
    const ok = await request(c.t, "POST", "/api/links", c.dad.cookie, {
      familyId: c.familyId,
      kind: "youtube",
      targetType: "event",
      targetId: ev.id,
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Prep video",
    });
    expect(ok.status).toBe(201);

    const bad = await request(c.t, "POST", "/api/links", c.dad.cookie, {
      familyId: c.familyId,
      kind: "youtube",
      targetType: "event",
      targetId: ev.id,
      url: "https://example.com/not-youtube",
    });
    expect(bad.status).toBe(400);

    const list = await request(
      c.t,
      "GET",
      `/api/links?familyId=${c.familyId}&targetType=event&targetId=${ev.id}`,
      c.dad.cookie,
    );
    expect((await list.json()).links).toHaveLength(1);
  });

  it("assistant create_tasks_from_event links tasks to the event", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
    const db = getDb(c.t.env);
    const result = await executeAssistantTool(
      "create_tasks_from_event",
      {
        eventId: ev.id,
        titles: ["Call clinic", "Pack documents"],
      },
      {
        db,
        familyId: c.familyId,
        userId: c.dad.userId,
        role: "owner",
        nowMs: Date.now(),
      },
    );
    expect(result.ok).toBe(true);
    expect((result.data as { tasks: unknown[] }).tasks).toHaveLength(2);
  });

  it("GET event detail still returns canEdit + attendees for strangers as 404", async () => {
    const ev = await createEvent(c.t, c.dad.cookie, c.familyId);
    const denied = await request(
      c.t,
      "GET",
      `/api/events/${ev.id}`,
      c.stranger.cookie,
    );
    expect(denied.status).toBe(404);
  });
});
