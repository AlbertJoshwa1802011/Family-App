import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { insertAuditEvent } from "../lib/audit";
import { allDocumentsInFamily, allMembersInFamily } from "../lib/familyScope";
import { buildCalendar } from "../lib/ics";
import { findConflicts, busyBlocks } from "../lib/conflicts";
import {
  attendeeMemberIds,
  notifyEventCancelled,
  notifyEventInvited,
  notifyEventRescheduled,
  notifyEventUninvited,
  notifyRsvpAnswered,
  type EventSummary,
} from "../lib/scheduleNotify";

export const eventRoutes = new Hono<HonoEnv>();

// ── Validation schemas ────────────────────────────────────────────────────────

const EventType = z.enum(["gathering", "appointment", "milestone", "other"]);

/**
 * Field definitions WITHOUT defaults.
 *
 * Defaults and .partial() must never meet: `.default([])` still fires when the
 * key is absent, so `eventBaseSchema.partial()` handed the update handler
 * `attendeeMemberIds: []`, `type: "other"` and `allDay: false` on EVERY patch.
 * Because the handler treats a present attendee array as a full replace, a
 * rename silently deleted the whole guest list and reset the event's type.
 * Defaults therefore live on the CREATE schema only.
 */
const eventFieldsSchema = z.object({
  familyId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  startAt: z.number().int().positive(),
  endAt: z.number().int().positive().optional(),
  allDay: z.boolean().optional(),
  location: z.string().max(500).optional(),
  type: EventType.optional(),
  attendeeMemberIds: z.array(z.string()).optional(),
  documentIds: z.array(z.string()).optional(),
});

const eventBaseSchema = eventFieldsSchema.extend({
  allDay: z.boolean().optional().default(false),
  type: EventType.optional().default("other"),
  attendeeMemberIds: z.array(z.string()).optional().default([]),
  documentIds: z.array(z.string()).optional().default([]),
});

/**
 * Optimistic-concurrency guard. When the client sends the `version` it last
 * read, a mutation racing another member's edit gets 409 instead of silently
 * clobbering it. Omitted = last-write-wins (kept for backwards compatibility).
 */
const concurrencySchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
});

const createEventSchema = eventBaseSchema.refine(
  (d) => !d.endAt || d.endAt >= d.startAt,
  { message: "endAt must be >= startAt", path: ["endAt"] },
);

// partial() must be called on ZodObject before refine() — and on the
// default-free field set, so an omitted key stays omitted.
const updateEventSchema = eventFieldsSchema.partial().merge(concurrencySchema).refine(
  (d) => !d.endAt || !d.startAt || d.endAt >= d.startAt,
  { message: "endAt must be >= startAt", path: ["endAt"] },
);

const addAttendeesSchema = z.object({
  memberIds: z.array(z.string()).min(1),
});

const RsvpStatus = z.enum(["invited", "accepted", "declined", "tentative"]);

const rsvpSchema = z.object({
  status: RsvpStatus,
  // Guardians answer for dependents, who have no account of their own.
  // Omitted = "me".
  memberId: z.string().optional(),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

// ── Authorization ─────────────────────────────────────────────────────────────

/**
 * Who may change an event once it exists.
 *
 * Creating is open to every active member — anyone can put something on the
 * family calendar. Changing or removing what SOMEONE ELSE scheduled is not:
 * a teenager must not be able to delete a parent's hospital appointment.
 * So mutations require the event's creator, or an admin/owner.
 *
 * RSVP is deliberately NOT gated by this — answering an invitation is always
 * the attendee's own right (see the /rsvp handler).
 */
function canMutateEvent(
  membership: { userId: string | null; role: string },
  event: { createdBy: string },
): boolean {
  return (
    membership.userId === event.createdBy ||
    membership.role === "admin" ||
    membership.role === "owner"
  );
}

const FORBIDDEN_EVENT = {
  error: "forbidden",
  reason: "only the event creator or a family admin can change this event",
} as const;

/** Display name for notification copy ("Dad added you to ..."). */
async function actorName(db: ReturnType<typeof getDb>, userId: string): Promise<string> {
  const row = await db
    .select({ name: schema.users.name, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  return row?.name ?? row?.email ?? "A family member";
}

function summarize(e: {
  id: string;
  familyId: string;
  title: string;
  startAt: number;
  allDay: boolean | null;
  location: string | null;
}): EventSummary {
  return {
    id: e.id,
    familyId: e.familyId,
    title: e.title,
    startAt: e.startAt,
    allDay: Boolean(e.allDay),
    location: e.location,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /events?familyId=:id&from=:unix&to=:unix
eventRoutes.get("/", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");

  const conditions = [
    eq(schema.events.familyId, familyId),
    ne(schema.events.status, "trashed"),
  ];
  // Ignore non-numeric range params instead of pushing NaN into SQL.
  const from = fromParam ? parseInt(fromParam, 10) : NaN;
  const to = toParam ? parseInt(toParam, 10) : NaN;
  if (Number.isFinite(from)) conditions.push(gte(schema.events.startAt, from));
  if (Number.isFinite(to)) conditions.push(lte(schema.events.startAt, to));

  // ?member=<memberId> → "what is on THIS person's calendar". Mirrors the
  // documents route's subject-member filter.
  const memberFilter = c.req.query("member");
  if (memberFilter) {
    const attending = await db
      .select({ eventId: schema.eventAttendees.eventId })
      .from(schema.eventAttendees)
      .where(eq(schema.eventAttendees.memberId, memberFilter));
    const ids = attending.map((a) => a.eventId);
    if (ids.length === 0) return c.json({ events: [] });
    conditions.push(inArray(schema.events.id, ids));
  }

  const events = await db
    .select()
    .from(schema.events)
    .where(and(...(conditions as [typeof conditions[0], ...typeof conditions])))
    .orderBy(asc(schema.events.startAt));

  return c.json({ events });
});

// POST /events — create event with optional attendees and linked documents.
eventRoutes.post("/", requireSession, zv(createEventSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);

  // Client-supplied IDs must belong to this family (no cross-family references).
  if (!(await allMembersInFamily(db, data.familyId, data.attendeeMemberIds))) {
    return c.json({ error: "invalid_member_ids" }, 400);
  }
  if (!(await allDocumentsInFamily(db, data.familyId, data.documentIds))) {
    return c.json({ error: "invalid_document_ids" }, 400);
  }

  const eventId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(schema.events).values({
    id: eventId,
    familyId: data.familyId,
    title: data.title,
    description: data.description,
    startAt: data.startAt,
    endAt: data.endAt,
    allDay: data.allDay,
    location: data.location,
    type: data.type,
    status: "active",
    createdBy: userId,
    updatedAt: now,
  });

  // Add attendees. Dependents (no account) cannot answer for themselves, so
  // their guardian's act of scheduling counts as acceptance.
  const uniqueAttendees = [...new Set(data.attendeeMemberIds)];
  if (uniqueAttendees.length > 0) {
    const dependents = new Set(
      (
        await db
          .select({ id: schema.familyMembers.id })
          .from(schema.familyMembers)
          .where(
            and(
              inArray(schema.familyMembers.id, uniqueAttendees),
              eq(schema.familyMembers.memberType, "dependent"),
            ),
          )
      ).map((r) => r.id),
    );
    await db.insert(schema.eventAttendees).values(
      uniqueAttendees.map((memberId) => ({
        eventId,
        memberId,
        rsvp: dependents.has(memberId) ? ("accepted" as const) : ("invited" as const),
        rsvpAt: dependents.has(memberId) ? now : null,
      })),
    );
  }

  // Link documents
  if (data.documentIds.length > 0) {
    await db.insert(schema.eventDocuments).values(
      data.documentIds.map((documentId) => ({ eventId, documentId })),
    );
  }

  await insertAuditEvent(db, {
    familyId: data.familyId,
    actorUserId: userId,
    action: "event_created",
    targetType: "event",
    targetId: eventId,
    meta: { title: data.title },
  });

  const event = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .get();

  // Tell the people this was scheduled FOR. The UI has always promised this.
  if (uniqueAttendees.length > 0) {
    await notifyEventInvited(
      db,
      c.env,
      summarize(event!),
      uniqueAttendees,
      { userId, name: await actorName(db, userId) },
    );
  }

  // Advisory double-booking check — reported, never blocking.
  const conflicts = await findConflicts(
    db,
    data.familyId,
    { startAt: data.startAt, endAt: data.endAt, allDay: data.allDay },
    uniqueAttendees,
    eventId,
  );

  return c.json({ event, conflicts }, 201);
});

// GET /events/availability?familyId=&from=&to= — free/busy per member.
// "When is everyone free?" Registered BEFORE /:id so the param route does not
// swallow the literal path.
eventRoutes.get("/availability", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const from = parseInt(c.req.query("from") ?? "", 10);
  const to = parseInt(c.req.query("to") ?? "", 10);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return c.json({ error: "from and to query params required" }, 400);
  }
  if (to < from) return c.json({ error: "to must be >= from" }, 400);

  const db = getDb(c.env);
  const busy = await busyBlocks(db, familyId, from, to);

  // Group by member so the client can render one lane per person.
  const byMember: Record<string, typeof busy> = {};
  for (const b of busy) (byMember[b.memberId] ??= []).push(b);

  return c.json({ from, to, busy, byMember });
});

// GET /events/:id — get event with attendees.
eventRoutes.get("/:id", requireSession, async (c) => {
  const { id: eventId } = c.req.param();
  const db = getDb(c.env);

  const event = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.id, eventId), ne(schema.events.status, "trashed")))
    .get();

  if (!event) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, event.familyId);
  if (membership instanceof Response) return membership;

  const attendees = await db
    .select({
      memberId: schema.eventAttendees.memberId,
      rsvp: schema.eventAttendees.rsvp,
      rsvpAt: schema.eventAttendees.rsvpAt,
      memberType: schema.familyMembers.memberType,
      displayName: schema.familyMembers.displayName,
      role: schema.familyMembers.role,
      name: schema.users.name,
      email: schema.users.email,
      picture: schema.users.picture,
    })
    .from(schema.eventAttendees)
    .innerJoin(schema.familyMembers, eq(schema.eventAttendees.memberId, schema.familyMembers.id))
    .leftJoin(schema.users, eq(schema.familyMembers.userId, schema.users.id))
    .where(eq(schema.eventAttendees.eventId, eventId));

  // Headline counts so the UI can show "3 going · 1 declined" without a second pass.
  const rsvpSummary = attendees.reduce<Record<string, number>>(
    (acc, a) => {
      acc[a.rsvp] = (acc[a.rsvp] ?? 0) + 1;
      return acc;
    },
    { invited: 0, accepted: 0, declined: 0, tentative: 0 },
  );

  // Can the caller act on this event, or only view and RSVP? Lets the client
  // hide controls that the server would reject anyway.
  const canEdit = canMutateEvent(membership, event);

  return c.json({ event, attendees, rsvpSummary, canEdit });
});

// GET /events/:id/ics — download a single event as an .ics file
// ("Add to calendar" in Google/Apple/Outlook). Session + membership gated.
eventRoutes.get("/:id/ics", requireSession, async (c) => {
  const { id: eventId } = c.req.param();
  const db = getDb(c.env);

  const event = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.id, eventId), ne(schema.events.status, "trashed")))
    .get();

  if (!event) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, event.familyId);
  if (membership instanceof Response) return membership;

  const body = buildCalendar({
    name: "Family Vault",
    events: [
      {
        uid: `event-${event.id}@family-vault`,
        title: event.title,
        description: event.description,
        location: event.location,
        startAt: event.startAt,
        endAt: event.endAt,
        allDay: Boolean(event.allDay),
        cancelled: event.status === "cancelled",
      },
    ],
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="event-${event.id}.ics"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});

// PATCH /events/:id — update event fields.
eventRoutes.patch("/:id", requireSession, zv(updateEventSchema), async (c) => {
  const { id: eventId } = c.req.param();
  const userId = c.get("userId")!;
  const updates = c.req.valid("json");
  const db = getDb(c.env);

  const event = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.id, eventId), ne(schema.events.status, "trashed")))
    .get();

  if (!event) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, event.familyId);
  if (membership instanceof Response) return membership;

  if (!canMutateEvent(membership, event)) return c.json(FORBIDDEN_EVENT, 403);

  // Optimistic concurrency: reject a write based on a stale read instead of
  // silently overwriting whatever the other member just saved.
  if (
    updates.expectedVersion !== undefined &&
    updates.expectedVersion !== event.version
  ) {
    return c.json(
      { error: "conflict", reason: "event_modified", currentVersion: event.version },
      409,
    );
  }

  // The Zod refine only compares the two fields when BOTH are in the payload.
  // Moving startAt alone could therefore leave the stored endAt before it, so
  // validate the MERGED state, not just the patch.
  const nextStartAt = updates.startAt ?? event.startAt;
  const nextEndAt = updates.endAt !== undefined ? updates.endAt : event.endAt;
  if (nextEndAt != null && nextEndAt < nextStartAt) {
    return c.json(
      {
        error: "validation_error",
        issues: [
          {
            code: "custom",
            path: ["endAt"],
            message: "endAt must be >= startAt",
          },
        ],
      },
      400,
    );
  }

  const set: Partial<typeof schema.events.$inferInsert> = {
    updatedAt: Math.floor(Date.now() / 1000),
    version: event.version + 1,
  };
  if (updates.title !== undefined) set.title = updates.title;
  if (updates.description !== undefined) set.description = updates.description;
  if (updates.startAt !== undefined) set.startAt = updates.startAt;
  if (updates.endAt !== undefined) set.endAt = updates.endAt;
  if (updates.allDay !== undefined) set.allDay = updates.allDay;
  if (updates.location !== undefined) set.location = updates.location;
  if (updates.type !== undefined) set.type = updates.type;

  await db.update(schema.events).set(set).where(eq(schema.events.id, eventId));

  // Attendee list is a REPLACE, so work out who joined and who was dropped
  // before touching the rows — each group gets a different message, and people
  // who were already on the list must not be re-notified.
  const previousAttendees = await attendeeMemberIds(db, eventId);
  let added: string[] = [];
  let removed: string[] = [];

  if (updates.attendeeMemberIds !== undefined) {
    if (!(await allMembersInFamily(db, event.familyId, updates.attendeeMemberIds))) {
      return c.json({ error: "invalid_member_ids" }, 400);
    }
    const next = [...new Set(updates.attendeeMemberIds)];
    const before = new Set(previousAttendees);
    added = next.filter((m) => !before.has(m));
    removed = previousAttendees.filter((m) => !next.includes(m));

    // Preserve existing answers: only genuinely new attendees start as 'invited'.
    const kept = await db
      .select({
        memberId: schema.eventAttendees.memberId,
        rsvp: schema.eventAttendees.rsvp,
        rsvpAt: schema.eventAttendees.rsvpAt,
      })
      .from(schema.eventAttendees)
      .where(eq(schema.eventAttendees.eventId, eventId));
    const keptById = new Map(kept.map((k) => [k.memberId, k]));

    await db.delete(schema.eventAttendees).where(eq(schema.eventAttendees.eventId, eventId));
    if (next.length > 0) {
      await db.insert(schema.eventAttendees).values(
        next.map((memberId) => {
          const prior = keptById.get(memberId);
          return {
            eventId,
            memberId,
            rsvp: prior?.rsvp ?? ("invited" as const),
            rsvpAt: prior?.rsvpAt ?? null,
          };
        }),
      );
    }
  }

  const updatedEvent = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .get();

  await insertAuditEvent(db, {
    familyId: event.familyId,
    actorUserId: userId,
    action: "event_updated",
    targetType: "event",
    targetId: eventId,
  });

  const actor = { userId, name: await actorName(db, userId) };
  const summary = summarize(updatedEvent!);

  // A moved event is the change people most need to hear about. Everyone still
  // attending is told, plus the creator if someone else moved their event.
  const timeChanged =
    updates.startAt !== undefined && updates.startAt !== event.startAt;
  if (timeChanged) {
    const current = await attendeeMemberIds(db, eventId);
    const audience = new Set(current);
    const creatorMember = await db
      .select({ id: schema.familyMembers.id })
      .from(schema.familyMembers)
      .where(
        and(
          eq(schema.familyMembers.familyId, event.familyId),
          eq(schema.familyMembers.userId, event.createdBy),
        ),
      )
      .get();
    if (creatorMember) audience.add(creatorMember.id);
    await notifyEventRescheduled(db, c.env, summary, [...audience], actor, event.startAt);
  }

  if (added.length > 0) {
    await notifyEventInvited(db, c.env, summary, added, actor);
  }
  if (removed.length > 0) {
    await notifyEventUninvited(db, c.env, summary, removed, actor);
  }

  const conflicts = await findConflicts(
    db,
    event.familyId,
    { startAt: summary.startAt, endAt: updatedEvent!.endAt, allDay: updatedEvent!.allDay },
    await attendeeMemberIds(db, eventId),
    eventId,
  );

  return c.json({ event: updatedEvent, conflicts });
});

// DELETE /events/:id — soft delete (status=trashed).
eventRoutes.delete("/:id", requireSession, async (c) => {
  const { id: eventId } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const event = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.id, eventId), ne(schema.events.status, "trashed")))
    .get();

  if (!event) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, event.familyId);
  if (membership instanceof Response) return membership;

  if (!canMutateEvent(membership, event)) return c.json(FORBIDDEN_EVENT, 403);

  // Capture the audience before the row is trashed, then tell them it is off.
  const attendees = await attendeeMemberIds(db, eventId);

  await db
    .update(schema.events)
    .set({ status: "trashed", trashedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.events.id, eventId));

  if (attendees.length > 0) {
    await notifyEventCancelled(db, c.env, summarize(event), attendees, {
      userId,
      name: await actorName(db, userId),
    });
  }

  await insertAuditEvent(db, {
    familyId: event.familyId,
    actorUserId: userId,
    action: "event_deleted",
    targetType: "event",
    targetId: eventId,
  });

  return c.json({ ok: true });
});

// POST /events/:id/cancel — cancel without deleting (stays visible with strikethrough).
// MUST be before /:id/attendees to avoid route conflict.
eventRoutes.post("/:id/cancel", requireSession, async (c) => {
  const { id: eventId } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const event = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.id, eventId), eq(schema.events.status, "active")))
    .get();

  if (!event) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, event.familyId);
  if (membership instanceof Response) return membership;

  if (!canMutateEvent(membership, event)) return c.json(FORBIDDEN_EVENT, 403);

  const attendees = await attendeeMemberIds(db, eventId);

  await db
    .update(schema.events)
    .set({ status: "cancelled", updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.events.id, eventId));

  if (attendees.length > 0) {
    await notifyEventCancelled(db, c.env, summarize(event), attendees, {
      userId,
      name: await actorName(db, userId),
    });
  }

  await insertAuditEvent(db, {
    familyId: event.familyId,
    actorUserId: userId,
    action: "event_cancelled",
    targetType: "event",
    targetId: eventId,
  });

  return c.json({ ok: true });
});

// POST /events/:id/attendees — add members as attendees.
eventRoutes.post("/:id/attendees", requireSession, zv(addAttendeesSchema), async (c) => {
  const { id: eventId } = c.req.param();
  const userId = c.get("userId")!;
  const { memberIds } = c.req.valid("json");
  const db = getDb(c.env);

  const event = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.id, eventId), ne(schema.events.status, "trashed")))
    .get();

  if (!event) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, event.familyId);
  if (membership instanceof Response) return membership;

  if (!canMutateEvent(membership, event)) return c.json(FORBIDDEN_EVENT, 403);

  if (!(await allMembersInFamily(db, event.familyId, memberIds))) {
    return c.json({ error: "invalid_member_ids" }, 400);
  }

  // Only genuinely new attendees are inserted and notified — re-adding someone
  // must not spam them a second time.
  const already = new Set(await attendeeMemberIds(db, eventId));
  const fresh = [...new Set(memberIds)].filter((m) => !already.has(m));

  const dependents = new Set(
    fresh.length === 0
      ? []
      : (
          await db
            .select({ id: schema.familyMembers.id })
            .from(schema.familyMembers)
            .where(
              and(
                inArray(schema.familyMembers.id, fresh),
                eq(schema.familyMembers.memberType, "dependent"),
              ),
            )
        ).map((r) => r.id),
  );

  const nowSecs = Math.floor(Date.now() / 1000);
  for (const memberId of fresh) {
    try {
      await db.insert(schema.eventAttendees).values({
        eventId,
        memberId,
        rsvp: dependents.has(memberId) ? "accepted" : "invited",
        rsvpAt: dependents.has(memberId) ? nowSecs : null,
      });
    } catch {
      // Ignore duplicate key constraint violations (racing add).
    }
  }

  if (fresh.length > 0) {
    await notifyEventInvited(db, c.env, summarize(event), fresh, {
      userId,
      name: await actorName(db, userId),
    });
  }

  return c.json({ ok: true, added: fresh.length });
});

// DELETE /events/:id/attendees/:memberId — remove an attendee.
eventRoutes.delete("/:id/attendees/:memberId", requireSession, async (c) => {
  const { id: eventId, memberId } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const event = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.id, eventId), ne(schema.events.status, "trashed")))
    .get();

  if (!event) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, event.familyId);
  if (membership instanceof Response) return membership;

  if (!canMutateEvent(membership, event)) return c.json(FORBIDDEN_EVENT, 403);

  await db
    .delete(schema.eventAttendees)
    .where(
      and(
        eq(schema.eventAttendees.eventId, eventId),
        eq(schema.eventAttendees.memberId, memberId),
      ),
    );

  await notifyEventUninvited(db, c.env, summarize(event), [memberId], {
    userId,
    name: await actorName(db, userId),
  });

  return c.json({ ok: true });
});

// POST /events/:id/rsvp — answer an invitation.
//
// Answering is the ATTENDEE's own right, so this is intentionally not behind
// canMutateEvent: a plain member who may not touch the event's time can always
// say whether they are coming. What is guarded is answering for someone else —
// allowed only for dependents, who have no account to answer with.
eventRoutes.post("/:id/rsvp", requireSession, zv(rsvpSchema), async (c) => {
  const { id: eventId } = c.req.param();
  const userId = c.get("userId")!;
  const { status, memberId: targetMemberId } = c.req.valid("json");
  const db = getDb(c.env);

  const event = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.id, eventId), ne(schema.events.status, "trashed")))
    .get();

  if (!event) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, event.familyId);
  if (membership instanceof Response) return membership;

  // A cancelled event has nothing left to answer.
  if (event.status === "cancelled") {
    return c.json({ error: "conflict", reason: "event_cancelled" }, 409);
  }

  let memberId = membership.id;
  let onBehalfOf: string | null = null;

  if (targetMemberId && targetMemberId !== membership.id) {
    const target = await db
      .select({
        id: schema.familyMembers.id,
        familyId: schema.familyMembers.familyId,
        memberType: schema.familyMembers.memberType,
        displayName: schema.familyMembers.displayName,
      })
      .from(schema.familyMembers)
      .where(eq(schema.familyMembers.id, targetMemberId))
      .get();

    if (!target || target.familyId !== event.familyId) {
      return c.json({ error: "invalid_member_ids" }, 400);
    }
    // You may answer for a child who has no account; never for another adult.
    if (target.memberType !== "dependent") {
      return c.json(
        { error: "forbidden", reason: "you can only RSVP for yourself or a dependent" },
        403,
      );
    }
    memberId = target.id;
    onBehalfOf = target.displayName ?? "a dependent";
  }

  const attendee = await db
    .select({ memberId: schema.eventAttendees.memberId })
    .from(schema.eventAttendees)
    .where(
      and(
        eq(schema.eventAttendees.eventId, eventId),
        eq(schema.eventAttendees.memberId, memberId),
      ),
    )
    .get();

  // Not invited → nothing to answer. 403 (not 404): the event is visible to you.
  if (!attendee) {
    return c.json({ error: "forbidden", reason: "not_an_attendee" }, 403);
  }

  await db
    .update(schema.eventAttendees)
    .set({ rsvp: status, rsvpAt: Math.floor(Date.now() / 1000) })
    .where(
      and(
        eq(schema.eventAttendees.eventId, eventId),
        eq(schema.eventAttendees.memberId, memberId),
      ),
    );

  await insertAuditEvent(db, {
    familyId: event.familyId,
    actorUserId: userId,
    action: "event_rsvp",
    targetType: "event",
    targetId: eventId,
    meta: { rsvp: status, memberId },
  });

  // The organizer is the one waiting on the answer.
  const organizerMember = await db
    .select({ id: schema.familyMembers.id })
    .from(schema.familyMembers)
    .where(
      and(
        eq(schema.familyMembers.familyId, event.familyId),
        eq(schema.familyMembers.userId, event.createdBy),
      ),
    )
    .get();

  if (organizerMember) {
    await notifyRsvpAnswered(
      db,
      c.env,
      summarize(event),
      [organizerMember.id],
      { userId, name: await actorName(db, userId) },
      status,
      onBehalfOf,
    );
  }

  return c.json({ ok: true, memberId, rsvp: status });
});
