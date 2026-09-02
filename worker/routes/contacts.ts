import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { audit, ACTIONS } from "../lib/audit";
import {
  GOOGLE_SCOPES,
  getUserGoogleAccessToken,
  userHasScope,
} from "../lib/google";
import {
  PeopleError,
  listConnections,
  flattenPerson,
  createGoogleContact,
  updateGoogleContact,
  deleteGoogleContact,
} from "../lib/people";

export const contactRoutes = new Hono<HonoEnv>();

// ── Validation schemas ────────────────────────────────────────────────────────

const createContactSchema = z.object({
  familyId: z.string().min(1),
  name: z.string().min(1).max(200),
  relationship: z.string().max(100).optional(),
  phone: z
    .string()
    .max(50)
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
  const userId = c.get("userId")!;
  const db = getDb(c.env);
  let familyId = c.req.query("familyId");

  if (!familyId) {
    // Resolve user's first active family
    const membership = await db
      .select({ familyId: schema.familyMembers.familyId })
      .from(schema.familyMembers)
      .where(
        and(
          eq(schema.familyMembers.userId, userId),
          eq(schema.familyMembers.status, "active"),
        ),
      )
      .get();
    if (!membership) return c.json({ contacts: [] });
    familyId = membership.familyId;
  }

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const contacts = await db
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.familyId, familyId))
    .orderBy(asc(schema.contacts.name));

  return c.json({ contacts });
});

function syncTokenKey(userId: string, familyId: string): string {
  return `user:contacts_sync:${userId}:${familyId}`;
}

async function pushToGoogle(
  env: Parameters<typeof getUserGoogleAccessToken>[0],
  userId: string,
  contact: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    notes: string | null;
    googleResourceName: string | null;
    googleEtag: string | null;
  },
): Promise<{ resourceName: string; etag: string | null } | null> {
  if (!(await userHasScope(env, userId, GOOGLE_SCOPES.contacts))) return null;
  const token = await getUserGoogleAccessToken(env, userId);
  if (!token) return null;
  try {
    const person = contact.googleResourceName
      ? await updateGoogleContact(token, contact.googleResourceName, {
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          notes: contact.notes,
          etag: contact.googleEtag,
        })
      : await createGoogleContact(token, {
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          notes: contact.notes,
        });
    return { resourceName: person.resourceName, etag: person.etag ?? null };
  } catch (e) {
    console.error("[contacts] google push failed", e);
    return null;
  }
}

// GET /contacts/google-status — whether this user granted the contacts scope.
contactRoutes.get("/google-status", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const connected = await userHasScope(c.env, userId, GOOGLE_SCOPES.contacts);
  return c.json({ connected });
});

// POST /contacts/sync — pull Google Contacts, then push unsynced local rows.
contactRoutes.post("/sync", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const familyId = c.req.query("familyId") ?? (await c.req.json().catch(() => ({})) as { familyId?: string }).familyId;
  if (!familyId) return c.json({ error: "familyId required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  if (!(await userHasScope(c.env, userId, GOOGLE_SCOPES.contacts))) {
    return c.json({ error: "contacts_not_connected" }, 409);
  }
  const token = await getUserGoogleAccessToken(c.env, userId);
  if (!token) return c.json({ error: "google_token_missing" }, 503);

  const db = getDb(c.env);
  let syncToken = await c.env.KV.get(syncTokenKey(userId, familyId));
  let pulled = 0;
  let created = 0;
  let updated = 0;
  let pushed = 0;
  let pageToken: string | null = null;

  try {
    for (let i = 0; i < 20; i++) {
      let page;
      try {
        page = await listConnections(token, { syncToken, pageToken });
      } catch (e) {
        if (e instanceof PeopleError && e.statusCode === 410) {
          syncToken = null;
          pageToken = null;
          await c.env.KV.delete(syncTokenKey(userId, familyId));
          continue;
        }
        throw e;
      }

      for (const person of page.connections) {
        const flat = flattenPerson(person);
        if (!flat.name) continue;
        pulled += 1;
        const existing = await db
          .select()
          .from(schema.contacts)
          .where(
            and(
              eq(schema.contacts.familyId, familyId),
              eq(schema.contacts.googleResourceName, flat.resourceName),
            ),
          )
          .get();
        const now = Math.floor(Date.now() / 1000);
        if (existing) {
          await db
            .update(schema.contacts)
            .set({
              name: flat.name,
              email: flat.email,
              phone: flat.phone,
              notes: flat.notes,
              googleEtag: flat.etag,
              updatedAt: now,
              lastPushedAt: now,
            })
            .where(eq(schema.contacts.id, existing.id));
          updated += 1;
        } else {
          await db.insert(schema.contacts).values({
            id: crypto.randomUUID(),
            familyId,
            name: flat.name,
            phone: flat.phone,
            email: flat.email,
            notes: flat.notes,
            relationship: "Google",
            createdBy: userId,
            googleResourceName: flat.resourceName,
            googleEtag: flat.etag,
            lastPushedAt: now,
            updatedAt: now,
          });
          created += 1;
        }
      }

      if (page.nextPageToken) {
        pageToken = page.nextPageToken;
        continue;
      }
      if (page.nextSyncToken) {
        await c.env.KV.put(syncTokenKey(userId, familyId), page.nextSyncToken);
      }
      break;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync_failed";
    return c.json({ error: "google_sync_failed", detail: message }, 502);
  }

  // Push local contacts that have never been sent to Google.
  const locals = await db
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.familyId, familyId));
  for (const row of locals) {
    if (row.googleResourceName) continue;
    const pushedRow = await pushToGoogle(c.env, userId, row);
    if (pushedRow) {
      const now = Math.floor(Date.now() / 1000);
      await db
        .update(schema.contacts)
        .set({
          googleResourceName: pushedRow.resourceName,
          googleEtag: pushedRow.etag,
          lastPushedAt: now,
        })
        .where(eq(schema.contacts.id, row.id));
      pushed += 1;
    }
  }

  await audit(c, {
    familyId,
    action: ACTIONS.CONTACT_SYNCED,
    targetType: "family",
    targetId: familyId,
    meta: { pulled, created, updated, pushed },
  });

  return c.json({ ok: true, pulled, created, updated, pushed });
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

  await audit(c, {
    familyId: data.familyId,
    action: ACTIONS.CONTACT_CREATED,
    targetType: "contact",
    targetId: contactId,
    meta: { name: data.name },
  });

  const contact = await db
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.id, contactId))
    .get();

  if (contact) {
    const pushed = await pushToGoogle(c.env, userId, {
      ...contact,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
      notes: contact.notes ?? null,
      googleResourceName: contact.googleResourceName ?? null,
      googleEtag: contact.googleEtag ?? null,
    });
    if (pushed) {
      await db
        .update(schema.contacts)
        .set({
          googleResourceName: pushed.resourceName,
          googleEtag: pushed.etag,
          lastPushedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(schema.contacts.id, contactId));
    }
  }

  return c.json({ contact: contact ? { ...contact, googleResourceName: contact.googleResourceName } : contact }, 201);
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
  const userId = c.get("userId")!;
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

  await audit(c, {
    familyId: contact.familyId,
    action: ACTIONS.CONTACT_UPDATED,
    targetType: "contact",
    targetId: contactId,
  });

  const updatedContact = await db
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.id, contactId))
    .get();

  if (updatedContact) {
    const pushed = await pushToGoogle(c.env, userId, {
      ...updatedContact,
      email: updatedContact.email ?? null,
      phone: updatedContact.phone ?? null,
      notes: updatedContact.notes ?? null,
      googleResourceName: updatedContact.googleResourceName ?? null,
      googleEtag: updatedContact.googleEtag ?? null,
    });
    if (pushed) {
      await db
        .update(schema.contacts)
        .set({
          googleResourceName: pushed.resourceName,
          googleEtag: pushed.etag,
          lastPushedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(schema.contacts.id, contactId));
      updatedContact.googleResourceName = pushed.resourceName;
      updatedContact.googleEtag = pushed.etag;
    }
  }

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

  if (contact.googleResourceName && (await userHasScope(c.env, userId, GOOGLE_SCOPES.contacts))) {
    const token = await getUserGoogleAccessToken(c.env, userId);
    if (token) {
      try {
        await deleteGoogleContact(token, contact.googleResourceName);
      } catch (e) {
        console.error("[contacts] google delete failed", e);
      }
    }
  }

  await db.delete(schema.contacts).where(eq(schema.contacts.id, contactId));

  await audit(c, {
    familyId: contact.familyId,
    action: ACTIONS.CONTACT_DELETED,
    targetType: "contact",
    targetId: contactId,
    meta: { name: contact.name },
  });

  return c.json({ ok: true });
});
