import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { insertAuditEvent } from "../lib/audit";
import { sha256Hex } from "../lib/crypto";
import { checkRateLimit } from "../lib/rateLimit";
import { sendEmail } from "../lib/email";
import { inviteEmail } from "../lib/emailTemplates";

/** Roles that can administer the family (invites, role changes, private docs). */
function isOwnerOrAdmin(role: string): boolean {
  return role === "owner" || role === "admin";
}

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
    action: "family_created",
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

  // Invites are email-bound (invites.email + hashed single-use token). Enforce
  // that binding: a leaked/forwarded link must not admit a different account.
  const acceptingUser = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (
    !acceptingUser ||
    acceptingUser.email.toLowerCase() !== invite.email.toLowerCase()
  ) {
    return c.json({ error: "invite_email_mismatch" }, 403);
  }

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
    action: "member_joined",
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

// POST /families/:id/members — add a DEPENDENT member (child/elder without an
// account). Real users join via invites; this is for people who can't log in.
const addDependentSchema = z.object({
  displayName: z.string().min(1).max(200),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-mm-dd")
    .optional(),
});

familyRoutes.post(
  "/:id/members",
  requireSession,
  zv(addDependentSchema),
  async (c) => {
    const { id: familyId } = c.req.param();
    const { displayName, dateOfBirth } = c.req.valid("json");
    const userId = c.get("userId")!;

    const callerOrError = await requireFamilyMember(c, familyId, "admin");
    if (callerOrError instanceof Response) return callerOrError;

    const db = getDb(c.env);
    const memberId = crypto.randomUUID();

    await db.insert(schema.familyMembers).values({
      id: memberId,
      familyId,
      userId: null,
      memberType: "dependent",
      displayName,
      dateOfBirth,
      role: "member",
      status: "active",
    });

    await insertAuditEvent(db, {
      familyId,
      actorUserId: userId,
      action: "member_added",
      targetType: "member",
      targetId: memberId,
      meta: { displayName, memberType: "dependent" },
    });

    const member = await db
      .select()
      .from(schema.familyMembers)
      .where(eq(schema.familyMembers.id, memberId))
      .get();

    return c.json({ member }, 201);
  },
);

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

    // Prevent lockout: a family must retain at least one active owner or admin.
    // Self-demotion / self-removal of the sole privileged member is the main
    // risk; the same guard also covers an admin removing the last peer when
    // no owner remains with admin privileges.
    const nextRole = updates.role ?? target.role;
    const nextStatus = updates.status ?? target.status;
    const wasPrivileged =
      target.status === "active" && isOwnerOrAdmin(target.role);
    const remainsPrivileged =
      nextStatus === "active" && isOwnerOrAdmin(nextRole);

    if (wasPrivileged && !remainsPrivileged) {
      const otherPrivileged = await db
        .select({ id: schema.familyMembers.id })
        .from(schema.familyMembers)
        .where(
          and(
            eq(schema.familyMembers.familyId, familyId),
            eq(schema.familyMembers.status, "active"),
            inArray(schema.familyMembers.role, ["owner", "admin"]),
            ne(schema.familyMembers.id, memberId),
          ),
        )
        .all();

      if (otherPrivileged.length === 0) {
        return c.json({ error: "last_owner_or_admin" }, 409);
      }
    }

    await db
      .update(schema.familyMembers)
      .set(columnUpdates)
      .where(eq(schema.familyMembers.id, memberId));

    await insertAuditEvent(db, {
      familyId,
      actorUserId: userId,
      action: "member_updated",
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

    // Throttle invite creation per user — each invite is a mailable token.
    const limited = await checkRateLimit(c, `invite:${userId}`, {
      limit: 20,
      windowSecs: 3600,
    });
    if (limited) return limited;

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
      action: "invite_created",
      targetType: "invite",
      meta: { email, role },
    });

    // Best-effort invite email (no-op without RESEND_API_KEY — the caller
    // still gets the link to share manually).
    const [inviter, family] = await Promise.all([
      db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId)).get(),
      db.select({ name: schema.families.name }).from(schema.families).where(eq(schema.families.id, familyId)).get(),
    ]);
    const appUrl = c.env.APP_URL ?? new URL(c.req.url).origin;
    await sendEmail(c.env, {
      to: email,
      subject: `You're invited to ${family?.name ?? "a family"} on Family Vault`,
      html: inviteEmail({
        inviterName: inviter?.name ?? null,
        familyName: family?.name ?? "your family",
        inviteUrl: `${appUrl}/invite/${token}`,
      }),
    });

    // Return the plain token so the caller can include it in an email link.
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

// GET /families/:id/activity — surfaces audit_log entries for the family.
familyRoutes.get("/:id/activity", requireSession, async (c) => {
  const { id: familyId } = c.req.param();

  const memberOrError = await requireFamilyMember(c, familyId);
  if (memberOrError instanceof Response) return memberOrError;

  const db = getDb(c.env);
  const activities = await db
    .select({
      id: schema.auditLog.id,
      action: schema.auditLog.action,
      targetType: schema.auditLog.targetType,
      targetId: schema.auditLog.targetId,
      createdAt: schema.auditLog.createdAt,
      actorName: schema.users.name,
    })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.auditLog.actorUserId, schema.users.id))
    .where(eq(schema.auditLog.familyId, familyId))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(50);

  return c.json({ activities });
});
