/**
 * Family notebook — Apple Notes–style folders + free-form notes
 * (daily journal, Bible study, etc.).
 *
 * Visibility mirrors documents: private notes are hidden from non-owner,
 * non-admin members (404, never 403). Soft-delete via deletedAt; list
 * defaults to live notes; ?trashed=1 shows Recently Deleted.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  like,
  or,
  sql,
} from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema, type Db } from "../db/client";
import { NOTE_KINDS } from "../db/schema";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";

export const noteRoutes = new Hono<HonoEnv>();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-mm-dd");

// Default-free field set so PATCH .partial() never re-injects defaults.
const noteFieldsSchema = z.object({
  notebookId: z.string().min(1).nullable(),
  title: z.string().max(200),
  body: z.string().max(100_000),
  kind: z.enum(NOTE_KINDS),
  noteDate: isoDate.nullable(),
  visibility: z.enum(["family", "private"]),
  pinned: z.boolean(),
});

const createNoteSchema = z
  .object({
    familyId: z.string().min(1),
  })
  .merge(
    noteFieldsSchema.partial().extend({
      title: z.string().max(200).optional().default(""),
      body: z.string().max(100_000).optional().default(""),
      kind: z.enum(NOTE_KINDS).optional().default("general"),
      visibility: z.enum(["family", "private"]).optional().default("private"),
      pinned: z.boolean().optional().default(false),
    }),
  );

const updateNoteSchema = noteFieldsSchema.partial();

const createNotebookSchema = z.object({
  familyId: z.string().min(1),
  name: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0).max(10_000).optional().default(0),
});

const updateNotebookSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

/**
 * True when a private note must be hidden from this user. Applied to every
 * read AND write — never reveal existence with 403.
 */
function isNoteHiddenFrom(
  note: { visibility: string; ownerUserId: string },
  userId: string,
  role: string,
): boolean {
  return (
    note.visibility === "private" &&
    note.ownerUserId !== userId &&
    role !== "owner" &&
    role !== "admin"
  );
}

function serializeNote(row: typeof schema.notes.$inferSelect) {
  return {
    id: row.id,
    familyId: row.familyId,
    notebookId: row.notebookId,
    ownerUserId: row.ownerUserId,
    title: row.title,
    body: row.body,
    kind: row.kind,
    noteDate: row.noteDate,
    visibility: row.visibility,
    pinned: row.pinned === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

async function loadNote(db: Db, id: string) {
  return db.select().from(schema.notes).where(eq(schema.notes.id, id)).get();
}

async function assertNotebookInFamily(
  db: Db,
  notebookId: string,
  familyId: string,
): Promise<true | Response> {
  const nb = await db
    .select({ id: schema.notebooks.id, familyId: schema.notebooks.familyId })
    .from(schema.notebooks)
    .where(eq(schema.notebooks.id, notebookId))
    .get();
  if (!nb || nb.familyId !== familyId) {
    return Response.json({ error: "invalid_notebook_id" }, { status: 400 });
  }
  return true;
}

// ── Notebooks (registered before /:id) ───────────────────────────────────────

// GET /notes/notebooks?familyId=
noteRoutes.get("/notebooks", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const notebooks = await db
    .select()
    .from(schema.notebooks)
    .where(eq(schema.notebooks.familyId, familyId))
    .orderBy(asc(schema.notebooks.sortOrder), asc(schema.notebooks.name));

  return c.json({ notebooks });
});

// POST /notes/notebooks
noteRoutes.post("/notebooks", requireSession, zv(createNotebookSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(schema.notebooks).values({
    id,
    familyId: data.familyId,
    name: data.name,
    sortOrder: data.sortOrder,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });

  const notebook = await db
    .select()
    .from(schema.notebooks)
    .where(eq(schema.notebooks.id, id))
    .get();

  return c.json({ notebook }, 201);
});

// PATCH /notes/notebooks/:id
noteRoutes.patch(
  "/notebooks/:id",
  requireSession,
  zv(updateNotebookSchema),
  async (c) => {
    const { id } = c.req.param();
    const updates = c.req.valid("json");
    const db = getDb(c.env);

    const notebook = await db
      .select()
      .from(schema.notebooks)
      .where(eq(schema.notebooks.id, id))
      .get();
    if (!notebook) return c.json({ error: "not_found" }, 404);

    const membership = await requireFamilyMember(c, notebook.familyId);
    if (membership instanceof Response) return membership;

    const set: Partial<typeof schema.notebooks.$inferInsert> = {
      updatedAt: Math.floor(Date.now() / 1000),
    };
    if (updates.name !== undefined) set.name = updates.name;
    if (updates.sortOrder !== undefined) set.sortOrder = updates.sortOrder;

    await db.update(schema.notebooks).set(set).where(eq(schema.notebooks.id, id));

    const updated = await db
      .select()
      .from(schema.notebooks)
      .where(eq(schema.notebooks.id, id))
      .get();

    return c.json({ notebook: updated });
  },
);

// DELETE /notes/notebooks/:id — notes become unfiled (explicit null, D1 cascades advisory)
noteRoutes.delete("/notebooks/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const notebook = await db
    .select()
    .from(schema.notebooks)
    .where(eq(schema.notebooks.id, id))
    .get();
  if (!notebook) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, notebook.familyId);
  if (membership instanceof Response) return membership;

  if (notebook.createdBy !== userId && membership.role === "member") {
    return c.json({ error: "forbidden" }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(schema.notes)
    .set({ notebookId: null, updatedAt: now })
    .where(eq(schema.notes.notebookId, id));
  await db.delete(schema.notebooks).where(eq(schema.notebooks.id, id));

  return c.json({ ok: true });
});

// ── Notes ────────────────────────────────────────────────────────────────────

// GET /notes?familyId=&notebookId=&kind=&q=&trashed=1
noteRoutes.get("/", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const userId = c.get("userId")!;
  const db = getDb(c.env);
  const trashed = c.req.query("trashed") === "1";
  const notebookId = c.req.query("notebookId");
  const kind = c.req.query("kind");
  const q = c.req.query("q")?.trim();

  const conditions = [eq(schema.notes.familyId, familyId)];
  if (trashed) {
    conditions.push(isNotNull(schema.notes.deletedAt));
  } else {
    conditions.push(isNull(schema.notes.deletedAt));
  }

  if (notebookId === "none") {
    conditions.push(isNull(schema.notes.notebookId));
  } else if (notebookId) {
    conditions.push(eq(schema.notes.notebookId, notebookId));
  }

  if (kind && (NOTE_KINDS as readonly string[]).includes(kind)) {
    conditions.push(eq(schema.notes.kind, kind as (typeof NOTE_KINDS)[number]));
  }

  if (q) {
    // Escape LIKE metacharacters so user input is literal.
    const escaped = q.replace(/([\\%_])/g, "\\$1");
    const pattern = `%${escaped}%`;
    conditions.push(
      or(
        like(schema.notes.title, pattern),
        like(schema.notes.body, pattern),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(schema.notes)
    .where(and(...conditions))
    .orderBy(
      desc(schema.notes.pinned),
      desc(schema.notes.updatedAt),
      desc(sql`"notes".rowid`),
    );

  const notes = rows
    .filter((n) => !isNoteHiddenFrom(n, userId, membership.role))
    .map(serializeNote);

  return c.json({ notes });
});

// POST /notes
noteRoutes.post("/", requireSession, zv(createNoteSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);

  if (data.notebookId) {
    const ok = await assertNotebookInFamily(db, data.notebookId, data.familyId);
    if (ok !== true) return ok;
  }

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(schema.notes).values({
    id,
    familyId: data.familyId,
    notebookId: data.notebookId ?? null,
    ownerUserId: userId,
    title: data.title,
    body: data.body,
    kind: data.kind,
    noteDate: data.noteDate ?? null,
    visibility: data.visibility,
    pinned: data.pinned ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  });

  const note = await loadNote(db, id);
  return c.json({ note: serializeNote(note!) }, 201);
});

// GET /notes/:id
noteRoutes.get("/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const note = await loadNote(db, id);
  if (!note) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, note.familyId);
  if (membership instanceof Response) return membership;
  if (isNoteHiddenFrom(note, userId, membership.role)) {
    return c.json({ error: "not_found" }, 404);
  }

  return c.json({ note: serializeNote(note) });
});

// PATCH /notes/:id
noteRoutes.patch("/:id", requireSession, zv(updateNoteSchema), async (c) => {
  const { id } = c.req.param();
  const userId = c.get("userId")!;
  const updates = c.req.valid("json");
  const db = getDb(c.env);

  const note = await loadNote(db, id);
  if (!note || note.deletedAt) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, note.familyId);
  if (membership instanceof Response) return membership;
  if (isNoteHiddenFrom(note, userId, membership.role)) {
    return c.json({ error: "not_found" }, 404);
  }

  // Only the owner (or admin/owner role) may edit.
  if (note.ownerUserId !== userId && membership.role === "member") {
    return c.json({ error: "forbidden" }, 403);
  }

  if (updates.notebookId) {
    const ok = await assertNotebookInFamily(db, updates.notebookId, note.familyId);
    if (ok !== true) return ok;
  }

  const set: Partial<typeof schema.notes.$inferInsert> = {
    updatedAt: Math.floor(Date.now() / 1000),
  };
  // null clears nullable fields (never ?? undefined — that drops the clear).
  if (updates.notebookId !== undefined) set.notebookId = updates.notebookId;
  if (updates.title !== undefined) set.title = updates.title;
  if (updates.body !== undefined) set.body = updates.body;
  if (updates.kind !== undefined) set.kind = updates.kind;
  if (updates.noteDate !== undefined) set.noteDate = updates.noteDate;
  if (updates.visibility !== undefined) set.visibility = updates.visibility;
  if (updates.pinned !== undefined) set.pinned = updates.pinned ? 1 : 0;

  await db.update(schema.notes).set(set).where(eq(schema.notes.id, id));

  const updated = await loadNote(db, id);
  return c.json({ note: serializeNote(updated!) });
});

// DELETE /notes/:id — soft-delete (Recently Deleted). Permanent when already trashed.
noteRoutes.delete("/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const note = await loadNote(db, id);
  if (!note) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, note.familyId);
  if (membership instanceof Response) return membership;
  if (isNoteHiddenFrom(note, userId, membership.role)) {
    return c.json({ error: "not_found" }, 404);
  }

  if (note.ownerUserId !== userId && membership.role === "member") {
    return c.json({ error: "forbidden" }, 403);
  }

  if (note.deletedAt) {
    await db.delete(schema.notes).where(eq(schema.notes.id, id));
    return c.json({ ok: true, permanent: true });
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(schema.notes)
    .set({ deletedAt: now, updatedAt: now, pinned: 0 })
    .where(eq(schema.notes.id, id));

  return c.json({ ok: true, permanent: false });
});

// POST /notes/:id/restore — undelete from Recently Deleted
noteRoutes.post("/:id/restore", requireSession, async (c) => {
  const { id } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const note = await loadNote(db, id);
  if (!note || !note.deletedAt) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, note.familyId);
  if (membership instanceof Response) return membership;
  if (isNoteHiddenFrom(note, userId, membership.role)) {
    return c.json({ error: "not_found" }, 404);
  }

  if (note.ownerUserId !== userId && membership.role === "member") {
    return c.json({ error: "forbidden" }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(schema.notes)
    .set({ deletedAt: null, updatedAt: now })
    .where(eq(schema.notes.id, id));

  const updated = await loadNote(db, id);
  return c.json({ note: serializeNote(updated!) });
});
