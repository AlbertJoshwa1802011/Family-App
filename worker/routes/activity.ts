import { Hono } from "hono";
import { and, desc, eq, lt } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";

export const activityRoutes = new Hono<HonoEnv>();

// GET /activity/me?familyId=&cursor=&limit= — the current user's own audit trail.
// A user can always see everything THEY did (no visibility filter needed here).
// Keyset-paginated on createdAt (pass the last `nextCursor` back as `cursor`).
activityRoutes.get("/me", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const familyId = c.req.query("familyId");
  const cursor = c.req.query("cursor");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50") || 50, 100);

  const conds = [eq(schema.auditLog.actorUserId, userId)];
  if (familyId) conds.push(eq(schema.auditLog.familyId, familyId));
  if (cursor) {
    const cur = parseInt(cursor);
    if (!Number.isNaN(cur)) conds.push(lt(schema.auditLog.createdAt, cur));
  }

  const activities = await db
    .select({
      id: schema.auditLog.id,
      familyId: schema.auditLog.familyId,
      action: schema.auditLog.action,
      targetType: schema.auditLog.targetType,
      targetId: schema.auditLog.targetId,
      meta: schema.auditLog.meta,
      severity: schema.auditLog.severity,
      createdAt: schema.auditLog.createdAt,
    })
    .from(schema.auditLog)
    .where(and(...(conds as [(typeof conds)[0], ...typeof conds])))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(limit);

  const nextCursor =
    activities.length === limit
      ? activities[activities.length - 1].createdAt
      : null;

  return c.json({ activities, nextCursor });
});
