/**
 * Per-family expense settings, plus the module's idempotent bootstrap.
 *
 * Settings are family-wide (they change how money reads for everyone), so
 * updating them requires admin or owner. Categories and payment methods stay
 * member-editable — those are collaborative day-to-day config, like tasks.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { ensureExpenseSetup } from "../lib/expenses/defaults";
import {
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCY_CODES,
  isSupportedCurrency,
} from "../../shared/money";

export const expenseSettingsRoutes = new Hono<HonoEnv>();

// ── Validation schemas ────────────────────────────────────────────────────────

const updateSettingsSchema = z.object({
  familyId: z.string().min(1),
  // Only currencies the app can actually format. V1 does no conversion.
  defaultCurrency: z
    .string()
    .refine(isSupportedCurrency, {
      message: `Must be one of: ${SUPPORTED_CURRENCY_CODES.join(", ")}`,
    })
    .optional(),
  weekStartsOn: z.number().int().min(0).max(6).optional(),
  // 1–28 only: every month has a 28th, so a salary-cycle period never skips.
  monthStartDay: z.number().int().min(1).max(28).optional(),
});

const bootstrapSchema = z.object({ familyId: z.string().min(1) });

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

/** Values a family gets before it has ever saved settings. */
const DEFAULTS = {
  defaultCurrency: DEFAULT_CURRENCY,
  weekStartsOn: 1, // Monday
  monthStartDay: 1,
};

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /expense-settings?familyId=:id
 *
 * Never writes. A family that hasn't bootstrapped yet gets the defaults with
 * `initialized: false`, which is how the UI knows to offer setup.
 */
expenseSettingsRoutes.get("/", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const row = await db
    .select({
      familyId: schema.expenseSettings.familyId,
      defaultCurrency: schema.expenseSettings.defaultCurrency,
      weekStartsOn: schema.expenseSettings.weekStartsOn,
      monthStartDay: schema.expenseSettings.monthStartDay,
    })
    .from(schema.expenseSettings)
    .where(eq(schema.expenseSettings.familyId, familyId))
    .get();

  return c.json({
    settings: row ?? { familyId, ...DEFAULTS },
    initialized: Boolean(row),
    // The UI disables the controls rather than letting a member hit a 403.
    canEdit: membership.role === "owner" || membership.role === "admin",
  });
});

/** PATCH /expense-settings — owner/admin only; upserts the family's row. */
expenseSettingsRoutes.patch("/", requireSession, zv(updateSettingsSchema), async (c) => {
  const { familyId, ...updates } = c.req.valid("json");

  const membership = await requireFamilyMember(c, familyId, "admin");
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const now = Math.floor(Date.now() / 1000);

  const existing = await db
    .select({ familyId: schema.expenseSettings.familyId })
    .from(schema.expenseSettings)
    .where(eq(schema.expenseSettings.familyId, familyId))
    .get();

  if (existing) {
    const set: Partial<typeof schema.expenseSettings.$inferInsert> = { updatedAt: now };
    if (updates.defaultCurrency !== undefined) set.defaultCurrency = updates.defaultCurrency;
    if (updates.weekStartsOn !== undefined) set.weekStartsOn = updates.weekStartsOn;
    if (updates.monthStartDay !== undefined) set.monthStartDay = updates.monthStartDay;

    await db
      .update(schema.expenseSettings)
      .set(set)
      .where(eq(schema.expenseSettings.familyId, familyId));
  } else {
    await db.insert(schema.expenseSettings).values({
      familyId,
      defaultCurrency: updates.defaultCurrency ?? DEFAULTS.defaultCurrency,
      weekStartsOn: updates.weekStartsOn ?? DEFAULTS.weekStartsOn,
      monthStartDay: updates.monthStartDay ?? DEFAULTS.monthStartDay,
      updatedAt: now,
    });
  }

  const settings = await db
    .select({
      familyId: schema.expenseSettings.familyId,
      defaultCurrency: schema.expenseSettings.defaultCurrency,
      weekStartsOn: schema.expenseSettings.weekStartsOn,
      monthStartDay: schema.expenseSettings.monthStartDay,
    })
    .from(schema.expenseSettings)
    .where(eq(schema.expenseSettings.familyId, familyId))
    .get();

  return c.json({ settings, initialized: true, canEdit: true });
});

/**
 * POST /expense-settings/bootstrap — install the default categories, payment
 * methods and settings for a family.
 *
 * Idempotent (Phase A's ensureExpenseSetup): safe to call on every visit, and
 * concurrent calls cannot duplicate rows. Deliberately a POST — a GET must
 * never create data.
 */
expenseSettingsRoutes.post("/bootstrap", requireSession, zv(bootstrapSchema), async (c) => {
  const { familyId } = c.req.valid("json");

  const membership = await requireFamilyMember(c, familyId);
  if (membership instanceof Response) return membership;

  const setup = await ensureExpenseSetup(getDb(c.env), familyId);

  return c.json({ setup });
});
