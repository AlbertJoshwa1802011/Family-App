import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { schema } from "../db/client";

/**
 * Cross-family reference guards. Any client-supplied ID that gets written into
 * a join/FK column (event attendees, linked documents, task assignee, related
 * doc/event) must be proven to belong to the same family first — otherwise a
 * member of family A can attach rows that reference family B's data.
 */

export async function allMembersInFamily(
  db: Db,
  familyId: string,
  memberIds: string[],
): Promise<boolean> {
  if (memberIds.length === 0) return true;
  const unique = [...new Set(memberIds)];
  const rows = await db
    .select({ id: schema.familyMembers.id })
    .from(schema.familyMembers)
    .where(
      and(
        eq(schema.familyMembers.familyId, familyId),
        inArray(schema.familyMembers.id, unique),
      ),
    );
  return rows.length === unique.length;
}

export async function allDocumentsInFamily(
  db: Db,
  familyId: string,
  documentIds: string[],
): Promise<boolean> {
  if (documentIds.length === 0) return true;
  const unique = [...new Set(documentIds)];
  const rows = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.familyId, familyId),
        inArray(schema.documents.id, unique),
      ),
    );
  return rows.length === unique.length;
}

export async function eventInFamily(
  db: Db,
  familyId: string,
  eventId: string,
): Promise<boolean> {
  const row = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(and(eq(schema.events.id, eventId), eq(schema.events.familyId, familyId)))
    .get();
  return Boolean(row);
}
