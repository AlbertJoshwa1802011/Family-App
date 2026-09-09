/**
 * Resource links — YouTube / URL / photo-doc attachments on events, tasks,
 * notes, or documents. Additive; never required by existing flows.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import {
  RESOURCE_LINK_KINDS,
  RESOURCE_LINK_TARGETS,
} from "../db/schema";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { allDocumentsInFamily, eventInFamily } from "../lib/familyScope";

export const linkRoutes = new Hono<HonoEnv>();

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

const createLinkSchema = z
  .object({
    familyId: z.string().min(1),
    kind: z.enum(RESOURCE_LINK_KINDS),
    targetType: z.enum(RESOURCE_LINK_TARGETS),
    targetId: z.string().min(1),
    url: z.string().url().max(2000).optional(),
    title: z.string().max(200).optional(),
    documentId: z.string().min(1).optional(),
  })
  .refine(
    (d) =>
      (d.kind === "photo" && Boolean(d.documentId)) ||
      (d.kind !== "photo" && Boolean(d.url)),
    { message: "photo requires documentId; youtube/url require url" },
  );

function serialize(row: typeof schema.resourceLinks.$inferSelect) {
  return {
    id: row.id,
    familyId: row.familyId,
    kind: row.kind,
    targetType: row.targetType,
    targetId: row.targetId,
    url: row.url,
    title: row.title,
    documentId: row.documentId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

async function assertTargetInFamily(
  db: ReturnType<typeof getDb>,
  familyId: string,
  targetType: (typeof RESOURCE_LINK_TARGETS)[number],
  targetId: string,
): Promise<true | Response> {
  if (targetType === "event") {
    if (!(await eventInFamily(db, familyId, targetId))) {
      return Response.json({ error: "invalid_target_id" }, { status: 400 });
    }
    return true;
  }
  if (targetType === "task") {
    const t = await db
      .select({ id: schema.tasks.id, familyId: schema.tasks.familyId })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, targetId))
      .get();
    if (!t || t.familyId !== familyId) {
      return Response.json({ error: "invalid_target_id" }, { status: 400 });
    }
    return true;
  }
  if (targetType === "note") {
    const n = await db
      .select({
        id: schema.notes.id,
        familyId: schema.notes.familyId,
        deletedAt: schema.notes.deletedAt,
      })
      .from(schema.notes)
      .where(eq(schema.notes.id, targetId))
      .get();
    if (!n || n.familyId !== familyId || n.deletedAt) {
      return Response.json({ error: "invalid_target_id" }, { status: 400 });
    }
    return true;
  }
  // document
  if (!(await allDocumentsInFamily(db, familyId, [targetId]))) {
    return Response.json({ error: "invalid_target_id" }, { status: 400 });
  }
  return true;
}

// GET /links?familyId=&targetType=&targetId=
linkRoutes.get("/", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  const targetType = c.req.query("targetType");
  const targetId = c.req.query("targetId");
  if (!familyId || !targetType || !targetId) {
    return c.json(
      { error: "familyId, targetType, and targetId query params required" },
      400,
    );
  }
  if (!(RESOURCE_LINK_TARGETS as readonly string[]).includes(targetType)) {
    return c.json({ error: "invalid_target_type" }, 400);
  }

  const membership = await requireFamilyMember(c, familyId, "member");
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(schema.resourceLinks)
    .where(
      and(
        eq(schema.resourceLinks.familyId, familyId),
        eq(
          schema.resourceLinks.targetType,
          targetType as (typeof RESOURCE_LINK_TARGETS)[number],
        ),
        eq(schema.resourceLinks.targetId, targetId),
      ),
    )
    .orderBy(desc(schema.resourceLinks.createdAt));

  return c.json({ links: rows.map(serialize) });
});

// POST /links
linkRoutes.post("/", requireSession, zv(createLinkSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId, "member");
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const targetOk = await assertTargetInFamily(
    db,
    data.familyId,
    data.targetType,
    data.targetId,
  );
  if (targetOk !== true) return targetOk;

  if (data.documentId) {
    if (!(await allDocumentsInFamily(db, data.familyId, [data.documentId]))) {
      return c.json({ error: "invalid_document_id" }, 400);
    }
  }

  // Light youtube host check — store any https URL as url kind otherwise.
  if (data.kind === "youtube" && data.url) {
    try {
      const host = new URL(data.url).hostname.replace(/^www\./, "");
      if (
        host !== "youtube.com" &&
        host !== "youtu.be" &&
        host !== "m.youtube.com"
      ) {
        return c.json({ error: "invalid_youtube_url" }, 400);
      }
    } catch {
      return c.json({ error: "invalid_youtube_url" }, 400);
    }
  }

  const id = crypto.randomUUID();
  await db.insert(schema.resourceLinks).values({
    id,
    familyId: data.familyId,
    kind: data.kind,
    targetType: data.targetType,
    targetId: data.targetId,
    url: data.url ?? null,
    title: data.title?.trim() || null,
    documentId: data.documentId ?? null,
    createdBy: userId,
  });

  const row = await db
    .select()
    .from(schema.resourceLinks)
    .where(eq(schema.resourceLinks.id, id))
    .get();
  return c.json({ link: serialize(row!) }, 201);
});

// DELETE /links/:id
linkRoutes.delete("/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const row = await db
    .select()
    .from(schema.resourceLinks)
    .where(eq(schema.resourceLinks.id, id))
    .get();
  if (!row) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, row.familyId, "member");
  if (membership instanceof Response) return membership;

  if (
    row.createdBy !== userId &&
    membership.role !== "admin" &&
    membership.role !== "owner"
  ) {
    return c.json({ error: "forbidden" }, 403);
  }

  await db.delete(schema.resourceLinks).where(eq(schema.resourceLinks.id, id));
  return c.json({ ok: true });
});
