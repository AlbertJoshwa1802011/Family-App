/**
 * Per-document "remind on calendar" — upserts a Family Vault calendar marker
 * ~7 days before a document's expiry so planning shows up in /calendar and in
 * the Google/Apple/Outlook ICS subscribe feed.
 *
 * Privacy: family-visible docs get a real `events` row (shared calendar).
 * Private docs must NOT create a shared event (title would leak via ICS/events
 * list); those rely on a visibility-filtered ICS all-day renew item instead.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { schema } from "../db/client";

/** Days before expiry to place the calendar renew marker. */
export const CALENDAR_REMINDER_LEAD_DAYS = 7;

export const DOCUMENT_EXPIRY_EVENT_SOURCE = "document_expiry";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ExpiryCalendarDoc = {
  id: string;
  familyId: string;
  title: string;
  expiryDate: string | null;
  visibility: "family" | "private" | string;
  status: string;
  calendarReminderEnabled: boolean;
  expiryReminderEventId: string | null;
  ownerUserId: string;
};

/** Subtract whole days from an ISO yyyy-mm-dd (UTC). Null if malformed. */
export function isoMinusDays(iso: string, days: number): string | null {
  if (!ISO_DATE.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d) - days * 86_400_000;
  return new Date(utc).toISOString().slice(0, 10);
}

/** UTC midnight unix-seconds for an ISO calendar date. */
export function isoToAllDayStartSecs(iso: string): number | null {
  if (!ISO_DATE.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 1000);
}

export function renewReminderTitle(docTitle: string): string {
  return `Renew: ${docTitle}`;
}

export function renewReminderDescription(doc: {
  id: string;
  title: string;
  expiryDate: string;
}): string {
  return `Family Vault reminder: "${doc.title}" expires on ${doc.expiryDate}. Open /documents/${doc.id} to renew or update it.`;
}

/**
 * Sync the calendar reminder for one document. Call after create/update/trash.
 * Returns the linked event id (family-visible only), or null when none.
 */
export async function syncExpiryCalendarReminder(
  db: Db,
  doc: ExpiryCalendarDoc,
  actorUserId: string,
): Promise<string | null> {
  const shouldHave =
    doc.calendarReminderEnabled &&
    doc.status === "active" &&
    Boolean(doc.expiryDate) &&
    ISO_DATE.test(doc.expiryDate!);

  // Private docs: never create a shared family event (privacy). Clear any
  // leftover link from a previous family→private flip.
  if (!shouldHave || doc.visibility === "private") {
    await trashLinkedReminderEvent(db, doc);
    return null;
  }

  const renewIso = isoMinusDays(doc.expiryDate!, CALENDAR_REMINDER_LEAD_DAYS);
  const startAt = renewIso ? isoToAllDayStartSecs(renewIso) : null;
  if (!renewIso || startAt === null) {
    await trashLinkedReminderEvent(db, doc);
    return null;
  }

  const title = renewReminderTitle(doc.title);
  const description = renewReminderDescription({
    id: doc.id,
    title: doc.title,
    expiryDate: doc.expiryDate!,
  });
  const now = Math.floor(Date.now() / 1000);

  let eventId = doc.expiryReminderEventId;
  if (eventId) {
    const existing = await db
      .select({ id: schema.events.id, status: schema.events.status })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .get();
    if (!existing || existing.status === "trashed") {
      eventId = null;
    }
  }

  if (eventId) {
    await db
      .update(schema.events)
      .set({
        title,
        description,
        startAt,
        endAt: null,
        allDay: true,
        type: "appointment",
        status: "active",
        trashedAt: null,
        source: DOCUMENT_EXPIRY_EVENT_SOURCE,
        updatedAt: now,
      })
      .where(eq(schema.events.id, eventId));
  } else {
    eventId = crypto.randomUUID();
    await db.insert(schema.events).values({
      id: eventId,
      familyId: doc.familyId,
      title,
      description,
      startAt,
      endAt: null,
      allDay: true,
      type: "appointment",
      status: "active",
      createdBy: actorUserId,
      source: DOCUMENT_EXPIRY_EVENT_SOURCE,
      updatedAt: now,
    });
  }

  // Keep the event↔document link (idempotent).
  await db
    .insert(schema.eventDocuments)
    .values({ eventId, documentId: doc.id })
    .onConflictDoNothing();

  if (doc.expiryReminderEventId !== eventId) {
    await db
      .update(schema.documents)
      .set({ expiryReminderEventId: eventId, updatedAt: now })
      .where(eq(schema.documents.id, doc.id));
  }

  return eventId;
}

async function trashLinkedReminderEvent(
  db: Db,
  doc: ExpiryCalendarDoc,
): Promise<void> {
  if (!doc.expiryReminderEventId) return;
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(schema.events)
    .set({ status: "trashed", trashedAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.events.id, doc.expiryReminderEventId),
        eq(schema.events.source, DOCUMENT_EXPIRY_EVENT_SOURCE),
      ),
    );
  await db
    .update(schema.documents)
    .set({ expiryReminderEventId: null, updatedAt: now })
    .where(eq(schema.documents.id, doc.id));
}
