import type { Next } from "hono";
import { eq } from "drizzle-orm";
import type { AppContext, Env } from "../types";
import { getDb, schema } from "../db/client";

type Db = ReturnType<typeof getDb>;

// SHA-256 of the bootstrap superadmin email (lowercase). Add more hashes to grant access.
// Compute: echo -n "you@example.com" | sha256sum
const ADMIN_EMAIL_HASHES = new Set([
  "d4046f3d98913413efd050a2751ca7127fc03d6c7989f8a5114c39bae6ad3892", // albertjoshwa.a@zohocorp.com
]);

async function emailHash(email: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(email.toLowerCase().trim()),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Returns true if the given user is a platform admin.
 *
 * Source of truth is the `platform_admins` table. The first admin is bootstrapped
 * lazily by matching the user's email SHA-256 against ADMIN_EMAIL_HASHES above.
 * There is intentionally NO self-promotion endpoint.
 */
export async function isPlatformAdmin(
  db: Db,
  _env: Env,
  userId: string,
): Promise<boolean> {
  const existing = await db
    .select({ userId: schema.platformAdmins.userId })
    .from(schema.platformAdmins)
    .where(eq(schema.platformAdmins.userId, userId))
    .get();
  if (existing) return true;

  const user = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!user) return false;

  const hash = await emailHash(user.email);
  if (!ADMIN_EMAIL_HASHES.has(hash)) return false;

  // Bootstrap: write to platform_admins so subsequent checks skip the hash lookup.
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
