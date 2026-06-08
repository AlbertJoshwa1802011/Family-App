import type { Db } from "../db/client";
import { schema } from "../db/client";

interface AuditEvent {
  familyId?: string;
  actorUserId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
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
