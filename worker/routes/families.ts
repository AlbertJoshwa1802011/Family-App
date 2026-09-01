import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { insertAuditEvent, ACTIONS } from "../lib/audit";
import { sha256Hex } from "../lib/crypto";

export const familyRoutes = new Hono<HonoEnv>();

// ── Validation schemas ────────────────────────────────────────────────────────

const createFamilySchema = z.object({
  name: z.string().min(1).max(200),
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]).optional().default("member"),
});

const updateMemberSchema = z
  .object({
    role: z.enum(["admin", "member"]).optional(),
    status: z.enum(["active", "removed"]).optional(),
  })
  .refine((d) => d.role !== undefined || d.status !== undefined, {
    message: "At least one of role or status must be provided",
  });

const FAMILY_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "INR",
  "CAD",
  "AUD",
  "JPY",
  "SGD",
  "AED",
  "CHF",
  "NZD",
  "HKD",
] as const;

const updateFamilySchema = z.object({
  defaultCurrency: z.enum(FAMILY_CURRENCIES).optional(),
  name: z.string().min(1).max(200).optional(),
}).refine((d) => d.defaultCurrency !== undefined || d.name !== undefined, {
  message: "At least one of defaultCurrency or name must be provided",
});

function zv<T extends z.ZodType>(schema: T) {
  return zValidator("json", schema, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /families — list families the current user belongs to.
familyRoutes.get("/", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const rows = await db
    .select({
      id: schema.families.id,
      name: schema.families.name,
      driveFolderId: schema.families.driveFolderId,
      createdAt: schema.families.createdAt,
      role: schema.familyMembers.role,
    })
    .from(schema.familyMembers)
    .innerJoin(schema.families, eq(schema.familyMembers.familyId, schema.families.id))
    .where(
      and(
        eq(schema.familyMembers.userId, userId),
        eq(schema.familyMembers.status, "active"),
      ),
    );

  return c.json({ families: rows });
});

// POST /families — create a new family and add creator as owner.
// Drive folder creation is deferred to Phase 2.
familyRoutes.post("/", requireSession, zv(createFamilySchema), async (c) => {
  const userId = c.get("userId")!;
  const { name } = c.req.valid("json");
  const db = getDb(c.env);

  const familyId = crypto.randomUUID();
  const memberId = crypto.randomUUID();

  await db.insert(schema.families).values({
    id: familyId,
    name,
    ownerUserId: userId,
    // driveFolderId set to null until Phase 2 Drive integration
  });

  await db.insert(schema.familyMembers).values({
    id: memberId,
    familyId,
    userId,
    memberType: "user",
    role: "owner",
    status: "active",
  });

  await insertAuditEvent(db, {
    familyId,
    actorUserId: userId,
    action: ACTIONS.FAMILY_CREATED,
    targetType: "family",
    targetId: familyId,
  });

  const family = await db
    .select()
    .from(schema.families)
    .where(eq(schema.families.id, familyId))
    .get();

  return c.json({ family }, 201);
});

// GET /families/me/members — list members of the first active family for the
// current user. Used by the EventForm attendee picker.
// MUST be registered before /:id routes to avoid being swallowed by the param.
familyRoutes.get("/me/members", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  // Find user's first active family
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

  if (!membership) return c.json({ members: [] });

  const members = await db
    .select({
      id: schema.familyMembers.id,
      userId: schema.familyMembers.userId,
      memberType: schema.familyMembers.memberType,
      displayName: schema.familyMembers.displayName,
      dateOfBirth: schema.familyMembers.dateOfBirth,
      anniversaryDate: schema.familyMembers.anniversaryDate,
      role: schema.familyMembers.role,
      status: schema.familyMembers.status,
      name: schema.users.name,
      email: schema.users.email,
      picture: schema.users.picture,
    })
    .from(schema.familyMembers)
    .leftJoin(schema.users, eq(schema.familyMembers.userId, schema.users.id))
    .where(
      and(
        eq(schema.familyMembers.familyId, membership.familyId),
        eq(schema.familyMembers.status, "active"),
      ),
    );

  return c.json({ members });
});

// GET /families/me/dashboard-stats — retrieve aggregated family statistics.
familyRoutes.get("/me/dashboard-stats", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  // Find user's first active family
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

  if (!membership) {
    return c.json({
      documentCount: 0,
      expiringCount: 0,
      memberCount: 0,
      storageBytes: 0,
      tasksTotal: 0,
      tasksCompleted: 0,
    });
  }

  const familyId = membership.familyId;

  // 1. Document Count
  const docCountResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.familyId, familyId),
        eq(schema.documents.status, "active"),
      ),
    )
    .get();

  // 2. Expiring soon Count (expiring in <= 30 days)
  const now = new Date();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  const nowStr = now.toISOString().slice(0, 10);
  const thirtyDaysStr = thirtyDaysLater.toISOString().slice(0, 10);

  const expiringCountResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.familyId, familyId),
        eq(schema.documents.status, "active"),
        sql`${schema.documents.expiryDate} >= ${nowStr}`,
        sql`${schema.documents.expiryDate} <= ${thirtyDaysStr}`,
      ),
    )
    .get();

  // 3. Family Members Count
  const memberCountResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.familyMembers)
    .where(
      and(
        eq(schema.familyMembers.familyId, familyId),
        eq(schema.familyMembers.status, "active"),
      ),
    )
    .get();

  // 4. Storage Bytes (Sum sizeBytes of current active files)
  const storageResult = await db
    .select({ totalBytes: sql<number>`sum(${schema.files.sizeBytes})` })
    .from(schema.files)
    .innerJoin(schema.documents, eq(schema.files.documentId, schema.documents.id))
    .where(
      and(
        eq(schema.documents.familyId, familyId),
        eq(schema.documents.status, "active"),
        eq(schema.files.isCurrent, true),
        eq(schema.files.status, "active"),
      ),
    )
    .get();

  // 5. Tasks Stats (Total & Completed, excluding archived)
  const tasksResult = await db
    .select({
      total: sql<number>`count(*)`,
      completed: sql<number>`sum(case when ${schema.tasks.status} = 'done' then 1 else 0 end)`,
    })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.familyId, familyId),
        sql`${schema.tasks.status} != 'archived'`,
      ),
    )
    .get();

  return c.json({
    documentCount: docCountResult?.count ?? 0,
    expiringCount: expiringCountResult?.count ?? 0,
    memberCount: memberCountResult?.count ?? 0,
    storageBytes: storageResult?.totalBytes ?? 0,
    tasksTotal: tasksResult?.total ?? 0,
    tasksCompleted: tasksResult?.completed ?? 0,
  });
});

// POST /invites/:token/accept — accept an invite using the plain token.
// Must be before /:id to avoid param collision.
familyRoutes.post("/invites/:token/accept", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const { token } = c.req.param();
  const db = getDb(c.env);

  const tokenHash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);

  const invite = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.tokenHash, tokenHash))
    .get();

  if (!invite) return c.json({ error: "not_found" }, 404);
  if (invite.expiresAt < now) return c.json({ error: "invite_expired" }, 410);
  if (invite.acceptedAt !== null) return c.json({ error: "invite_already_used" }, 409);

  // Check user is not already a member
  const existing = await db
    .select({ id: schema.familyMembers.id })
    .from(schema.familyMembers)
    .where(
      and(
        eq(schema.familyMembers.familyId, invite.familyId),
        eq(schema.familyMembers.userId, userId),
      ),
    )
    .get();

  if (existing) return c.json({ error: "already_a_member" }, 409);

  await db.insert(schema.familyMembers).values({
    id: crypto.randomUUID(),
    familyId: invite.familyId,
    userId,
    memberType: "user",
    role: invite.role,
    status: "active",
  });

  await db
    .update(schema.invites)
    .set({ acceptedAt: now })
    .where(eq(schema.invites.id, invite.id));

  await insertAuditEvent(db, {
    familyId: invite.familyId,
    actorUserId: userId,
    action: ACTIONS.MEMBER_JOINED,
    targetType: "family",
    targetId: invite.familyId,
    meta: { role: invite.role },
  });

  return c.json({ ok: true, familyId: invite.familyId });
});

// GET /families/:id — get family details (requires membership).
familyRoutes.get("/:id", requireSession, async (c) => {
  const { id: familyId } = c.req.param();

  const memberOrError = await requireFamilyMember(c, familyId);
  if (memberOrError instanceof Response) return memberOrError;

  const db = getDb(c.env);
  const family = await db
    .select()
    .from(schema.families)
    .where(eq(schema.families.id, familyId))
    .get();

  return c.json({ family });
});

// PATCH /families/:id — update family-level settings (currency, name).
// Any active member may change currency; existing incomes/expenses keep their
// stored currency — only the default for new entries changes.
familyRoutes.patch("/:id", requireSession, zv(updateFamilySchema), async (c) => {
  const { id: familyId } = c.req.param();
  const updates = c.req.valid("json");

  const memberOrError = await requireFamilyMember(c, familyId);
  if (memberOrError instanceof Response) return memberOrError;

  const db = getDb(c.env);
  const set: Partial<typeof schema.families.$inferInsert> = {};
  if (updates.defaultCurrency !== undefined) set.defaultCurrency = updates.defaultCurrency;
  if (updates.name !== undefined) set.name = updates.name;

  await db.update(schema.families).set(set).where(eq(schema.families.id, familyId));

  const family = await db
    .select()
    .from(schema.families)
    .where(eq(schema.families.id, familyId))
    .get();

  return c.json({ family });
});

// GET /families/:id/members — list all active members with user profile info.
familyRoutes.get("/:id/members", requireSession, async (c) => {
  const { id: familyId } = c.req.param();

  const memberOrError = await requireFamilyMember(c, familyId);
  if (memberOrError instanceof Response) return memberOrError;

  const db = getDb(c.env);
  const members = await db
    .select({
      id: schema.familyMembers.id,
      userId: schema.familyMembers.userId,
      memberType: schema.familyMembers.memberType,
      displayName: schema.familyMembers.displayName,
      dateOfBirth: schema.familyMembers.dateOfBirth,
      anniversaryDate: schema.familyMembers.anniversaryDate,
      role: schema.familyMembers.role,
      status: schema.familyMembers.status,
      createdAt: schema.familyMembers.createdAt,
      name: schema.users.name,
      email: schema.users.email,
      picture: schema.users.picture,
    })
    .from(schema.familyMembers)
    .leftJoin(schema.users, eq(schema.familyMembers.userId, schema.users.id))
    .where(eq(schema.familyMembers.familyId, familyId));

  return c.json({ members });
});

// PATCH /families/:id/members/:mid — change a member's role or status (admin+ only).
familyRoutes.patch(
  "/:id/members/:mid",
  requireSession,
  zv(updateMemberSchema),
  async (c) => {
    const { id: familyId, mid: memberId } = c.req.param();
    const updates = c.req.valid("json");
    const userId = c.get("userId")!;

    const callerOrError = await requireFamilyMember(c, familyId, "admin");
    if (callerOrError instanceof Response) return callerOrError;

    const db = getDb(c.env);

    // Fetch the target member
    const target = await db
      .select()
      .from(schema.familyMembers)
      .where(
        and(
          eq(schema.familyMembers.id, memberId),
          eq(schema.familyMembers.familyId, familyId),
        ),
      )
      .get();

    if (!target) return c.json({ error: "not_found" }, 404);

    // Owners cannot be demoted/removed except by themselves
    if (target.role === "owner" && target.userId !== userId) {
      return c.json({ error: "cannot_modify_owner" }, 403);
    }

    const columnUpdates: Partial<Pick<typeof schema.familyMembers.$inferInsert, "role" | "status">> = {};
    if (updates.role !== undefined) columnUpdates.role = updates.role;
    if (updates.status !== undefined) columnUpdates.status = updates.status;

    await db
      .update(schema.familyMembers)
      .set(columnUpdates)
      .where(eq(schema.familyMembers.id, memberId));

    await insertAuditEvent(db, {
      familyId,
      actorUserId: userId,
      action:
        updates.role !== undefined
          ? ACTIONS.MEMBER_ROLE_CHANGED
          : ACTIONS.MEMBER_UPDATED,
      targetType: "member",
      targetId: memberId,
      meta: updates as Record<string, unknown>,
    });

    const member = await db
      .select()
      .from(schema.familyMembers)
      .where(eq(schema.familyMembers.id, memberId))
      .get();

    return c.json({ member });
  },
);

// POST /families/:id/invites — create an invite (admin+ only).
// Email delivery is deferred to Phase 3 (Resend integration).
familyRoutes.post(
  "/:id/invites",
  requireSession,
  zv(inviteSchema),
  async (c) => {
    const { id: familyId } = c.req.param();
    const { email, role } = c.req.valid("json");
    const userId = c.get("userId")!;

    const callerOrError = await requireFamilyMember(c, familyId, "admin");
    if (callerOrError instanceof Response) return callerOrError;

    const db = getDb(c.env);
    const now = Math.floor(Date.now() / 1000);

    // Generate invite token and hash it for storage
    const token = crypto.randomUUID();
    const tokenHash = await sha256Hex(token);

    await db.insert(schema.invites).values({
      id: crypto.randomUUID(),
      familyId,
      email,
      tokenHash,
      role,
      invitedBy: userId,
      expiresAt: now + 7 * 24 * 3600, // 7 days
    });

    await insertAuditEvent(db, {
      familyId,
      actorUserId: userId,
      action: ACTIONS.MEMBER_INVITED,
      targetType: "invite",
      meta: { email, role },
    });

    // Return the plain token so the caller can include it in an email link.
    // In Phase 3 this route will also trigger a Resend email.
    return c.json(
      {
        invite: {
          email,
          role,
          expiresAt: now + 7 * 24 * 3600,
          token, // include in invite link: /invites/<token>/accept
        },
      },
      201,
    );
  },
);

// GET /families/me/activity — dynamic redirect/resolution of user's active family activity feed.
// Added to satisfy frontend queries to /families/me/activity.
familyRoutes.get("/me/activity", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  // Find user's first active family
  const membership = await db
    .select({ familyId: schema.familyMembers.familyId, role: schema.familyMembers.role })
    .from(schema.familyMembers)
    .where(
      and(
        eq(schema.familyMembers.userId, userId),
        eq(schema.familyMembers.status, "active"),
      ),
    )
    .get();

  if (!membership) {
    return c.json({ activities: [], nextCursor: null });
  }

  const { familyId, role } = membership;
  const cursor = c.req.query("cursor");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50") || 50, 100);
  const privileged = role === "owner" || role === "admin";

  const conds = [eq(schema.auditLog.familyId, familyId)];
  if (!privileged) {
    conds.push(
      or(
        eq(schema.auditLog.visibility, "family"),
        eq(schema.auditLog.actorUserId, userId),
      )!,
    );
  }
  if (cursor) {
    const cur = parseInt(cursor);
    if (!Number.isNaN(cur)) conds.push(lt(schema.auditLog.createdAt, cur));
  }

  const activities = await db
    .select({
      id: schema.auditLog.id,
      action: schema.auditLog.action,
      targetType: schema.auditLog.targetType,
      targetId: schema.auditLog.targetId,
      meta: schema.auditLog.meta,
      severity: schema.auditLog.severity,
      createdAt: schema.auditLog.createdAt,
      actorUserId: schema.auditLog.actorUserId,
      actorName: schema.users.name,
      actorPicture: schema.users.picture,
    })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.auditLog.actorUserId, schema.users.id))
    .where(and(...(conds as [(typeof conds)[0], ...typeof conds])))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(limit);

  const nextCursor =
    activities.length === limit
      ? activities[activities.length - 1].createdAt
      : null;

  return c.json({ activities, nextCursor });
});

// GET /families/:id/activity — the family activity feed (keyset-paginated).
// PRIVACY: members see family-visible activity + their own actions; owners/admins
// see everything. The audit row's snapshotted `visibility` drives this without a
// join back to the (possibly deleted) target — mirrors the documents predicate.
familyRoutes.get("/:id/activity", requireSession, async (c) => {
  const { id: familyId } = c.req.param();
  const me = c.get("userId")!;

  const memberOrError = await requireFamilyMember(c, familyId);
  if (memberOrError instanceof Response) return memberOrError;

  const db = getDb(c.env);
  const cursor = c.req.query("cursor");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50") || 50, 100);
  const privileged =
    memberOrError.role === "owner" || memberOrError.role === "admin";

  const conds = [eq(schema.auditLog.familyId, familyId)];
  if (!privileged) {
    conds.push(
      or(
        eq(schema.auditLog.visibility, "family"),
        eq(schema.auditLog.actorUserId, me),
      )!,
    );
  }
  if (cursor) {
    const cur = parseInt(cursor);
    if (!Number.isNaN(cur)) conds.push(lt(schema.auditLog.createdAt, cur));
  }

  const activities = await db
    .select({
      id: schema.auditLog.id,
      action: schema.auditLog.action,
      targetType: schema.auditLog.targetType,
      targetId: schema.auditLog.targetId,
      meta: schema.auditLog.meta,
      severity: schema.auditLog.severity,
      createdAt: schema.auditLog.createdAt,
      actorUserId: schema.auditLog.actorUserId,
      actorName: schema.users.name,
      actorPicture: schema.users.picture,
    })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.auditLog.actorUserId, schema.users.id))
    .where(and(...(conds as [(typeof conds)[0], ...typeof conds])))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(limit);

  const nextCursor =
    activities.length === limit
      ? activities[activities.length - 1].createdAt
      : null;

  return c.json({ activities, nextCursor });
});
