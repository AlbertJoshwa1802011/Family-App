import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { HonoEnv } from "../types";

export const eventRoutes = new Hono<HonoEnv>();

const EventType = z.enum(["gathering", "appointment", "milestone", "other"]);

const eventBaseSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  startAt: z.number().int().positive(), // unix timestamp (seconds)
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

// partial() must be called on ZodObject, not ZodEffects
const updateEventSchema = eventBaseSchema.partial().refine(
  (d) => !d.endAt || !d.startAt || d.endAt >= d.startAt,
  { message: "endAt must be >= startAt", path: ["endAt"] },
);

const addAttendeesSchema = z.object({
  memberIds: z.array(z.string()).min(1),
});

// GET /api/events?family=<familyId>&from=<unix>&to=<unix>
// Returns all events for a family in a date range.
eventRoutes.get("/", (c) => {
  // Phase 2.5: requires D1 + auth session middleware
  return c.json({ events: [] });
});

// POST /api/events
eventRoutes.post(
  "/",
  zValidator("json", createEventSchema, (result, c) => {
    if (!result.success) return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  }),
  (c) => c.json({ error: "not_implemented", phase: "2.5" }, 501),
);

// GET /api/events/:id
eventRoutes.get("/:id", (c) =>
  c.json({ error: "not_implemented", phase: "2.5" }, 501),
);

// PATCH /api/events/:id
eventRoutes.patch(
  "/:id",
  zValidator("json", updateEventSchema, (result, c) => {
    if (!result.success) return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  }),
  (c) => c.json({ error: "not_implemented", phase: "2.5" }, 501),
);

// DELETE /api/events/:id — soft delete (status=trashed)
eventRoutes.delete("/:id", (c) =>
  c.json({ error: "not_implemented", phase: "2.5" }, 501),
);

// POST /api/events/:id/cancel — cancel without deleting
eventRoutes.post("/:id/cancel", (c) =>
  c.json({ error: "not_implemented", phase: "2.5" }, 501),
);

// POST /api/events/:id/attendees — tag family members as attendees
eventRoutes.post(
  "/:id/attendees",
  zValidator("json", addAttendeesSchema, (result, c) => {
    if (!result.success) return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  }),
  (c) => c.json({ error: "not_implemented", phase: "2.5" }, 501),
);

// DELETE /api/events/:id/attendees/:memberId
eventRoutes.delete("/:id/attendees/:memberId", (c) =>
  c.json({ error: "not_implemented", phase: "2.5" }, 501),
);
