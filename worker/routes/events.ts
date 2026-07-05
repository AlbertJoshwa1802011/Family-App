import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { insertAuditEvent, ACTIONS } from "../lib/audit";

export const eventRoutes = new Hono<HonoEnv>();

// ── Validation schemas ────────────────────────────────────────────────────────

const EventType = z.enum(["gathering", "appointment", "milestone", "other"]);

const eventBaseSchema = z.object({
  familyId: z.string().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  startAt: z.number().int().positive(),
  endAt: z.number().int().positive().optional(),
  allDay: z.boolean().optional().default(false),
  location: z.string().max(500).optional(),
  type: EventType.optional().default("other"),
  attendeeMemberIds: z.array(z.string()).optional().default([]),
  documentIds: z.array(z.string()).optional().default([]),
});

const createEventSchema = eventBaseSchema.refine(
  (d) => !d.endAt || d.endAt >= d.startAt,
  { message: "endAt must be >= startAt", path: ["endAt"] },
);

// partial() must be called on ZodObject before refine()
const updateEventSchema = eventBaseSchema.partial().refine(
  (d) => !d.endAt || !d.startAt || d.endAt >= d.startAt,
  { message: "endAt must be >= startAt", path: ["endAt"] },
);

const addAttendeesSchema = z.object({
  memberIds: z.array(z.string()).min(1),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /events?familyId=:id&from=:unix&to=:unix
eventRoutes.get("/", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  let familyId = c.req.query("familyId");
  if (!familyId) {
    // Resolve user's first active family
    const membership = await db
      .select({ familyId: schema.familyMembers.familyId })
      .from(schema.familyMembers)
      .where(
        and(
          eq(schema.familyMembers.userId, userId),
          eq(schema.familyMembers.status, "active"),
        ),
      )
      .get();
    if (!membership) return c.json({ events: [] });
    familyId = membership.familyId;
  }

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");

  const conditions = [
    eq(schema.events.familyId, familyId),
    ne(schema.events.status, "trashed"),
  ];
  if (fromParam) conditions.push(gte(schema.events.startAt, parseInt(fromParam)));
  if (toParam) conditions.push(lte(schema.events.startAt, parseInt(toParam)));

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
  const db = getDb(c.env);

  let familyId = data.familyId;
  if (!familyId) {
    // Resolve user's first active family
    const m = await db
      .select({ familyId: schema.familyMembers.familyId })
      .from(schema.familyMembers)
      .where(
        and(
          eq(schema.familyMembers.userId, userId),
          eq(schema.familyMembers.status, "active"),
        ),
      )
      .get();
    if (!m) {
      return c.json({ error: "no_family_membership" }, 400);
    }
    familyId = m.familyId;
  }

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const eventId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(schema.events).values({
    id: eventId,
    familyId,
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

  // Add attendees
  if (data.attendeeMemberIds.length > 0) {
    await db.insert(schema.eventAttendees).values(
      data.attendeeMemberIds.map((memberId) => ({ eventId, memberId })),
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
    action: ACTIONS.EVENT_CREATED,
    targetType: "event",
    targetId: eventId,
    meta: { title: data.title },
  });

  const event = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .get();

  return c.json({ event }, 201);
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

  return c.json({ event, attendees });
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

  const set: Partial<typeof schema.events.$inferInsert> = {
    updatedAt: Math.floor(Date.now() / 1000),
  };
  if (updates.title !== undefined) set.title = updates.title;
  if (updates.description !== undefined) set.description = updates.description;
  if (updates.startAt !== undefined) set.startAt = updates.startAt;
  if (updates.endAt !== undefined) set.endAt = updates.endAt;
  if (updates.allDay !== undefined) set.allDay = updates.allDay;
  if (updates.location !== undefined) set.location = updates.location;
  if (updates.type !== undefined) set.type = updates.type;

  await db.update(schema.events).set(set).where(eq(schema.events.id, eventId));

  // Replace attendees if provided
  if (updates.attendeeMemberIds !== undefined) {
    await db.delete(schema.eventAttendees).where(eq(schema.eventAttendees.eventId, eventId));
    if (updates.attendeeMemberIds.length > 0) {
      await db.insert(schema.eventAttendees).values(
        updates.attendeeMemberIds.map((memberId) => ({ eventId, memberId })),
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
    action: ACTIONS.EVENT_UPDATED,
    targetType: "event",
    targetId: eventId,
  });

  return c.json({ event: updatedEvent });
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

  await db
    .update(schema.events)
    .set({ status: "trashed", trashedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.events.id, eventId));

  await insertAuditEvent(db, {
    familyId: event.familyId,
    actorUserId: userId,
    action: ACTIONS.EVENT_TRASHED,
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

  await db
    .update(schema.events)
    .set({ status: "cancelled", updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.events.id, eventId));

  await insertAuditEvent(db, {
    familyId: event.familyId,
    actorUserId: userId,
    action: ACTIONS.EVENT_CANCELLED,
    targetType: "event",
    targetId: eventId,
  });

  return c.json({ ok: true });
});

// POST /events/:id/attendees — add members as attendees.
eventRoutes.post("/:id/attendees", requireSession, zv(addAttendeesSchema), async (c) => {
  const { id: eventId } = c.req.param();
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

  // Insert attendees, ignore duplicates
  for (const memberId of memberIds) {
    try {
      await db.insert(schema.eventAttendees).values({ eventId, memberId });
    } catch {
      // Ignore duplicate key constraint violations
    }
  }

  return c.json({ ok: true });
});

// DELETE /events/:id/attendees/:memberId — remove an attendee.
eventRoutes.delete("/:id/attendees/:memberId", requireSession, async (c) => {
  const { id: eventId, memberId } = c.req.param();
  const db = getDb(c.env);

  const event = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.id, eventId), ne(schema.events.status, "trashed")))
    .get();

  if (!event) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, event.familyId);
  if (membership instanceof Response) return membership;

  await db
    .delete(schema.eventAttendees)
    .where(
      and(
        eq(schema.eventAttendees.eventId, eventId),
        eq(schema.eventAttendees.memberId, memberId),
      ),
    );

  return c.json({ ok: true });
});
