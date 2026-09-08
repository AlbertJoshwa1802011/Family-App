/**
 * Push Family Vault events into each recipient's Google Calendar.
 *
 * Recipients = event creator + invited members who have a Google account and
 * have not declined. Missing refresh tokens / calendar scopes are skipped
 * (user must re-sign-in once after calendar.events was added to OAuth).
 *
 * Never throws to the caller — calendar sync must not break event CRUD.
 */

import { and, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { schema } from "../db/client";
import type { Env } from "../types";
import { isGoogleOAuthConfigured } from "./googleAuth";
import {
  buildGCalEventBody,
  deleteGoogleCalendarEvent,
  GoogleCalendarError,
  insertGoogleCalendarEvent,
  patchGoogleCalendarEvent,
  type FamilyVaultEventForGCal,
} from "./googleCalendar";

async function resolveSyncUserIds(db: Db, eventId: string, createdBy: string): Promise<string[]> {
  const ids = new Set<string>([createdBy]);

  const attendees = await db
    .select({
      userId: schema.familyMembers.userId,
      rsvp: schema.eventAttendees.rsvp,
    })
    .from(schema.eventAttendees)
    .innerJoin(
      schema.familyMembers,
      eq(schema.eventAttendees.memberId, schema.familyMembers.id),
    )
    .where(
      and(
        eq(schema.eventAttendees.eventId, eventId),
        ne(schema.eventAttendees.rsvp, "declined"),
        eq(schema.familyMembers.status, "active"),
      ),
    );

  for (const a of attendees) {
    if (a.userId) ids.add(a.userId);
  }

  return [...ids];
}

async function upsertOne(
  db: Db,
  env: Env,
  event: FamilyVaultEventForGCal,
  userId: string,
  body: ReturnType<typeof buildGCalEventBody>,
  existing: { id: string; googleEventId: string; calendarId: string } | undefined,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const calendarId = existing?.calendarId ?? "primary";

  if (existing) {
    try {
      await patchGoogleCalendarEvent(
        env,
        userId,
        existing.googleEventId,
        body,
        calendarId,
      );
      await db
        .update(schema.eventGoogleSync)
        .set({ syncedAt: now })
        .where(eq(schema.eventGoogleSync.id, existing.id));
      return;
    } catch (e) {
      if (!(e instanceof GoogleCalendarError) || e.statusCode !== 404) throw e;
      // Fall through to insert a fresh copy.
      await db
        .delete(schema.eventGoogleSync)
        .where(eq(schema.eventGoogleSync.id, existing.id));
    }
  }

  const googleEventId = await insertGoogleCalendarEvent(env, userId, body, calendarId);
  await db.insert(schema.eventGoogleSync).values({
    id: crypto.randomUUID(),
    eventId: event.id,
    userId,
    googleEventId,
    calendarId,
    syncedAt: now,
  });
}

async function removeOne(
  db: Db,
  env: Env,
  row: { id: string; userId: string; googleEventId: string; calendarId: string },
): Promise<void> {
  await deleteGoogleCalendarEvent(env, row.userId, row.googleEventId, row.calendarId);
  await db.delete(schema.eventGoogleSync).where(eq(schema.eventGoogleSync.id, row.id));
}

/**
 * Reconcile Google Calendar copies with the current D1 event + guest list.
 * Safe to call after create / update / cancel / RSVP / attendee changes.
 */
export async function syncEventToGoogleCalendars(
  db: Db,
  env: Env,
  eventId: string,
): Promise<void> {
  if (!isGoogleOAuthConfigured(env)) return;

  try {
    const event = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .get();
    if (!event) return;

    const existing = await db
      .select()
      .from(schema.eventGoogleSync)
      .where(eq(schema.eventGoogleSync.eventId, eventId));

    if (event.status === "trashed") {
      for (const row of existing) {
        await removeOne(db, env, row).catch((e) =>
          console.warn("gcal remove on trash failed:", e),
        );
      }
      return;
    }

    const targets = await resolveSyncUserIds(db, eventId, event.createdBy);
    const byUser = new Map(existing.map((r) => [r.userId, r]));
    const appUrl = env.APP_URL || "https://family-vault.local";
    const body = buildGCalEventBody(event, appUrl);

    for (const userId of targets) {
      try {
        await upsertOne(db, env, event, userId, body, byUser.get(userId));
      } catch (e) {
        // Missing token / scope / transient Google error — skip this user.
        console.warn(`gcal sync skipped for user ${userId}:`, e);
      }
    }

    const targetSet = new Set(targets);
    for (const row of existing) {
      if (targetSet.has(row.userId)) continue;
      try {
        await removeOne(db, env, row);
      } catch (e) {
        console.warn(`gcal remove skipped for user ${row.userId}:`, e);
      }
    }
  } catch (e) {
    console.warn(`gcal syncEvent failed for ${eventId}:`, e);
  }
}

/** Drop every Google Calendar copy of an event (delete / trash). */
export async function removeEventFromGoogleCalendars(
  db: Db,
  env: Env,
  eventId: string,
): Promise<void> {
  if (!isGoogleOAuthConfigured(env)) return;
  try {
    const existing = await db
      .select()
      .from(schema.eventGoogleSync)
      .where(eq(schema.eventGoogleSync.eventId, eventId));
    for (const row of existing) {
      await removeOne(db, env, row).catch((e) =>
        console.warn("gcal remove failed:", e),
      );
    }
  } catch (e) {
    console.warn(`gcal removeEvent failed for ${eventId}:`, e);
  }
}

/** Remove Google copies for specific users (uninvite / decline). */
export async function removeUsersFromEventGoogleCalendars(
  db: Db,
  env: Env,
  eventId: string,
  userIds: string[],
): Promise<void> {
  if (!isGoogleOAuthConfigured(env) || userIds.length === 0) return;
  try {
    const rows = await db
      .select()
      .from(schema.eventGoogleSync)
      .where(
        and(
          eq(schema.eventGoogleSync.eventId, eventId),
          inArray(schema.eventGoogleSync.userId, userIds),
        ),
      );
    for (const row of rows) {
      await removeOne(db, env, row).catch((e) =>
        console.warn("gcal remove-user failed:", e),
      );
    }
  } catch (e) {
    console.warn(`gcal removeUsers failed for ${eventId}:`, e);
  }
}

/** Map member IDs → user IDs (skips dependents / inactive). */
export async function userIdsForMembers(
  db: Db,
  memberIds: string[],
): Promise<string[]> {
  if (memberIds.length === 0) return [];
  const rows = await db
    .select({ userId: schema.familyMembers.userId })
    .from(schema.familyMembers)
    .where(
      and(
        inArray(schema.familyMembers.id, memberIds),
        eq(schema.familyMembers.status, "active"),
      ),
    );
  return rows.map((r) => r.userId).filter((id): id is string => Boolean(id));
}
