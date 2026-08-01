/**
 * Expense categories and subcategories.
 *
 * One self-referencing table, capped at TWO levels: a top-level category and
 * its subcategories. Every rule below is enforced server-side — the client is
 * never trusted with the hierarchy.
 *
 * Categories are ARCHIVED, never deleted, whenever history could reference
 * them: an expense recorded against "Coffee" must stay resolvable and
 * analyzable forever, even after the family stops using that category.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import type { Db } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { CATEGORY_COLORS } from "../lib/expenses/defaults";
import { childSlugBase, ensureUniqueSlug, slugify } from "../lib/expenses/slug";

export const expenseCategoryRoutes = new Hono<HonoEnv>();

// ── Validation schemas ────────────────────────────────────────────────────────

// Emoji can be long ZWJ sequences ("👨‍👩‍👧‍👦" is 11 UTF-16 units).
const emoji = z.string().max(24);
const color = z.enum(CATEGORY_COLORS);
const sortOrder = z.number().int().min(0).max(100_000);

const createCategorySchema = z.object({
  familyId: z.string().min(1),
  name: z.string().min(1).max(60),
  emoji: emoji.optional(),
  color: color.optional(),
  /** Omit for a top-level category; set to create a subcategory. */
  parentId: z.string().min(1).optional(),
  sortOrder: sortOrder.optional(),
});

// NOTE: `parentId` is deliberately NOT updatable — see the PATCH handler.
const updateCategorySchema = z.object({
  name: z.string().min(1).max(60).optional(),
  emoji: emoji.nullable().optional(),
  color: color.nullable().optional(),
  sortOrder: sortOrder.optional(),
  status: z.enum(["active", "archived"]).optional(),
});

const reorderSchema = z.object({
  familyId: z.string().min(1),
  items: z
    .array(z.object({ id: z.string().min(1), sortOrder }))
    .min(1)
    .max(200),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Every slug already used in this family — the uniqueness namespace is flat. */
async function takenSlugs(db: Db, familyId: string): Promise<Set<string>> {
  const rows = await db
    .select({ slug: schema.expenseCategories.slug })
    .from(schema.expenseCategories)
    .where(eq(schema.expenseCategories.familyId, familyId));
  return new Set(rows.map((r) => r.slug));
}

/** Next sort order after the current last sibling, leaving room to insert. */
async function nextSortOrder(
  db: Db,
  familyId: string,
  parentId: string | null,
): Promise<number> {
  const siblings = await db
    .select({ sortOrder: schema.expenseCategories.sortOrder })
    .from(schema.expenseCategories)
    .where(
      and(
        eq(schema.expenseCategories.familyId, familyId),
        parentId === null
          ? isNull(schema.expenseCategories.parentId)
          : eq(schema.expenseCategories.parentId, parentId),
      ),
    );

  const max = siblings.reduce((m, s) => Math.max(m, s.sortOrder), -10);
  return Math.min(max + 10, 100_000);
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /expense-categories?familyId=:id&includeArchived=1
 *
 * Returns the ready-to-render two-level tree so the client never has to
 * reconstruct the hierarchy. Archived rows are excluded unless asked for.
 */
expenseCategoryRoutes.get("/", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const includeArchived = c.req.query("includeArchived") === "1";
  const db = getDb(c.env);

  const conditions = [eq(schema.expenseCategories.familyId, familyId)];
  if (!includeArchived) {
    conditions.push(eq(schema.expenseCategories.status, "active"));
  }

  const rows = await db
    .select({
      id: schema.expenseCategories.id,
      parentId: schema.expenseCategories.parentId,
      name: schema.expenseCategories.name,
      slug: schema.expenseCategories.slug,
      emoji: schema.expenseCategories.emoji,
      color: schema.expenseCategories.color,
      sortOrder: schema.expenseCategories.sortOrder,
      isSystem: schema.expenseCategories.isSystem,
      status: schema.expenseCategories.status,
    })
    .from(schema.expenseCategories)
    .where(and(...(conditions as [(typeof conditions)[0], ...typeof conditions])))
    .orderBy(asc(schema.expenseCategories.sortOrder), asc(schema.expenseCategories.name));

  const parents = rows.filter((r) => r.parentId === null);
  const childrenByParent = new Map<string, typeof rows>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const list = childrenByParent.get(row.parentId) ?? [];
    list.push(row);
    childrenByParent.set(row.parentId, list);
  }

  const categories = parents.map((p) => ({
    ...p,
    children: childrenByParent.get(p.id) ?? [],
  }));

  return c.json({ categories });
});

/** POST /expense-categories — create a category, or a subcategory when parentId is set. */
expenseCategoryRoutes.post("/", requireSession, zv(createCategorySchema), async (c) => {
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);

  let parent: { id: string; slug: string; parentId: string | null; status: string } | undefined;
  if (data.parentId) {
    // Cross-family guard: the parent must belong to THIS family.
    parent = await db
      .select({
        id: schema.expenseCategories.id,
        slug: schema.expenseCategories.slug,
        parentId: schema.expenseCategories.parentId,
        status: schema.expenseCategories.status,
      })
      .from(schema.expenseCategories)
      .where(
        and(
          eq(schema.expenseCategories.id, data.parentId),
          eq(schema.expenseCategories.familyId, data.familyId),
        ),
      )
      .get();

    if (!parent) return c.json({ error: "invalid_parent_category" }, 400);
    // Depth cap: a subcategory can never itself be a parent.
    if (parent.parentId !== null) return c.json({ error: "max_category_depth" }, 400);
    if (parent.status !== "active") return c.json({ error: "parent_archived" }, 400);
  }

  const taken = await takenSlugs(db, data.familyId);
  const base = parent ? childSlugBase(parent.slug, data.name) : slugify(data.name);
  const slug = ensureUniqueSlug(base, taken);

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(schema.expenseCategories).values({
    id,
    familyId: data.familyId,
    parentId: parent?.id ?? null,
    name: data.name.trim(),
    slug,
    emoji: data.emoji,
    // Subcategories inherit their parent's colour unless told otherwise.
    color: data.color ?? null,
    sortOrder: data.sortOrder ?? (await nextSortOrder(db, data.familyId, parent?.id ?? null)),
    isSystem: false,
    updatedAt: now,
  });

  const category = await db
    .select()
    .from(schema.expenseCategories)
    .where(eq(schema.expenseCategories.id, id))
    .get();

  return c.json({ category }, 201);
});

/**
 * PATCH /expense-categories/:id — rename, re-emoji, recolour, reorder, or
 * archive/restore.
 *
 * `parentId` is intentionally immutable. Expenses denormalize BOTH
 * `category_id` and `subcategory_id`, with the invariant that the subcategory's
 * parent is the category. Re-parenting a subcategory would silently invalidate
 * that on every historical row. Moving spending between categories is a
 * different (and explicit) operation, not a side effect of an edit.
 */
expenseCategoryRoutes.patch("/:id", requireSession, zv(updateCategorySchema), async (c) => {
  const { id } = c.req.param();
  const updates = c.req.valid("json");
  const db = getDb(c.env);

  const category = await db
    .select()
    .from(schema.expenseCategories)
    .where(eq(schema.expenseCategories.id, id))
    .get();

  if (!category) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, category.familyId);
  if (membership instanceof Response) return membership;

  // Restoring a subcategory under an archived parent would make it
  // unreachable — the parent has to come back first.
  if (updates.status === "active" && category.parentId !== null) {
    const parent = await db
      .select({ status: schema.expenseCategories.status })
      .from(schema.expenseCategories)
      .where(eq(schema.expenseCategories.id, category.parentId))
      .get();
    if (parent && parent.status !== "active") {
      return c.json({ error: "parent_archived" }, 400);
    }
  }

  const set: Partial<typeof schema.expenseCategories.$inferInsert> = {
    updatedAt: Math.floor(Date.now() / 1000),
  };
  // Renaming never changes the slug — see lib/expenses/slug.ts.
  if (updates.name !== undefined) set.name = updates.name.trim();
  if (updates.emoji !== undefined) set.emoji = updates.emoji;
  if (updates.color !== undefined) set.color = updates.color;
  if (updates.sortOrder !== undefined) set.sortOrder = updates.sortOrder;
  if (updates.status !== undefined) set.status = updates.status;

  await db
    .update(schema.expenseCategories)
    .set(set)
    .where(eq(schema.expenseCategories.id, id));

  // Archiving a parent archives its subcategories: leaving them active would
  // offer selectable children of a category that no longer exists in the UI.
  if (updates.status === "archived" && category.parentId === null) {
    await db
      .update(schema.expenseCategories)
      .set({ status: "archived", updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(schema.expenseCategories.parentId, id));
  }

  const updated = await db
    .select()
    .from(schema.expenseCategories)
    .where(eq(schema.expenseCategories.id, id))
    .get();

  return c.json({ category: updated });
});

/** POST /expense-categories/reorder — persist a new sibling order. */
expenseCategoryRoutes.post("/reorder", requireSession, zv(reorderSchema), async (c) => {
  const { familyId, items } = c.req.valid("json");

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const ids = items.map((i) => i.id);

  // Every id must belong to this family — never reorder someone else's rows.
  const owned = await db
    .select({ id: schema.expenseCategories.id })
    .from(schema.expenseCategories)
    .where(
      and(
        eq(schema.expenseCategories.familyId, familyId),
        inArray(schema.expenseCategories.id, ids),
      ),
    );

  if (owned.length !== new Set(ids).size) {
    return c.json({ error: "invalid_category_ids" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  for (const item of items) {
    await db
      .update(schema.expenseCategories)
      .set({ sortOrder: item.sortOrder, updatedAt: now })
      .where(eq(schema.expenseCategories.id, item.id));
  }

  return c.json({ ok: true });
});

/**
 * DELETE /expense-categories/:id — hard delete, allowed ONLY when nothing can
 * be lost by it: a custom, childless category with no expenses ever recorded
 * against it. Anything else must be archived instead, so history stays
 * analyzable. This is the escape hatch for a mistyped category, not a way to
 * erase spending.
 */
expenseCategoryRoutes.delete("/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const db = getDb(c.env);

  const category = await db
    .select()
    .from(schema.expenseCategories)
    .where(eq(schema.expenseCategories.id, id))
    .get();

  if (!category) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, category.familyId);
  if (membership instanceof Response) return membership;

  if (category.isSystem) {
    return c.json({ error: "cannot_delete_system_category" }, 403);
  }

  const child = await db
    .select({ id: schema.expenseCategories.id })
    .from(schema.expenseCategories)
    .where(eq(schema.expenseCategories.parentId, id))
    .get();
  if (child) return c.json({ error: "category_has_children" }, 400);

  // Referenced as either the category or the subcategory of any expense —
  // including trashed ones, which can still be restored.
  const used = await db
    .select({ id: schema.expenses.id })
    .from(schema.expenses)
    .where(
      or(eq(schema.expenses.categoryId, id), eq(schema.expenses.subcategoryId, id)),
    )
    .get();
  if (used) return c.json({ error: "category_in_use" }, 400);

  await db.delete(schema.expenseCategories).where(eq(schema.expenseCategories.id, id));

  return c.json({ ok: true });
});
