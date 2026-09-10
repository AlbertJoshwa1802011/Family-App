/**
 * App-level access control (closed signup + extensible platform roles).
 *
 * Family roles (owner/admin/member) stay on family_members. This module is
 * orthogonal: who may sign into the product at all, and who may administer it.
 */
import { and, eq } from "drizzle-orm";
import type { Env } from "../types";
import { schema, type Db } from "../db/client";
import { APP_ROLES, type AppRole } from "../db/schema";

export type { AppRole };
export { APP_ROLES };

/** Normalize emails for grant / allowlist matching. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Comma/whitespace-separated SUPER_ADMIN_EMAILS from env. */
export function parseSuperAdminEmails(env: Env): string[] {
  const raw = env.SUPER_ADMIN_EMAILS ?? "";
  return raw
    .split(/[,;\s]+/)
    .map((e) => normalizeEmail(e))
    .filter(Boolean);
}

export function isBootstrapSuperAdmin(env: Env, email: string): boolean {
  const set = new Set(parseSuperAdminEmails(env));
  return set.has(normalizeEmail(email));
}

/**
 * Where demo-request notification emails go. Prefer ACCESS_NOTIFY_EMAIL,
 * else the first SUPER_ADMIN_EMAILS entry.
 */
export function accessNotifyEmail(env: Env): string | null {
  const explicit = env.ACCESS_NOTIFY_EMAIL?.trim();
  if (explicit) return normalizeEmail(explicit);
  return parseSuperAdminEmails(env)[0] ?? null;
}

/**
 * Whether this Google identity may create a session.
 *
 * Order matters:
 * 1. Explicit revoke on access_grants → deny (wins over grandfathering)
 * 2. Bootstrap SUPER_ADMIN_EMAILS → allow
 * 3. Approved access_grant → allow
 * 4. Existing user row (pre-gate / already onboarded) → allow
 * 5. Else → deny (must request a demo)
 */
export async function canSignIn(
  db: Db,
  env: Env,
  opts: { email: string; googleSub: string },
): Promise<{ ok: true } | { ok: false; reason: "access_denied" | "access_revoked" }> {
  const email = normalizeEmail(opts.email);

  const grant = await db
    .select({ status: schema.accessGrants.status })
    .from(schema.accessGrants)
    .where(eq(schema.accessGrants.email, email))
    .get();

  if (grant?.status === "revoked") {
    return { ok: false, reason: "access_revoked" };
  }

  if (isBootstrapSuperAdmin(env, email)) {
    return { ok: true };
  }

  if (grant?.status === "approved") {
    return { ok: true };
  }

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.googleSub, opts.googleSub))
    .get();

  if (existing) {
    return { ok: true };
  }

  return { ok: false, reason: "access_denied" };
}

/** Roles currently assigned to a user. */
export async function listAppRoles(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ role: schema.appRoleAssignments.role })
    .from(schema.appRoleAssignments)
    .where(eq(schema.appRoleAssignments.userId, userId));
  return rows.map((r) => r.role);
}

export async function userHasAppRole(
  db: Db,
  userId: string,
  role: AppRole | string,
): Promise<boolean> {
  const row = await db
    .select({ id: schema.appRoleAssignments.id })
    .from(schema.appRoleAssignments)
    .where(
      and(
        eq(schema.appRoleAssignments.userId, userId),
        eq(schema.appRoleAssignments.role, role),
      ),
    )
    .get();
  return Boolean(row);
}

/**
 * Ensure bootstrap SUPER_ADMIN_EMAILS get a durable super_admin assignment
 * after their user row exists (idempotent).
 */
export async function ensureBootstrapSuperAdmin(
  db: Db,
  env: Env,
  userId: string,
  email: string,
): Promise<void> {
  if (!isBootstrapSuperAdmin(env, email)) return;
  const already = await userHasAppRole(db, userId, "super_admin");
  if (already) return;
  await db
    .insert(schema.appRoleAssignments)
    .values({
      id: crypto.randomUUID(),
      userId,
      role: "super_admin",
      grantedByUserId: null,
    })
    .onConflictDoNothing();
}

/** Upsert an approved access grant for an email (idempotent). */
export async function upsertAccessGrant(
  db: Db,
  opts: {
    email: string;
    grantedByUserId: string | null;
    demoRequestId?: string | null;
    note?: string | null;
  },
): Promise<{ id: string; created: boolean }> {
  const email = normalizeEmail(opts.email);
  const now = Math.floor(Date.now() / 1000);
  const existing = await db
    .select({ id: schema.accessGrants.id, status: schema.accessGrants.status })
    .from(schema.accessGrants)
    .where(eq(schema.accessGrants.email, email))
    .get();

  if (existing) {
    await db
      .update(schema.accessGrants)
      .set({
        status: "approved",
        grantedByUserId: opts.grantedByUserId,
        demoRequestId: opts.demoRequestId ?? null,
        note: opts.note ?? null,
        updatedAt: now,
      })
      .where(eq(schema.accessGrants.id, existing.id));
    return { id: existing.id, created: false };
  }

  const id = crypto.randomUUID();
  await db.insert(schema.accessGrants).values({
    id,
    email,
    status: "approved",
    grantedByUserId: opts.grantedByUserId,
    demoRequestId: opts.demoRequestId ?? null,
    note: opts.note ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return { id, created: true };
}

export async function revokeAccessGrant(
  db: Db,
  email: string,
  revokedByUserId: string | null,
): Promise<boolean> {
  const normalized = normalizeEmail(email);
  const now = Math.floor(Date.now() / 1000);
  const existing = await db
    .select({ id: schema.accessGrants.id })
    .from(schema.accessGrants)
    .where(eq(schema.accessGrants.email, normalized))
    .get();

  if (existing) {
    await db
      .update(schema.accessGrants)
      .set({
        status: "revoked",
        grantedByUserId: revokedByUserId,
        updatedAt: now,
      })
      .where(eq(schema.accessGrants.id, existing.id));
    return true;
  }

  await db.insert(schema.accessGrants).values({
    id: crypto.randomUUID(),
    email: normalized,
    status: "revoked",
    grantedByUserId: revokedByUserId,
    createdAt: now,
    updatedAt: now,
  });
  return true;
}
