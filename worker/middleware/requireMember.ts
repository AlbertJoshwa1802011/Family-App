import { and, eq } from "drizzle-orm";
import type { AppContext } from "../types";
import { getDb, schema } from "../db/client";
import { hasModule, type FamilyModule } from "../lib/modules";

type Role = "owner" | "admin" | "member";
const ROLE_RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1 };

/**
 * Returns the active membership row if the authenticated user is a member of
 * the family with at least `minRole`. Returns a Response (404/403) otherwise.
 * Call `requireSession` before this.
 *
 * When `module` is set, also enforces per-member module access (owners bypass).
 * Disabled → 403 `{ error: "module_disabled" }`.
 */
export async function requireFamilyMember(
  c: AppContext,
  familyId: string,
  minRole: Role = "member",
  module?: FamilyModule,
) {
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const membership = await db
    .select()
    .from(schema.familyMembers)
    .where(
      and(
        eq(schema.familyMembers.familyId, familyId),
        eq(schema.familyMembers.userId, userId),
        eq(schema.familyMembers.status, "active"),
      ),
    )
    .get();

  if (!membership) {
    return c.json({ error: "not_found" }, 404) as Response;
  }

  const rank = ROLE_RANK[membership.role as Role] ?? 0;
  if (rank < ROLE_RANK[minRole]) {
    return c.json({ error: "forbidden" }, 403) as Response;
  }

  if (
    module &&
    !hasModule(membership.modulesJson, module, membership.role)
  ) {
    return c.json({ error: "module_disabled" }, 403) as Response;
  }

  return membership;
}
