import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { HonoEnv } from "../types";

export const taskRoutes = new Hono<HonoEnv>();

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-mm-dd")
  .optional();

const createTaskSchema = z.object({
  title: z.string().min(1).max(300),
  notes: z.string().max(2000).optional(),
  assignedToMemberId: z.string().optional(),
  dueDate: isoDate,
  relatedDocumentId: z.string().optional(),
  relatedEventId: z.string().optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  notes: z.string().max(2000).optional(),
  assignedToMemberId: z.string().nullable().optional(),
  dueDate: isoDate,
  status: z.enum(["open", "done", "archived"]).optional(),
  relatedDocumentId: z.string().nullable().optional(),
  relatedEventId: z.string().nullable().optional(),
});

// GET /api/tasks?family=<familyId>&status=open|done|archived&assignee=<memberId>
taskRoutes.get("/", (c) => {
  // Phase 2.5: requires D1 + auth session middleware
  return c.json({ tasks: [] });
});

// POST /api/tasks
taskRoutes.post(
  "/",
  zValidator("json", createTaskSchema, (result, c) => {
    if (!result.success) return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  }),
  (c) => c.json({ error: "not_implemented", phase: "2.5" }, 501),
);

// GET /api/tasks/:id
taskRoutes.get("/:id", (c) =>
  c.json({ error: "not_implemented", phase: "2.5" }, 501),
);

// PATCH /api/tasks/:id — update fields or toggle status
taskRoutes.patch(
  "/:id",
  zValidator("json", updateTaskSchema, (result, c) => {
    if (!result.success) return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  }),
  (c) => c.json({ error: "not_implemented", phase: "2.5" }, 501),
);

// DELETE /api/tasks/:id
taskRoutes.delete("/:id", (c) =>
  c.json({ error: "not_implemented", phase: "2.5" }, 501),
);
