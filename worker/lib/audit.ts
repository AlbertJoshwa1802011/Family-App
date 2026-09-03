import type { Db } from "../db/client";
import { getDb, schema } from "../db/client";
import type { AppContext } from "../types";

/**
 * Canonical audit action names — dot-namespaced `<domain>.<verb_pasttense>`.
 *
 * Use these constants at call sites so the core set stays consistent and typo-free.
 * Generic `items` modules emit dynamic `${type}.created` / `.updated` / `.trashed` /
 * `.viewed` actions, which the AuditAction type's open string arm permits.
 */
export const ACTIONS = {
  AUTH_LOGIN: "auth.login",
  AUTH_LOGOUT: "auth.logout",
  AUTH_LOGIN_FAILED: "auth.login_failed",

  FAMILY_CREATED: "family.created",
  FAMILY_UPDATED: "family.updated",

  MEMBER_INVITED: "member.invited",
  MEMBER_JOINED: "member.joined",
  MEMBER_ROLE_CHANGED: "member.role_changed",
  MEMBER_UPDATED: "member.updated",
  MEMBER_REMOVED: "member.removed",

  DOCUMENT_CREATED: "document.created",
  DOCUMENT_UPDATED: "document.updated",
  DOCUMENT_TRASHED: "document.trashed",
  DOCUMENT_RESTORED: "document.restored",
  DOCUMENT_UPLOADED: "document.uploaded",
  DOCUMENT_DOWNLOADED: "document.downloaded",
  DOCUMENT_VIEWED: "document.viewed",

  EVENT_CREATED: "event.created",
  EVENT_UPDATED: "event.updated",
  EVENT_CANCELLED: "event.cancelled",
  EVENT_TRASHED: "event.trashed",

  TASK_CREATED: "task.created",
  TASK_UPDATED: "task.updated",
  TASK_COMPLETED: "task.completed",
  TASK_DELETED: "task.deleted",

  CONTACT_CREATED: "contact.created",
  CONTACT_UPDATED: "contact.updated",
  CONTACT_DELETED: "contact.deleted",
  CONTACT_SYNCED: "contact.synced",

  DEVICE_LOCK_REGISTERED: "device_lock.registered",
  DEVICE_LOCK_UNLOCKED: "device_lock.unlocked",

  VAULT_ITEM_CREATED: "vault_item.created",
  VAULT_ITEM_UPDATED: "vault_item.updated",
  VAULT_ITEM_TRASHED: "vault_item.trashed",
  VAULT_ITEM_VIEWED: "vault_item.viewed",
  SECRET_REVEALED: "secret.revealed",

  ADMIN_JOB_RUN: "admin.job_run",
  ADMIN_ADMIN_GRANTED: "admin.admin_granted",
  ADMIN_ADMIN_REVOKED: "admin.admin_revoked",
  ADMIN_METRICS_VIEWED: "admin.metrics_viewed",
  STORAGE_CONNECTED: "storage.connected",
  STORAGE_DISCONNECTED: "storage.disconnected",
} as const;

export type AuditAction = (typeof ACTIONS)[keyof typeof ACTIONS];

/**
 * Actions that default to `severity: "security"` so the maintainer view can filter
 * them from routine activity. Auth, role/membership changes, secret reveals, and all
 * admin actions are security-relevant.
 */
const SECURITY_ACTIONS = new Set<string>([
  ACTIONS.AUTH_LOGIN,
  ACTIONS.AUTH_LOGOUT,
  ACTIONS.AUTH_LOGIN_FAILED,
  ACTIONS.MEMBER_ROLE_CHANGED,
  ACTIONS.MEMBER_REMOVED,
  ACTIONS.SECRET_REVEALED,
  ACTIONS.ADMIN_JOB_RUN,
  ACTIONS.ADMIN_ADMIN_GRANTED,
  ACTIONS.ADMIN_ADMIN_REVOKED,
  ACTIONS.ADMIN_METRICS_VIEWED,
  ACTIONS.STORAGE_CONNECTED,
  ACTIONS.STORAGE_DISCONNECTED,
  ACTIONS.DEVICE_LOCK_REGISTERED,
  ACTIONS.DEVICE_LOCK_UNLOCKED,
]);

export interface AuditEvent {
  familyId?: string | null;
  actorUserId?: string | null;
  /** Known actions autocomplete; the open arm allows dynamic module actions. */
  action: AuditAction | (string & {});
  targetType?: string;
  targetId?: string;
  /** Small, NON-sensitive context only (titles, old→new role). Never secret values. */
  meta?: Record<string, unknown>;
  /** Defaults to "security" for known security actions, else "info". */
  severity?: "info" | "security";
  /** Snapshot of the target's visibility (drives family-feed privacy). Default "family". */
  visibility?: "family" | "private";
}

/** Low-level insert. Use when a Db handle is already in scope; throws on failure. */
export async function insertAuditEvent(
  db: Db,
  event: AuditEvent,
): Promise<void> {
  await db.insert(schema.auditLog).values({
    id: crypto.randomUUID(),
    familyId: event.familyId ?? null,
    actorUserId: event.actorUserId ?? null,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    meta: event.meta ? JSON.stringify(event.meta) : undefined,
    severity:
      event.severity ?? (SECURITY_ACTIONS.has(event.action) ? "security" : "info"),
    visibility: event.visibility ?? "family",
  });
}

/**
 * Route-handler convenience: derives the actor from the request context and is
 * ERROR-SAFE — a failed audit write is logged and swallowed so it never turns a
 * successful operation into a 500. Prefer this in `/api/*` handlers.
 */
export async function audit(
  c: AppContext,
  event: Omit<AuditEvent, "actorUserId"> & { actorUserId?: string | null },
): Promise<void> {
  try {
    await insertAuditEvent(getDb(c.env), {
      ...event,
      actorUserId: event.actorUserId ?? c.get("userId") ?? null,
    });
  } catch (err) {
    console.error(`[audit] failed to record ${event.action}:`, err);
  }
}
