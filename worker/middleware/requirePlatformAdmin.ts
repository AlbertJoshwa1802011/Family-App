import type { Next } from "hono";
import { eq } from "drizzle-orm";
import type { AppContext, Env } from "../types";
import { getDb, schema } from "../db/client";

type Db = ReturnType<typeof getDb>;

/**
 * Returns true if the given user is a platform admin.
 *
 * Source of truth is the `platform_admins` table. The FIRST admin is bootstrapped
 * lazily: if the table has no row for this user but the user's email is listed in
 * `env.PLATFORM_ADMIN_EMAILS` (comma-separated), a `superadmin` row is inserted on
 * the fly. There is intentionally NO self-promotion endpoint.
 */
export async function isPlatformAdmin(
  db: Db,
  env: Env,
  userId: string,
): Promise<boolean> {
  const existing = await db
    .select({ userId: schema.platformAdmins.userId })
    .from(schema.platformAdmins)
    .where(eq(schema.platformAdmins.userId, userId))
    .get();
  if (existing) return true;

  const allowlist = (env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length === 0) return false;

  const user = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!user || !allowlist.includes(user.email.toLowerCase())) return false;

  // Bootstrap the first admin from the env allowlist.
  await db
    .insert(schema.platformAdmins)
    .values({ userId, level: "superadmin", grantedBy: userId })
    .onConflictDoNothing();
  return true;
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
