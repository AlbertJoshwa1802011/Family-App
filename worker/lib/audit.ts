import type { Context } from "hono";
import type { Db } from "../db/client";
import { schema } from "../db/client";
import type { HonoEnv } from "../types";
import { getDb } from "../db/client";

export const ACTIONS = {
  AUTH_LOGIN: "auth_login",
  AUTH_LOGOUT: "auth_logout",
  AUTH_LOGIN_FAILED: "auth_login_failed",
  MEMBER_ROLE_CHANGED: "member_role_changed",
  MEMBER_REMOVED: "member_removed",
  SECRET_REVEALED: "secret_revealed",
  ADMIN_JOB_RUN: "admin_job_run",
  ADMIN_ADMIN_GRANTED: "admin_admin_granted",
  ADMIN_ADMIN_REVOKED: "admin_admin_revoked",
  ADMIN_METRICS_VIEWED: "admin_metrics_viewed",
  STORAGE_CONNECTED: "storage_connected",
  STORAGE_DISCONNECTED: "storage_disconnected",
  DEVICE_LOCK_REGISTERED: "device_lock_registered",
  DEVICE_LOCK_UNLOCKED: "device_lock_unlocked",
  VAULT_ITEM_CREATED: "vault_item_created",
  VAULT_ITEM_VIEWED: "vault_item_viewed",
  VAULT_ITEM_UPDATED: "vault_item_updated",
  VAULT_ITEM_TRASHED: "vault_item_trashed",
  EXPENSE_CREATED: "expense_created",
  FUND_CREATED: "fund_created",
} as const;

export type AuditAction = (typeof ACTIONS)[keyof typeof ACTIONS];

export interface AuditEvent {
  familyId?: string;
  actorUserId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
  /** Accepted for main-route compatibility; not persisted on this branch. */
  visibility?: string;
  severity?: string;
}

export async function insertAuditEvent(db: Db, event: AuditEvent): Promise<void> {
  await db.insert(schema.auditLog).values({
    id: crypto.randomUUID(),
    familyId: event.familyId,
    actorUserId: event.actorUserId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    meta: event.meta ? JSON.stringify(event.meta) : undefined,
  });
}

/** Main-compatible helper: pull db + actor from the Hono context. */
export async function audit(
  c: Context<HonoEnv>,
  event: Omit<AuditEvent, "actorUserId"> & { actorUserId?: string },
): Promise<void> {
  const db = getDb(c.env);
  const actorUserId = event.actorUserId ?? c.get("userId");
  await insertAuditEvent(db, { ...event, actorUserId });
}
