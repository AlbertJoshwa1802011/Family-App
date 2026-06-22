import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { insertAuditEvent } from "../lib/audit";

export const occasionRoutes = new Hono<HonoEnv>();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-mm-dd");
const occType = z.enum(["birthday", "anniversary", "custom"]);

const createOccasionSchema = z.object({
  familyId: z.string().min(1),
  type: occType.optional().default("custom"),
  title: z.string().min(1).max(200),
  date: isoDate,
  recurring: z.boolean().optional().default(true),
  subjectMemberId: z.string().optional(),
  notes: z.string().max(2000).optional(),
  recipientMemberIds: z.array(z.string()).max(50).optional(),
});

const updateOccasionSchema = z.object({
  type: occType.optional(),
  title: z.string().min(1).max(200).optional(),
  date: isoDate.optional(),
  recurring: z.boolean().optional(),
  subjectMemberId: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  recipientMemberIds: z.array(z.string()).max(50).optional(),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

/** Replace an occasion's tagged-recipient set. */
async function setRecipients(
  db: ReturnType<typeof getDb>,
  occasionId: string,
  memberIds: string[],
) {
  await db
    .delete(schema.occasionRecipients)
    .where(eq(schema.occasionRecipients.occasionId, occasionId));
  const unique = [...new Set(memberIds)].filter(Boolean);
  if (unique.length > 0) {
    await db
      .insert(schema.occasionRecipients)
      .values(unique.map((memberId) => ({ occasionId, memberId })));
  }
}

async function recipientsFor(
  db: ReturnType<typeof getDb>,
  occasionIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (occasionIds.length === 0) return map;
  const rows = await db
    .select()
    .from(schema.occasionRecipients)
    .where(inArray(schema.occasionRecipients.occasionId, occasionIds));
  for (const r of rows) {
    const list = map.get(r.occasionId) ?? [];
    list.push(r.memberId);
    map.set(r.occasionId, list);
  }
  return map;
}

// GET /occasions?familyId=:fid — list active occasions + tagged recipients.
occasionRoutes.get("/", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(schema.occasions)
    .where(and(eq(schema.occasions.familyId, familyId), ne(schema.occasions.status, "trashed")))
    .orderBy(desc(schema.occasions.createdAt));

  const recips = await recipientsFor(db, rows.map((r) => r.id));
  const occasions = rows.map((o) => ({ ...o, recipientMemberIds: recips.get(o.id) ?? [] }));

  return c.json({ occasions });
});

// POST /occasions — create an occasion (+ tagged recipients).
occasionRoutes.post("/", requireSession, zv(createOccasionSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const id = crypto.randomUUID();
  const nowSecs = Math.floor(Date.now() / 1000);

  await db.insert(schema.occasions).values({
    id,
    familyId: data.familyId,
    type: data.type,
    title: data.title,
    date: data.date,
    recurring: data.recurring,
    subjectMemberId: data.subjectMemberId,
    notes: data.notes,
    status: "active",
    createdBy: userId,
    updatedAt: nowSecs,
  });

  if (data.recipientMemberIds) await setRecipients(db, id, data.recipientMemberIds);

  await insertAuditEvent(db, {
    familyId: data.familyId,
    actorUserId: userId,
    action: "occasion_created",
    targetType: "occasion",
    targetId: id,
    meta: { title: data.title, type: data.type },
  });

  const occasion = await db
    .select()
    .from(schema.occasions)
    .where(eq(schema.occasions.id, id))
    .get();

  return c.json({ occasion: { ...occasion, recipientMemberIds: data.recipientMemberIds ?? [] } }, 201);
});

// GET /occasions/:id — single occasion + recipients.
occasionRoutes.get("/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const db = getDb(c.env);

  const occasion = await db
    .select()
    .from(schema.occasions)
    .where(and(eq(schema.occasions.id, id), ne(schema.occasions.status, "trashed")))
    .get();

  if (!occasion) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, occasion.familyId);
  if (membership instanceof Response) return membership;

  const recips = await recipientsFor(db, [id]);
  return c.json({ occasion: { ...occasion, recipientMemberIds: recips.get(id) ?? [] } });
});

// PATCH /occasions/:id — update metadata and/or recipients.
occasionRoutes.patch("/:id", requireSession, zv(updateOccasionSchema), async (c) => {
  const { id } = c.req.param();
  const userId = c.get("userId")!;
  const updates = c.req.valid("json");
  const db = getDb(c.env);

  const occasion = await db
    .select()
    .from(schema.occasions)
    .where(and(eq(schema.occasions.id, id), ne(schema.occasions.status, "trashed")))
    .get();

  if (!occasion) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, occasion.familyId);
  if (membership instanceof Response) return membership;

  const set: Partial<typeof schema.occasions.$inferInsert> = {
    updatedAt: Math.floor(Date.now() / 1000),
  };
  if (updates.type !== undefined) set.type = updates.type;
  if (updates.title !== undefined) set.title = updates.title;
  if (updates.date !== undefined) set.date = updates.date;
  if (updates.recurring !== undefined) set.recurring = updates.recurring;
  if (updates.subjectMemberId !== undefined)
    set.subjectMemberId = updates.subjectMemberId ?? undefined;
  if (updates.notes !== undefined) set.notes = updates.notes ?? undefined;

  await db.update(schema.occasions).set(set).where(eq(schema.occasions.id, id));
  if (updates.recipientMemberIds !== undefined)
    await setRecipients(db, id, updates.recipientMemberIds);

  await insertAuditEvent(db, {
    familyId: occasion.familyId,
    actorUserId: userId,
    action: "occasion_updated",
    targetType: "occasion",
    targetId: id,
  });

  const recips = await recipientsFor(db, [id]);
  const updated = await db
    .select()
    .from(schema.occasions)
    .where(eq(schema.occasions.id, id))
    .get();

  return c.json({ occasion: { ...updated, recipientMemberIds: recips.get(id) ?? [] } });
});

// DELETE /occasions/:id — soft delete (status = trashed).
occasionRoutes.delete("/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const occasion = await db
    .select()
    .from(schema.occasions)
    .where(and(eq(schema.occasions.id, id), ne(schema.occasions.status, "trashed")))
    .get();

  if (!occasion) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, occasion.familyId);
  if (membership instanceof Response) return membership;

  await db
    .update(schema.occasions)
    .set({ status: "trashed" })
    .where(eq(schema.occasions.id, id));

  await insertAuditEvent(db, {
    familyId: occasion.familyId,
    actorUserId: userId,
    action: "occasion_deleted",
    targetType: "occasion",
    targetId: id,
    meta: { title: occasion.title },
  });

  return c.json({ ok: true });
});
