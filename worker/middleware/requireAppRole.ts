import type { AppContext } from "../types";
import { getDb } from "../db/client";
import { type AppRole, userHasAppRole } from "../lib/appAccess";

/**
 * After requireSession: require an app-level role (e.g. super_admin).
 * Returns 403 { error: "forbidden" } when the caller lacks the role.
 * Does NOT use family membership — platform ops are cross-tenant.
 */
export async function requireAppRole(
  c: AppContext,
  role: AppRole,
): Promise<true | Response> {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const db = getDb(c.env);
  const ok = await userHasAppRole(db, userId, role);
  if (!ok) {
    return c.json({ error: "forbidden" }, 403);
  }
  return true;
}
