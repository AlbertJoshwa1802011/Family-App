import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";

export const contactRoutes = new Hono<HonoEnv>();

// ── Validation schemas ────────────────────────────────────────────────────────

const createContactSchema = z.object({
  familyId: z.string().min(1),
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

const updateContactSchema = createContactSchema.omit({ familyId: true }).partial();

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /contacts?familyId=:id
contactRoutes.get("/", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const contacts = await db
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.familyId, familyId))
    .orderBy(asc(schema.contacts.name));

  return c.json({ contacts });
});

// POST /contacts
contactRoutes.post("/", requireSession, zv(createContactSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const contactId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(schema.contacts).values({
    id: contactId,
    familyId: data.familyId,
    name: data.name,
    relationship: data.relationship,
    phone: data.phone,
    email: data.email,
    notes: data.notes,
    createdBy: userId,
    updatedAt: now,
  });

  const contact = await db
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.id, contactId))
    .get();

  return c.json({ contact }, 201);
});

// GET /contacts/:id
contactRoutes.get("/:id", requireSession, async (c) => {
  const { id: contactId } = c.req.param();
  const db = getDb(c.env);

  const contact = await db
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.id, contactId))
    .get();

  if (!contact) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, contact.familyId);
  if (membership instanceof Response) return membership;

  return c.json({ contact });
});

// PATCH /contacts/:id
contactRoutes.patch("/:id", requireSession, zv(updateContactSchema), async (c) => {
  const { id: contactId } = c.req.param();
  const updates = c.req.valid("json");
  const db = getDb(c.env);

  const contact = await db
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.id, contactId))
    .get();

  if (!contact) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, contact.familyId);
  if (membership instanceof Response) return membership;

  const set: Partial<typeof schema.contacts.$inferInsert> = {
    updatedAt: Math.floor(Date.now() / 1000),
  };
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.relationship !== undefined) set.relationship = updates.relationship;
  if (updates.phone !== undefined) set.phone = updates.phone;
  if (updates.email !== undefined) set.email = updates.email;
  if (updates.notes !== undefined) set.notes = updates.notes;

  await db.update(schema.contacts).set(set).where(eq(schema.contacts.id, contactId));

  const updatedContact = await db
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.id, contactId))
    .get();

  return c.json({ contact: updatedContact });
});

// DELETE /contacts/:id
contactRoutes.delete("/:id", requireSession, async (c) => {
  const { id: contactId } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const contact = await db
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.id, contactId))
    .get();

  if (!contact) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, contact.familyId);
  if (membership instanceof Response) return membership;

  if (contact.createdBy !== userId && membership.role === "member") {
    return c.json({ error: "forbidden" }, 403);
  }

  await db.delete(schema.contacts).where(eq(schema.contacts.id, contactId));

  return c.json({ ok: true });
});
