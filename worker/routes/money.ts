import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { insertAuditEvent } from "../lib/audit";
import {
  MONEY_MOVEMENT_TYPES,
  SETTLEMENT_DESTINATION_KINDS,
  computeBalances,
  fromCents,
  settledByDestination,
  toCents,
} from "../lib/settlements";

export const moneyRoutes = new Hono<HonoEnv>();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-mm-dd");
const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Must be a 3-letter currency code");

const createDestinationSchema = z.object({
  familyId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(SETTLEMENT_DESTINATION_KINDS).optional().default("other"),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

// Defaults stay OFF the shared field set so PATCH .partial() does not refill them.
const destinationFieldsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(SETTLEMENT_DESTINATION_KINDS),
  sortOrder: z.number().int().min(0).max(10_000),
  archived: z.boolean(),
});

const updateDestinationSchema = destinationFieldsSchema.partial();

const createMovementFieldsSchema = z.object({
  familyId: z.string().min(1),
  type: z.enum(MONEY_MOVEMENT_TYPES),
  amount: z.number().finite().positive().max(10_000_000),
  currency: currencySchema.optional(),
  note: z.string().max(500).optional(),
  movedOn: isoDate.optional(),
  destinationId: z.string().min(1).optional(),
});

const createMovementSchema = createMovementFieldsSchema.superRefine(
  (data, ctx) => {
    if (data.type === "settled" && !data.destinationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "destinationId is required when type is settled",
        path: ["destinationId"],
      });
    }
    if (data.type === "received" && data.destinationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "destinationId must be omitted when type is received",
        path: ["destinationId"],
      });
    }
  },
);

const updateMovementFieldsSchema = z.object({
  amount: z.number().finite().positive().max(10_000_000),
  currency: currencySchema,
  note: z.string().max(500).nullable(),
  movedOn: isoDate,
  destinationId: z.string().min(1).nullable(),
});

const updateMovementSchema = updateMovementFieldsSchema.partial();

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json(
        { error: "validation_error", issues: result.error.issues },
        400,
      );
  });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function serializeDestination(
  row: typeof schema.settlementDestinations.$inferSelect,
  settledCents = 0,
) {
  return {
    id: row.id,
    familyId: row.familyId,
    name: row.name,
    kind: row.kind,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    settledCents,
    settled: fromCents(settledCents),
  };
}

function serializeMovement(
  row: typeof schema.moneyMovements.$inferSelect,
  destinationName: string | null = null,
  createdByName: string | null = null,
) {
  return {
    id: row.id,
    familyId: row.familyId,
    type: row.type,
    destinationId: row.destinationId,
    destinationName,
    amountCents: row.amountCents,
    amount: fromCents(row.amountCents),
    currency: row.currency,
    note: row.note,
    movedOn: row.movedOn,
    createdBy: row.createdBy,
    createdByName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadFamilyMovements(
  db: ReturnType<typeof getDb>,
  familyId: string,
) {
  return db
    .select({
      id: schema.moneyMovements.id,
      familyId: schema.moneyMovements.familyId,
      type: schema.moneyMovements.type,
      destinationId: schema.moneyMovements.destinationId,
      amountCents: schema.moneyMovements.amountCents,
      currency: schema.moneyMovements.currency,
      note: schema.moneyMovements.note,
      movedOn: schema.moneyMovements.movedOn,
      createdBy: schema.moneyMovements.createdBy,
      createdAt: schema.moneyMovements.createdAt,
      updatedAt: schema.moneyMovements.updatedAt,
      // Alias both `name` columns — the node:sqlite D1 adapter maps
      // duplicate result names positionally and would otherwise clobber.
      destinationName: sql<string | null>`${schema.settlementDestinations.name}`.as(
        "destination_name",
      ),
      createdByName: sql<string | null>`${schema.users.name}`.as(
        "created_by_name",
      ),
    })
    .from(schema.moneyMovements)
    .leftJoin(
      schema.settlementDestinations,
      eq(schema.moneyMovements.destinationId, schema.settlementDestinations.id),
    )
    .leftJoin(
      schema.users,
      eq(schema.moneyMovements.createdBy, schema.users.id),
    )
    .where(eq(schema.moneyMovements.familyId, familyId))
    .orderBy(
      desc(schema.moneyMovements.movedOn),
      desc(sql`"money_movements".rowid`),
    );
}

async function assertDestinationInFamily(
  db: ReturnType<typeof getDb>,
  destinationId: string,
  familyId: string,
) {
  const dest = await db
    .select()
    .from(schema.settlementDestinations)
    .where(eq(schema.settlementDestinations.id, destinationId))
    .get();
  if (!dest || dest.familyId !== familyId) {
    return null;
  }
  return dest;
}

// GET /money/summary?familyId=:id — balances + destinations + recent movements
moneyRoutes.get("/summary", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId, "member", "expenses");
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const includeArchived = c.req.query("includeArchived") === "1";

  const destConditions = [eq(schema.settlementDestinations.familyId, familyId)];
  if (!includeArchived) {
    destConditions.push(isNull(schema.settlementDestinations.archivedAt));
  }

  const destinations = await db
    .select()
    .from(schema.settlementDestinations)
    .where(
      and(
        ...(destConditions as [
          typeof destConditions[0],
          ...typeof destConditions,
        ]),
      ),
    )
    .orderBy(
      asc(schema.settlementDestinations.sortOrder),
      asc(schema.settlementDestinations.name),
    );

  const movements = await loadFamilyMovements(db, familyId);
  const balances = computeBalances(movements);
  const byDest = settledByDestination(movements);
  const currency = movements[0]?.currency ?? "INR";

  return c.json({
    currency,
    ...balances,
    destinations: destinations.map((d) =>
      serializeDestination(d, byDest.get(d.id) ?? 0),
    ),
    movements: movements.map((m) =>
      serializeMovement(m, m.destinationName, m.createdByName),
    ),
  });
});

// GET /money/destinations?familyId=:id
moneyRoutes.get("/destinations", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId, "member", "expenses");
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const includeArchived = c.req.query("includeArchived") === "1";
  const destConditions = [eq(schema.settlementDestinations.familyId, familyId)];
  if (!includeArchived) {
    destConditions.push(isNull(schema.settlementDestinations.archivedAt));
  }

  const destinations = await db
    .select()
    .from(schema.settlementDestinations)
    .where(
      and(
        ...(destConditions as [
          typeof destConditions[0],
          ...typeof destConditions,
        ]),
      ),
    )
    .orderBy(
      asc(schema.settlementDestinations.sortOrder),
      asc(schema.settlementDestinations.name),
    );

  const movements = await db
    .select({
      type: schema.moneyMovements.type,
      amountCents: schema.moneyMovements.amountCents,
      destinationId: schema.moneyMovements.destinationId,
    })
    .from(schema.moneyMovements)
    .where(eq(schema.moneyMovements.familyId, familyId));
  const byDest = settledByDestination(movements);

  return c.json({
    destinations: destinations.map((d) =>
      serializeDestination(d, byDest.get(d.id) ?? 0),
    ),
  });
});

// POST /money/destinations
moneyRoutes.post(
  "/destinations",
  requireSession,
  zv(createDestinationSchema),
  async (c) => {
    const userId = c.get("userId")!;
    const data = c.req.valid("json");

    const membership = await requireFamilyMember(c, data.familyId, "member", "expenses");
    if (membership instanceof Response) return membership;

    const db = getDb(c.env);
    const name = data.name.trim();

    const existing = await db
      .select()
      .from(schema.settlementDestinations)
      .where(
        and(
          eq(schema.settlementDestinations.familyId, data.familyId),
          isNull(schema.settlementDestinations.archivedAt),
        ),
      );

    const clash = existing.find(
      (d) => d.name.toLowerCase() === name.toLowerCase(),
    );
    if (clash) {
      return c.json({ error: "destination_exists", id: clash.id }, 409);
    }

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const sortOrder =
      data.sortOrder ??
      (existing.length === 0
        ? 0
        : Math.max(...existing.map((d) => d.sortOrder)) + 1);

    await db.insert(schema.settlementDestinations).values({
      id,
      familyId: data.familyId,
      name,
      kind: data.kind,
      sortOrder,
      createdBy: userId,
      updatedAt: now,
    });

    await insertAuditEvent(db, {
      familyId: data.familyId,
      actorUserId: userId,
      action: "settlement_destination_created",
      targetType: "settlement_destination",
      targetId: id,
      meta: { name, kind: data.kind },
    });

    const row = await db
      .select()
      .from(schema.settlementDestinations)
      .where(eq(schema.settlementDestinations.id, id))
      .get();

    return c.json(
      { destination: row ? serializeDestination(row) : row },
      201,
    );
  },
);

// PATCH /money/destinations/:id
moneyRoutes.patch(
  "/destinations/:id",
  requireSession,
  zv(updateDestinationSchema),
  async (c) => {
    const { id } = c.req.param();
    const userId = c.get("userId")!;
    const updates = c.req.valid("json");
    const db = getDb(c.env);

    const dest = await db
      .select()
      .from(schema.settlementDestinations)
      .where(eq(schema.settlementDestinations.id, id))
      .get();
    if (!dest) return c.json({ error: "not_found" }, 404);

    const membership = await requireFamilyMember(c, dest.familyId, "member", "expenses");
    if (membership instanceof Response) return membership;

    if (dest.createdBy !== userId && membership.role === "member") {
      return c.json({ error: "forbidden" }, 403);
    }

    const willBeActive =
      updates.archived === false ||
      (updates.archived === undefined && dest.archivedAt === null);
    const nextName =
      updates.name !== undefined ? updates.name.trim() : dest.name;

    if (willBeActive) {
      const siblings = await db
        .select()
        .from(schema.settlementDestinations)
        .where(
          and(
            eq(schema.settlementDestinations.familyId, dest.familyId),
            isNull(schema.settlementDestinations.archivedAt),
          ),
        );
      const clash = siblings.find(
        (d) =>
          d.id !== id &&
          d.name.toLowerCase() === nextName.toLowerCase(),
      );
      if (clash) {
        return c.json({ error: "destination_exists", id: clash.id }, 409);
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const set: Partial<typeof schema.settlementDestinations.$inferInsert> = {
      updatedAt: now,
    };
    if (updates.name !== undefined) set.name = nextName;
    if (updates.kind !== undefined) set.kind = updates.kind;
    if (updates.sortOrder !== undefined) set.sortOrder = updates.sortOrder;
    if (updates.archived !== undefined) {
      set.archivedAt = updates.archived ? now : null;
    }

    await db
      .update(schema.settlementDestinations)
      .set(set)
      .where(eq(schema.settlementDestinations.id, id));

    const updated = await db
      .select()
      .from(schema.settlementDestinations)
      .where(eq(schema.settlementDestinations.id, id))
      .get();

    return c.json({
      destination: updated ? serializeDestination(updated) : updated,
    });
  },
);

// DELETE /money/destinations/:id — archive if used; hard-delete if unused
moneyRoutes.delete("/destinations/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const dest = await db
    .select()
    .from(schema.settlementDestinations)
    .where(eq(schema.settlementDestinations.id, id))
    .get();
  if (!dest) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, dest.familyId, "member", "expenses");
  if (membership instanceof Response) return membership;

  if (dest.createdBy !== userId && membership.role === "member") {
    return c.json({ error: "forbidden" }, 403);
  }

  const used = await db
    .select({ id: schema.moneyMovements.id })
    .from(schema.moneyMovements)
    .where(eq(schema.moneyMovements.destinationId, id))
    .limit(1)
    .get();

  if (used) {
    const now = Math.floor(Date.now() / 1000);
    await db
      .update(schema.settlementDestinations)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(schema.settlementDestinations.id, id));
    return c.json({ ok: true, archived: true });
  }

  await db
    .delete(schema.settlementDestinations)
    .where(eq(schema.settlementDestinations.id, id));

  await insertAuditEvent(db, {
    familyId: dest.familyId,
    actorUserId: userId,
    action: "settlement_destination_deleted",
    targetType: "settlement_destination",
    targetId: id,
    meta: { name: dest.name },
  });

  return c.json({ ok: true, archived: false });
});

// GET /money/movements?familyId=:id&destinationId=&type=
moneyRoutes.get("/movements", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);

  const membership = await requireFamilyMember(c, familyId, "member", "expenses");
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  let movements = await loadFamilyMovements(db, familyId);

  const destinationId = c.req.query("destinationId");
  const type = c.req.query("type");
  if (destinationId) {
    movements = movements.filter((m) => m.destinationId === destinationId);
  }
  if (type === "received" || type === "settled") {
    movements = movements.filter((m) => m.type === type);
  }

  const balances = computeBalances(
    await db
      .select({
        type: schema.moneyMovements.type,
        amountCents: schema.moneyMovements.amountCents,
      })
      .from(schema.moneyMovements)
      .where(eq(schema.moneyMovements.familyId, familyId)),
  );

  return c.json({
    movements: movements.map((m) =>
      serializeMovement(m, m.destinationName, m.createdByName),
    ),
    ...balances,
  });
});

// POST /money/movements
moneyRoutes.post(
  "/movements",
  requireSession,
  zv(createMovementSchema),
  async (c) => {
    const userId = c.get("userId")!;
    const data = c.req.valid("json");

    const membership = await requireFamilyMember(c, data.familyId, "member", "expenses");
    if (membership instanceof Response) return membership;

    const db = getDb(c.env);
    let destinationId: string | null = null;

    if (data.type === "settled") {
      const dest = await assertDestinationInFamily(
        db,
        data.destinationId!,
        data.familyId,
      );
      if (!dest) return c.json({ error: "invalid_destination_id" }, 400);
      if (dest.archivedAt) {
        return c.json({ error: "destination_archived" }, 400);
      }
      destinationId = dest.id;
    }

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const amountCents = toCents(data.amount);
    const currency = data.currency ?? "INR";
    const movedOn = data.movedOn ?? todayIso();

    await db.insert(schema.moneyMovements).values({
      id,
      familyId: data.familyId,
      type: data.type,
      destinationId,
      amountCents,
      currency,
      note: data.note,
      movedOn,
      createdBy: userId,
      updatedAt: now,
    });

    await insertAuditEvent(db, {
      familyId: data.familyId,
      actorUserId: userId,
      action:
        data.type === "received" ? "money_received" : "money_settled",
      targetType: "money_movement",
      targetId: id,
      meta: {
        amountCents,
        type: data.type,
        destinationId,
        note: data.note,
      },
    });

    const rows = await loadFamilyMovements(db, data.familyId);
    const row = rows.find((m) => m.id === id);
    const balances = computeBalances(rows);

    return c.json(
      {
        movement: row
          ? serializeMovement(row, row.destinationName, row.createdByName)
          : null,
        ...balances,
      },
      201,
    );
  },
);

// GET /money/movements/:id
moneyRoutes.get("/movements/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const db = getDb(c.env);

  const movement = await db
    .select()
    .from(schema.moneyMovements)
    .where(eq(schema.moneyMovements.id, id))
    .get();
  if (!movement) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, movement.familyId, "member", "expenses");
  if (membership instanceof Response) return membership;

  const rows = await loadFamilyMovements(db, movement.familyId);
  const row = rows.find((m) => m.id === id);
  return c.json({
    movement: row
      ? serializeMovement(row, row.destinationName, row.createdByName)
      : serializeMovement(movement),
  });
});

// PATCH /money/movements/:id
moneyRoutes.patch(
  "/movements/:id",
  requireSession,
  zv(updateMovementSchema),
  async (c) => {
    const { id } = c.req.param();
    const userId = c.get("userId")!;
    const updates = c.req.valid("json");
    const db = getDb(c.env);

    const movement = await db
      .select()
      .from(schema.moneyMovements)
      .where(eq(schema.moneyMovements.id, id))
      .get();
    if (!movement) return c.json({ error: "not_found" }, 404);

    const membership = await requireFamilyMember(c, movement.familyId, "member", "expenses");
    if (membership instanceof Response) return membership;

    if (movement.createdBy !== userId && membership.role === "member") {
      return c.json({ error: "forbidden" }, 403);
    }

    const nextType = movement.type;
    let nextDestinationId = movement.destinationId;

    if (updates.destinationId !== undefined) {
      if (nextType === "received") {
        if (updates.destinationId !== null) {
          return c.json({ error: "validation_error", issues: [
            {
              code: "custom",
              message: "destinationId must be null for received movements",
              path: ["destinationId"],
            },
          ] }, 400);
        }
        nextDestinationId = null;
      } else {
        if (updates.destinationId === null) {
          return c.json({ error: "validation_error", issues: [
            {
              code: "custom",
              message: "destinationId is required for settled movements",
              path: ["destinationId"],
            },
          ] }, 400);
        }
        const dest = await assertDestinationInFamily(
          db,
          updates.destinationId,
          movement.familyId,
        );
        if (!dest) return c.json({ error: "invalid_destination_id" }, 400);
        if (dest.archivedAt) {
          return c.json({ error: "destination_archived" }, 400);
        }
        nextDestinationId = dest.id;
      }
    }

    const set: Partial<typeof schema.moneyMovements.$inferInsert> = {
      updatedAt: Math.floor(Date.now() / 1000),
      destinationId: nextDestinationId,
    };
    if (updates.amount !== undefined) set.amountCents = toCents(updates.amount);
    if (updates.currency !== undefined) set.currency = updates.currency;
    if (updates.note !== undefined) set.note = updates.note;
    if (updates.movedOn !== undefined) set.movedOn = updates.movedOn;

    await db
      .update(schema.moneyMovements)
      .set(set)
      .where(eq(schema.moneyMovements.id, id));

    const rows = await loadFamilyMovements(db, movement.familyId);
    const row = rows.find((m) => m.id === id);
    const balances = computeBalances(rows);

    return c.json({
      movement: row
        ? serializeMovement(row, row.destinationName, row.createdByName)
        : null,
      ...balances,
    });
  },
);

// DELETE /money/movements/:id
moneyRoutes.delete("/movements/:id", requireSession, async (c) => {
  const { id } = c.req.param();
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const movement = await db
    .select()
    .from(schema.moneyMovements)
    .where(eq(schema.moneyMovements.id, id))
    .get();
  if (!movement) return c.json({ error: "not_found" }, 404);

  const membership = await requireFamilyMember(c, movement.familyId, "member", "expenses");
  if (membership instanceof Response) return membership;

  if (movement.createdBy !== userId && membership.role === "member") {
    return c.json({ error: "forbidden" }, 403);
  }

  await db
    .delete(schema.moneyMovements)
    .where(eq(schema.moneyMovements.id, id));

  await insertAuditEvent(db, {
    familyId: movement.familyId,
    actorUserId: userId,
    action: "money_movement_deleted",
    targetType: "money_movement",
    targetId: id,
    meta: {
      type: movement.type,
      amountCents: movement.amountCents,
      destinationId: movement.destinationId,
    },
  });

  const remaining = await db
    .select({
      type: schema.moneyMovements.type,
      amountCents: schema.moneyMovements.amountCents,
    })
    .from(schema.moneyMovements)
    .where(eq(schema.moneyMovements.familyId, movement.familyId));

  return c.json({ ok: true, ...computeBalances(remaining) });
});
