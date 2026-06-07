import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { HonoEnv } from "../types";

export const contactRoutes = new Hono<HonoEnv>();

const createContactSchema = z.object({
  name: z.string().min(1).max(200),
  relationship: z.string().max(100).optional(),
  phone: z
    .string()
    .max(30)
    .regex(/^[+\d\s\-().]*$/, "Invalid phone")
    .optional(),
  email: z.string().email().optional().or(z.literal("")),
  notes: z.string().max(1000).optional(),
});

const updateContactSchema = createContactSchema.partial();

// GET /api/contacts?family=<familyId>
contactRoutes.get("/", (c) => {
  // Phase 2.5: requires D1 + auth session middleware
  return c.json({ contacts: [] });
});

// POST /api/contacts
contactRoutes.post(
  "/",
  zValidator("json", createContactSchema, (result, c) => {
    if (!result.success) return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  }),
  (c) => c.json({ error: "not_implemented", phase: "2.5" }, 501),
);

// GET /api/contacts/:id
contactRoutes.get("/:id", (c) =>
  c.json({ error: "not_implemented", phase: "2.5" }, 501),
);

// PATCH /api/contacts/:id
contactRoutes.patch(
  "/:id",
  zValidator("json", updateContactSchema, (result, c) => {
    if (!result.success) return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  }),
  (c) => c.json({ error: "not_implemented", phase: "2.5" }, 501),
);

// DELETE /api/contacts/:id
contactRoutes.delete("/:id", (c) =>
  c.json({ error: "not_implemented", phase: "2.5" }, 501),
);
