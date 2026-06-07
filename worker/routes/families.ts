import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { HonoEnv } from "../types";

export const familyRoutes = new Hono<HonoEnv>();

const createFamilySchema = z.object({
  name: z.string().min(1).max(200),
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]).optional().default("member"),
});

const updateMemberSchema = z.object({
  role: z.enum(["admin", "member"]).optional(),
  status: z.enum(["active", "removed"]).optional(),
});

// Phase 1: create family (+ Drive folder), members, invites, accept.
familyRoutes.get("/", (c) => c.json({ families: [] }));

familyRoutes.post(
  "/",
  zValidator("json", createFamilySchema, (result, c) => {
    if (!result.success) return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  }),
  (c) => c.json({ error: "not_implemented", phase: 1 }, 501),
);

familyRoutes.get("/:id", (c) =>
  c.json({ error: "not_implemented", phase: 1 }, 501),
);

familyRoutes.get("/:id/members", (c) => c.json({ members: [] }));

// Used by EventForm attendee picker (special case: current user's families)
familyRoutes.get("/me/members", (c) => c.json({ members: [] }));

familyRoutes.patch(
  "/:id/members/:mid",
  zValidator("json", updateMemberSchema, (result, c) => {
    if (!result.success) return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  }),
  (c) => c.json({ error: "not_implemented", phase: 1 }, 501),
);

familyRoutes.post(
  "/:id/invites",
  zValidator("json", inviteSchema, (result, c) => {
    if (!result.success) return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  }),
  (c) => c.json({ error: "not_implemented", phase: 1 }, 501),
);

familyRoutes.post("/invites/:token/accept", (c) =>
  c.json({ error: "not_implemented", phase: 1 }, 501),
);

// Activity feed: surfaces audit_log entries for a family.
// Exposes upload/download/role-change/delete events to all active members.
familyRoutes.get("/:id/activity", (c) => c.json({ activities: [] }));
