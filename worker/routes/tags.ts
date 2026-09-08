/**
 * Family tags + document_tags — powers smart collections / related-doc scoring.
 * Additive surface over tables that already existed in schema since Phase 0.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, eq, ne } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";

export const tagRoutes = new Hono<HonoEnv>();

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

const createTagSchema = z.object({
  familyId: z.string().min(1),
  name: z.string().min(1).max(60),
});

const setDocTagsSchema = z.object({
  tagIds: z.array(z.string().min(1)).max(40),
});

// GET /tags?familyId=
tagRoutes.get("/", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId, "member", "documents");
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const tags = await db
    .select()
    .from(schema.tags)
    .where(eq(schema.tags.familyId, familyId))
    .orderBy(asc(schema.tags.name));

  return c.json({ tags });
});

// POST /tags
tagRoutes.post("/", requireSession, zv(createTagSchema), async (c) => {
  const data = c.req.valid("json");
  const membership = await requireFamilyMember(c, data.familyId, "member", "documents");
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const name = data.name.trim();
  const existing = await db
    .select()
    .from(schema.tags)
    .where(and(eq(schema.tags.familyId, data.familyId), eq(schema.tags.name, name)))
    .get();
  if (existing) return c.json({ tag: existing });

  const id = crypto.randomUUID();
  await db.insert(schema.tags).values({ id, familyId: data.familyId, name });
  const tag = await db.select().from(schema.tags).where(eq(schema.tags.id, id)).get();
  return c.json({ tag }, 201);
});

// GET /tags/documents/:docId — tags on a document
tagRoutes.get("/documents/:docId", requireSession, async (c) => {
  const { docId } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const doc = await db
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.id, docId), ne(schema.documents.status, "trashed")))
    .get();
  if (!doc) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, doc.familyId, "member", "documents");
  if (membership instanceof Response) return membership;
  if (
    doc.visibility === "private" &&
    doc.ownerUserId !== userId &&
    membership.role !== "owner" &&
    membership.role !== "admin"
  ) {
    return c.json({ error: "not_found" }, 404);
  }

  const tags = await db
    .select({
      id: schema.tags.id,
      name: schema.tags.name,
      familyId: schema.tags.familyId,
    })
    .from(schema.documentTags)
    .innerJoin(schema.tags, eq(schema.documentTags.tagId, schema.tags.id))
    .where(eq(schema.documentTags.documentId, docId))
    .orderBy(asc(schema.tags.name));

  return c.json({ tags });
});

// PUT /tags/documents/:docId — replace tags on a document
tagRoutes.put(
  "/documents/:docId",
  requireSession,
  zv(setDocTagsSchema),
  async (c) => {
    const { docId } = c.req.param();
    const userId = c.get("userId")!;
    const { tagIds } = c.req.valid("json");
    const db = getDb(c.env);

    const doc = await db
      .select()
      .from(schema.documents)
      .where(and(eq(schema.documents.id, docId), ne(schema.documents.status, "trashed")))
      .get();
    if (!doc) return c.json({ error: "not_found" }, 404);

    const membership = await requireFamilyMember(c, doc.familyId, "member", "documents");
    if (membership instanceof Response) return membership;
    if (
      doc.visibility === "private" &&
      doc.ownerUserId !== userId &&
      membership.role !== "owner" &&
      membership.role !== "admin"
    ) {
      return c.json({ error: "not_found" }, 404);
    }

    const unique = [...new Set(tagIds)];
    if (unique.length > 0) {
      const familyTagIds = new Set(
        (
          await db
            .select({ id: schema.tags.id })
            .from(schema.tags)
            .where(eq(schema.tags.familyId, doc.familyId))
        ).map((t) => t.id),
      );
      if (unique.some((id) => !familyTagIds.has(id))) {
        return c.json({ error: "invalid_tag_ids" }, 400);
      }
    }

    await db
      .delete(schema.documentTags)
      .where(eq(schema.documentTags.documentId, docId));
    if (unique.length > 0) {
      await db.insert(schema.documentTags).values(
        unique.map((tagId) => ({ documentId: docId, tagId })),
      );
    }

    const tags = await db
      .select({
        id: schema.tags.id,
        name: schema.tags.name,
        familyId: schema.tags.familyId,
      })
      .from(schema.documentTags)
      .innerJoin(schema.tags, eq(schema.documentTags.tagId, schema.tags.id))
      .where(eq(schema.documentTags.documentId, docId))
      .orderBy(asc(schema.tags.name));

    return c.json({ tags });
  },
);
