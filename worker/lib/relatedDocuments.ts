/**
 * Advisory "related documents" ranking — same family only, visibility filtered
 * by the caller. Scores shared category, subject member, tags, and co-linked
 * events. Never blocks; never crosses family boundaries.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { schema } from "../db/client";

export interface RelatedDocHit {
  id: string;
  title: string;
  category: string;
  score: number;
  reasons: string[];
}

function isDocHiddenFrom(
  doc: { visibility: string; ownerUserId: string },
  userId: string,
  role: string,
): boolean {
  return (
    doc.visibility === "private" &&
    doc.ownerUserId !== userId &&
    role !== "owner" &&
    role !== "admin"
  );
}

export async function findRelatedDocuments(
  db: Db,
  opts: {
    familyId: string;
    documentId: string;
    userId: string;
    role: string;
    limit?: number;
  },
): Promise<RelatedDocHit[]> {
  const limit = opts.limit ?? 8;
  const seed = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, opts.documentId),
        eq(schema.documents.familyId, opts.familyId),
        ne(schema.documents.status, "trashed"),
      ),
    )
    .get();
  if (!seed || isDocHiddenFrom(seed, opts.userId, opts.role)) return [];

  const seedTags = await db
    .select({ tagId: schema.documentTags.tagId })
    .from(schema.documentTags)
    .where(eq(schema.documentTags.documentId, seed.id));
  const seedTagIds = new Set(seedTags.map((t) => t.tagId));

  const seedEvents = await db
    .select({ eventId: schema.eventDocuments.eventId })
    .from(schema.eventDocuments)
    .where(eq(schema.eventDocuments.documentId, seed.id));
  const seedEventIds = seedEvents.map((e) => e.eventId);

  const candidates = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.familyId, opts.familyId),
        ne(schema.documents.status, "trashed"),
        ne(schema.documents.id, seed.id),
      ),
    );

  const visible = candidates.filter(
    (d) => !isDocHiddenFrom(d, opts.userId, opts.role),
  );
  if (visible.length === 0) return [];

  const candIds = visible.map((d) => d.id);
  const allTags =
    candIds.length > 0
      ? await db
          .select({
            documentId: schema.documentTags.documentId,
            tagId: schema.documentTags.tagId,
          })
          .from(schema.documentTags)
          .where(inArray(schema.documentTags.documentId, candIds))
      : [];
  const tagsByDoc = new Map<string, Set<string>>();
  for (const row of allTags) {
    const set = tagsByDoc.get(row.documentId) ?? new Set();
    set.add(row.tagId);
    tagsByDoc.set(row.documentId, set);
  }

  let eventLinked = new Set<string>();
  if (seedEventIds.length > 0) {
    const rows = await db
      .select({ documentId: schema.eventDocuments.documentId })
      .from(schema.eventDocuments)
      .where(inArray(schema.eventDocuments.eventId, seedEventIds));
    eventLinked = new Set(rows.map((r) => r.documentId));
  }

  const scored: RelatedDocHit[] = [];
  for (const d of visible) {
    let score = 0;
    const reasons: string[] = [];
    if (d.category && d.category === seed.category) {
      score += 3;
      reasons.push("same_category");
    }
    if (
      d.subjectMemberId &&
      seed.subjectMemberId &&
      d.subjectMemberId === seed.subjectMemberId
    ) {
      score += 4;
      reasons.push("same_person");
    }
    const sharedTags = [...(tagsByDoc.get(d.id) ?? [])].filter((t) =>
      seedTagIds.has(t),
    );
    if (sharedTags.length > 0) {
      score += 2 * sharedTags.length;
      reasons.push("shared_tags");
    }
    if (eventLinked.has(d.id)) {
      score += 5;
      reasons.push("shared_event");
    }
    if (score > 0) {
      scored.push({
        id: d.id,
        title: d.title,
        category: d.category,
        score,
        reasons,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return scored.slice(0, limit);
}
