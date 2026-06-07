import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { HonoEnv } from "../types";

export const documentRoutes = new Hono<HonoEnv>();

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-mm-dd")
  .optional();

const createDocumentSchema = z.object({
  familyId: z.string().min(1),
  title: z.string().min(1).max(300),
  category: z.string().max(100).optional().default("other"),
  subjectMemberId: z.string().optional(),
  description: z.string().max(2000).optional(),
  expiryDate: isoDate,
  issuedDate: isoDate,
  // SECURITY: visibility defaults to 'family'. A 'private' doc is only visible
  // to the owner_user_id and family admins/owner. This must be enforced on
  // every list/get query in Phase 2 (filter WHERE visibility='family' OR owner_user_id=current_user).
  visibility: z.enum(["family", "private"]).optional().default("family"),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  category: z.string().max(100).optional(),
  subjectMemberId: z.string().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  expiryDate: isoDate,
  issuedDate: isoDate,
  visibility: z.enum(["family", "private"]).optional(),
});

const createCommentSchema = z.object({
  body: z.string().min(1).max(2000),
});

// Phase 2: metadata CRUD + Drive upload/download proxy.
// IMPORTANT: All list/get queries MUST filter private documents:
//   WHERE (visibility = 'family' OR owner_user_id = current_user_id OR role IN ('owner','admin'))
// Failure to enforce this would expose private docs (wills, medical) to all family members.
documentRoutes.get("/", (c) => c.json({ documents: [] }));

documentRoutes.post(
  "/",
  zValidator("json", createDocumentSchema, (result, c) => {
    if (!result.success) return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  }),
  (c) => c.json({ error: "not_implemented", phase: 2 }, 501),
);

documentRoutes.get("/:id", (c) =>
  c.json({ error: "not_implemented", phase: 2 }, 501),
);

documentRoutes.patch(
  "/:id",
  zValidator("json", updateDocumentSchema, (result, c) => {
    if (!result.success) return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  }),
  (c) => c.json({ error: "not_implemented", phase: 2 }, 501),
);

// Soft delete (status = trashed)
documentRoutes.delete("/:id", (c) =>
  c.json({ error: "not_implemented", phase: 2 }, 501),
);

// Drive upload
documentRoutes.post("/:id/files", (c) =>
  c.json({ error: "not_implemented", phase: 2 }, 501),
);

// Drive download proxy
documentRoutes.get("/:id/files/:fid/download", (c) =>
  c.json({ error: "not_implemented", phase: 2 }, 501),
);

// Document comments
documentRoutes.get("/:id/comments", (c) =>
  c.json({ comments: [] }),
);

documentRoutes.post(
  "/:id/comments",
  zValidator("json", createCommentSchema, (result, c) => {
    if (!result.success) return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  }),
  (c) => c.json({ error: "not_implemented", phase: 2 }, 501),
);

documentRoutes.delete("/:id/comments/:commentId", (c) =>
  c.json({ error: "not_implemented", phase: 2 }, 501),
);
