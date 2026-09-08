/**
 * Family labels — list / create / update / delete type & category chips.
 *
 * Built-in catalogs live in code; this API persists family customs (and
 * optional overrides of a built-in slug's label/emoji).
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { checkRateLimit } from "../lib/rateLimit";
import {
  isLabelDomain,
  labelEmojiSchema,
  labelNameSchema,
  labelSlugSchema,
  mergeLabels,
  slugifyLabel,
  type LabelDomain,
} from "../lib/labels";

export const labelRoutes = new Hono<HonoEnv>();

const createLabelSchema = z.object({
  familyId: z.string().min(1),
  domain: z.enum(schema.LABEL_DOMAINS),
  label: labelNameSchema,
  emoji: labelEmojiSchema,
  // Optional — derived from label when omitted.
  slug: labelSlugSchema.optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

const updateLabelSchema = z.object({
  label: labelNameSchema.optional(),
  emoji: labelEmojiSchema.optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

async function uniqueSlug(
  db: ReturnType<typeof getDb>,
  familyId: string,
  domain: LabelDomain,
  desired: string,
): Promise<string> {
  let candidate = desired.slice(0, 50);
  for (let i = 0; i < 8; i++) {
    const existing = await db
      .select({ id: schema.familyLabels.id })
      .from(schema.familyLabels)
      .where(
        and(
          eq(schema.familyLabels.familyId, familyId),
          eq(schema.familyLabels.domain, domain),
          eq(schema.familyLabels.slug, candidate),
        ),
      )
      .get();
    if (!existing) return candidate;
    const suffix = `_${(i + 2).toString(36)}`;
    candidate = `${desired.slice(0, 50 - suffix.length)}${suffix}`;
  }
  return `${desired.slice(0, 40)}_${crypto.randomUUID().slice(0, 8)}`;
}

// GET /labels?familyId=&domain= — built-ins merged with family customs.
labelRoutes.get("/", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);
  const domainRaw = c.req.query("domain");
  if (!domainRaw || !isLabelDomain(domainRaw)) {
    return c.json({ error: "domain query param required" }, 400);
  }
  const domain = domainRaw;

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const rows = await db
    .select({
      id: schema.familyLabels.id,
      slug: schema.familyLabels.slug,
      label: schema.familyLabels.label,
      emoji: schema.familyLabels.emoji,
      sortOrder: schema.familyLabels.sortOrder,
    })
    .from(schema.familyLabels)
    .where(
      and(
        eq(schema.familyLabels.familyId, familyId),
        eq(schema.familyLabels.domain, domain),
      ),
    )
    .orderBy(asc(schema.familyLabels.sortOrder), asc(schema.familyLabels.label));

  return c.json({ domain, labels: mergeLabels(domain, rows) });
});

// POST /labels — create a custom label (or override a built-in's emoji/label).
labelRoutes.post("/", requireSession, zv(createLabelSchema), async (c) => {
  const userId = c.get("userId")!;
  const body = c.req.valid("json");

  const membership = await requireFamilyMember(c, body.familyId);
  if (membership instanceof Response) return membership;

  const limited = await checkRateLimit(c, `labels:${userId}`, {
    limit: 30,
    windowSecs: 60,
  });
  if (limited) return limited;

  const db = getDb(c.env);
  const baseSlug = body.slug ?? slugifyLabel(body.label);
  const slug = await uniqueSlug(db, body.familyId, body.domain, baseSlug);

  // Cap how many customs a family can pile on (abuse / UI noise).
  const countRow = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.familyLabels)
    .where(
      and(
        eq(schema.familyLabels.familyId, body.familyId),
        eq(schema.familyLabels.domain, body.domain),
      ),
    )
    .get();
  const customCount = Number(countRow?.n ?? 0);
  if (customCount >= 50) {
    return c.json({ error: "label_limit" }, 400);
  }

  const id = crypto.randomUUID();
  const sortOrder = body.sortOrder ?? Math.max(0, customCount + 100);

  await db.insert(schema.familyLabels).values({
    id,
    familyId: body.familyId,
    domain: body.domain,
    slug,
    label: body.label.trim(),
    emoji: body.emoji.trim(),
    sortOrder,
    createdBy: userId,
  });

  const row = await db
    .select()
    .from(schema.familyLabels)
    .where(eq(schema.familyLabels.id, id))
    .get();

  return c.json(
    {
      label: {
        id: row!.id,
        slug: row!.slug,
        label: row!.label,
        emoji: row!.emoji ?? "📌",
        sortOrder: row!.sortOrder,
        builtin: false,
        custom: true,
      },
    },
    201,
  );
});

// PATCH /labels/:id
labelRoutes.patch("/:id", requireSession, zv(updateLabelSchema), async (c) => {
  const id = c.req.param("id");
  const updates = c.req.valid("json");
  if (
    updates.label === undefined &&
    updates.emoji === undefined &&
    updates.sortOrder === undefined
  ) {
    return c.json({ error: "validation_error", issues: [] }, 400);
  }

  const db = getDb(c.env);
  const existing = await db
    .select()
    .from(schema.familyLabels)
    .where(eq(schema.familyLabels.id, id))
    .get();
  if (!existing) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, existing.familyId);
  if (membership instanceof Response) return membership;

  await db
    .update(schema.familyLabels)
    .set({
      ...(updates.label !== undefined ? { label: updates.label.trim() } : {}),
      ...(updates.emoji !== undefined ? { emoji: updates.emoji.trim() } : {}),
      ...(updates.sortOrder !== undefined ? { sortOrder: updates.sortOrder } : {}),
    })
    .where(eq(schema.familyLabels.id, id));

  const row = await db
    .select()
    .from(schema.familyLabels)
    .where(eq(schema.familyLabels.id, id))
    .get();

  return c.json({
    label: {
      id: row!.id,
      slug: row!.slug,
      label: row!.label,
      emoji: row!.emoji ?? "📌",
      sortOrder: row!.sortOrder,
      builtin: false,
      custom: true,
    },
  });
});

// DELETE /labels/:id — removes the custom row (entities keep their slug).
labelRoutes.delete("/:id", requireSession, async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env);
  const existing = await db
    .select()
    .from(schema.familyLabels)
    .where(eq(schema.familyLabels.id, id))
    .get();
  if (!existing) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, existing.familyId);
  if (membership instanceof Response) return membership;

  await db.delete(schema.familyLabels).where(eq(schema.familyLabels.id, id));
  return c.json({ ok: true });
});
