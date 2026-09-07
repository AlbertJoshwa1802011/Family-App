/**
 * App-level access control (closed signup).
 *
 * Family roles (owner/admin/member) and platform_admins stay separate. This
 * module answers: may this Google identity create a session at all?
 */
import { eq } from "drizzle-orm";
import type { Env } from "../types";
import { schema, type Db } from "../db/client";

/** Normalize emails for grant / allowlist matching. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Bootstrap admins who may always sign in (and receive demo-request mail by
 * default). Kept in sync with the SHA-256 allowlist in
 * worker/middleware/requirePlatformAdmin.ts.
 */
const BOOTSTRAP_ADMIN_EMAILS = [
  "albertjoshwa.a@zohocorp.com",
  "albertjoshrock101@gmail.com",
] as const;

export function isBootstrapAdminEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  return (BOOTSTRAP_ADMIN_EMAILS as readonly string[]).includes(normalized);
}

/**
 * Where demo-request notification emails go. Prefer ACCESS_NOTIFY_EMAIL,
 * else PLATFORM_ADMIN_EMAILS first entry, else the primary bootstrap admin.
 */
export function accessNotifyEmail(env: Env): string | null {
  const explicit = env.ACCESS_NOTIFY_EMAIL?.trim();
  if (explicit) return normalizeEmail(explicit);

  const fromVar = (env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(/[,;\s]+/)
    .map((e) => normalizeEmail(e))
    .filter(Boolean)[0];
  if (fromVar) return fromVar;

  return BOOTSTRAP_ADMIN_EMAILS[1] ?? BOOTSTRAP_ADMIN_EMAILS[0] ?? null;
}

/**
 * Whether this Google identity may create a session.
 *
 * Order:
 * 1. Explicit revoke on access_grants → deny (wins over grandfathering)
 * 2. Bootstrap admin email → allow
 * 3. Approved access_grant → allow
 * 4. Existing user row (pre-gate / already onboarded) → allow
 * 5. Else → deny (must request access)
 */
export async function canSignIn(
  db: Db,
  _env: Env,
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

  if (isBootstrapAdminEmail(email)) {
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
