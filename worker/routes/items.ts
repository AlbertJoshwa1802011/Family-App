import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq, or } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { audit } from "../lib/audit";
import { getModule } from "../modules/registry";

export const itemsRoutes = new Hono<HonoEnv>();

// ── Validation schemas ────────────────────────────────────────────────────────

const createItemSchema = z.object({
  familyId: z.string().min(1),
  type: z.string().min(1).max(50),
  title: z.string().min(1).max(200),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  amountCents: z.number().int().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  visibility: z.enum(["family", "private"]).optional(),
});

const updateItemSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  amountCents: z.number().int().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  visibility: z.enum(["family", "private"]).optional(),
  status: z.enum(["active", "trashed"]).optional(),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse item data JSON blob. Returns null if data is null/undefined/invalid JSON.
 * Never throws — the column value was validated on write, but we guard defensively.
 */
function parseData(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the searchText string for an item. Includes title + type + any
 * registry-defined searchFields pulled from the data blob.
 */
function buildSearchText(
  title: string,
  type: string,
  data: Record<string, unknown> | null | undefined,
): string {
  const parts: string[] = [title, type];
  if (data) {
    const mod = getModule(type);
    if (mod?.searchFields) {
      for (const field of mod.searchFields) {
        const val = data[field];
        if (typeof val === "string" && val.length > 0) {
          parts.push(val);
        }
      }
    }
  }
  return parts.join(" ");
}

/**
 * Serialize an item row for the API response, parsing the data JSON text field.
 */
function serializeItem(item: typeof schema.items.$inferSelect) {
  return {
    ...item,
    data: parseData(item.data),
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /items?familyId=xxx&type=subscription
itemsRoutes.get("/", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  const type = c.req.query("type");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);
  if (!type) return c.json({ error: "type query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const userId = c.get("userId")!;
  const db = getDb(c.env);

  // Visibility filter: return family-visible items OR items owned by the current user.
  const rows = await db
    .select()
    .from(schema.items)
    .where(
      and(
        eq(schema.items.familyId, familyId),
        eq(schema.items.type, type),
        eq(schema.items.status, "active"),
        or(
          eq(schema.items.visibility, "family"),
          eq(schema.items.ownerUserId, userId),
        ),
      ),
    );

  return c.json({ items: rows.map(serializeItem) });
});

// POST /items
itemsRoutes.post("/", requireSession, zv(createItemSchema), async (c) => {
  const userId = c.get("userId")!;
  const body = c.req.valid("json");

  const membership = await requireFamilyMember(c, body.familyId);
  if (membership instanceof Response) return membership;

  // Validate data against module registry if the module is known.
  if (body.data !== undefined) {
    const mod = getModule(body.type);
    if (mod) {
      const result = mod.schema.safeParse(body.data);
      if (!result.success) {
        return c.json(
          { error: "validation_error", issues: result.error.issues },
          400,
        );
      }
    }
  }

  const db = getDb(c.env);
  const itemId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const dataJson =
    body.data !== undefined ? JSON.stringify(body.data) : null;

  const searchText = buildSearchText(body.title, body.type, body.data ?? null);

  await db.insert(schema.items).values({
    id: itemId,
    familyId: body.familyId,
    type: body.type,
    ownerUserId: userId,
    title: body.title,
    dueDate: body.dueDate ?? null,
    amountCents: body.amountCents ?? null,
    data: dataJson,
    visibility: body.visibility ?? "family",
    status: "active",
    searchText,
    createdAt: now,
    updatedAt: now,
  });

  await audit(c, {
    familyId: body.familyId,
    action: body.type + ".created",
    targetType: "item",
    targetId: itemId,
    meta: { title: body.title, type: body.type },
    visibility: body.visibility ?? "family",
  });

  const item = await db
    .select()
    .from(schema.items)
    .where(eq(schema.items.id, itemId))
    .get();

  return c.json({ item: item ? serializeItem(item) : null }, 201);
});

// GET /items/:id
itemsRoutes.get("/:id", requireSession, async (c) => {
  const { id: itemId } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const item = await db
    .select()
    .from(schema.items)
    .where(eq(schema.items.id, itemId))
    .get();

  if (!item) return c.json({ error: "not_found" }, 404);

  // Must be a family member first.
  const membership = await requireFamilyMember(c, item.familyId);
  if (membership instanceof Response) return membership;

  // Private items: only the ownerUserId may see them (return 404 to avoid disclosing namespace).
  if (item.visibility === "private" && item.ownerUserId !== userId) {
    return c.json({ error: "not_found" }, 404);
  }

  await audit(c, {
    familyId: item.familyId,
    action: item.type + ".viewed",
    targetType: "item",
    targetId: itemId,
    visibility: item.visibility as "family" | "private",
  });

  return c.json({ item: serializeItem(item) });
});

// PATCH /items/:id
itemsRoutes.patch("/:id", requireSession, zv(updateItemSchema), async (c) => {
  const { id: itemId } = c.req.param();
  const updates = c.req.valid("json");
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const item = await db
    .select()
    .from(schema.items)
    .where(eq(schema.items.id, itemId))
    .get();

  if (!item) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, item.familyId);
  if (membership instanceof Response) return membership;

  // Private items: only the owner may update (return 404 to avoid disclosing namespace).
  if (item.visibility === "private" && item.ownerUserId !== userId) {
    return c.json({ error: "not_found" }, 404);
  }

  // Validate updated data against module registry if provided.
  if (updates.data !== undefined) {
    const mod = getModule(item.type);
    if (mod) {
      const result = mod.schema.safeParse(updates.data);
      if (!result.success) {
        return c.json(
          { error: "validation_error", issues: result.error.issues },
          400,
        );
      }
    }
  }

  const now = Math.floor(Date.now() / 1000);

  // Compute effective values for searchText derivation.
  const effectiveTitle = updates.title !== undefined ? updates.title : item.title;
  const effectiveData =
    updates.data !== undefined ? updates.data : parseData(item.data);

  const set: Partial<typeof schema.items.$inferInsert> = {
    updatedAt: now,
    searchText: buildSearchText(effectiveTitle, item.type, effectiveData),
  };

  if (updates.title !== undefined) set.title = updates.title;
  if (updates.dueDate !== undefined) set.dueDate = updates.dueDate;
  if (updates.amountCents !== undefined) set.amountCents = updates.amountCents;
  if (updates.data !== undefined) set.data = JSON.stringify(updates.data);
  if (updates.visibility !== undefined) set.visibility = updates.visibility;
  if (updates.status !== undefined) {
    set.status = updates.status;
    if (updates.status === "trashed") {
      set.trashedAt = now;
    }
  }

  await db.update(schema.items).set(set).where(eq(schema.items.id, itemId));

  await audit(c, {
    familyId: item.familyId,
    action: item.type + ".updated",
    targetType: "item",
    targetId: itemId,
    meta: { title: effectiveTitle },
    visibility: (updates.visibility ?? item.visibility) as "family" | "private",
  });

  const updatedItem = await db
    .select()
    .from(schema.items)
    .where(eq(schema.items.id, itemId))
    .get();

  return c.json({ item: updatedItem ? serializeItem(updatedItem) : null });
});

// DELETE /items/:id (hard delete)
itemsRoutes.delete("/:id", requireSession, async (c) => {
  const { id: itemId } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const item = await db
    .select()
    .from(schema.items)
    .where(eq(schema.items.id, itemId))
    .get();

  if (!item) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, item.familyId);
  if (membership instanceof Response) return membership;

  // Private items: only the owner may delete (return 404 to avoid disclosing namespace).
  if (item.visibility === "private" && item.ownerUserId !== userId) {
    return c.json({ error: "not_found" }, 404);
  }

  await db.delete(schema.items).where(eq(schema.items.id, itemId));

  await audit(c, {
    familyId: item.familyId,
    action: item.type + ".deleted",
    targetType: "item",
    targetId: itemId,
    meta: { title: item.title, type: item.type },
    visibility: item.visibility as "family" | "private",
  });

  return c.json({ ok: true });
});
