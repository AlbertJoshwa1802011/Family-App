import type { Next } from "hono";
import { eq } from "drizzle-orm";
import type { AppContext, Env } from "../types";
import { getDb, schema } from "../db/client";
import {
  ensureBootstrapSuperAdmin,
  userHasAppRole,
} from "../lib/appAccess";

type Db = ReturnType<typeof getDb>;

/**
 * Platform admin = durable `super_admin` app role (same gate as /admin).
 * Bootstraps SUPER_ADMIN_EMAILS on first check so Money church funds keep working.
 */
export async function isPlatformAdmin(
  db: Db,
  env: Env,
  userId: string,
): Promise<boolean> {
  const user = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (user?.email) {
    await ensureBootstrapSuperAdmin(db, env, userId, user.email);
  }
  return userHasAppRole(db, userId, "super_admin");
}

/**
 * Middleware guarding platform-level (application-wide) admin routes. Must run
 * AFTER requireSession (depends on c.var.userId). Returns 403 for non-admins.
 */
export async function requirePlatformAdmin(c: AppContext, next: Next) {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const db = getDb(c.env);
  if (!(await isPlatformAdmin(db, c.env, userId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  await next();
}
