/**
 * Scheduling conflict detection ("Timmy is already at football practice").
 *
 * Deliberately ADVISORY, never blocking: the organizer is an adult who can see
 * the clash and decide. Create/update responses carry a `conflicts` array; the
 * request still succeeds with 201/200.
 *
 * Overlap is computed on HALF-OPEN intervals [start, end): an event that begins
 * exactly when another ends is back-to-back, not a clash. Events with no endAt
 * are treated as instants of DEFAULT_DURATION so a bare `startAt` still
 * participates sensibly; all-day events span their whole UTC day.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { schema } from "../db/client";

const DAY = 86_400;
/** An event with no endAt still occupies a slot; 30 min is the working default. */
export const DEFAULT_DURATION = 1_800;

export interface Interval {
  startAt: number;
  endAt?: number | null;
  allDay?: boolean | null;
}

/** Resolves an event row to the concrete [start, end) span it occupies. */
export function spanOf(e: Interval): { start: number; end: number } {
  const start = e.allDay ? Math.floor(e.startAt / DAY) * DAY : e.startAt;
  if (e.allDay) {
    // An all-day event covers whole UTC days, from its first to its last.
    const lastDayStart = e.endAt ? Math.floor(e.endAt / DAY) * DAY : start;
    return { start, end: lastDayStart + DAY };
  }
  const end = e.endAt && e.endAt > e.startAt ? e.endAt : e.startAt + DEFAULT_DURATION;
  return { start, end };
}

/** Half-open overlap: [aStart,aEnd) ∩ [bStart,bEnd) ≠ ∅. */
export function overlaps(a: Interval, b: Interval): boolean {
  const x = spanOf(a);
  const y = spanOf(b);
  return x.start < y.end && y.start < x.end;
}

export interface Conflict {
  eventId: string;
  title: string;
  startAt: number;
  endAt: number | null;
  allDay: boolean;
  /** Member ids double-booked by this clash — only the SHARED attendees. */
  memberIds: string[];
}

/**
 * Finds active events in the family that overlap `candidate` AND share at least
 * one attendee with it. Dad's work meeting never conflicts with Timmy's dentist:
 * a clash requires the same person to be in two places.
 *
 * `excludeEventId` skips the event being updated so it never conflicts with itself.
 */
export async function findConflicts(
  db: Db,
  familyId: string,
  candidate: Interval,
  memberIds: string[],
  excludeEventId?: string,
): Promise<Conflict[]> {
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return [];

  // Candidate window widened by a day either side so all-day rows are caught;
  // exact half-open overlap is then decided in JS by `overlaps`.
  const rows = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      startAt: schema.events.startAt,
      endAt: schema.events.endAt,
      allDay: schema.events.allDay,
      memberId: schema.eventAttendees.memberId,
    })
    .from(schema.events)
    .innerJoin(
      schema.eventAttendees,
      eq(schema.eventAttendees.eventId, schema.events.id),
    )
    .where(
      and(
        eq(schema.events.familyId, familyId),
        // Cancelled and trashed events hold no one's time.
        eq(schema.events.status, "active"),
        inArray(schema.eventAttendees.memberId, unique),
        // A declined attendee is not busy.
        ne(schema.eventAttendees.rsvp, "declined"),
      ),
    );

  const byEvent = new Map<string, Conflict>();
  for (const r of rows) {
    if (excludeEventId && r.id === excludeEventId) continue;
    if (!overlaps(candidate, { startAt: r.startAt, endAt: r.endAt, allDay: r.allDay })) {
      continue;
    }
    const existing = byEvent.get(r.id);
    if (existing) {
      existing.memberIds.push(r.memberId);
    } else {
      byEvent.set(r.id, {
        eventId: r.id,
        title: r.title,
        startAt: r.startAt,
        endAt: r.endAt,
        allDay: Boolean(r.allDay),
        memberIds: [r.memberId],
      });
    }
  }

  return [...byEvent.values()].sort((a, b) => a.startAt - b.startAt);
}

export interface BusyBlock {
  memberId: string;
  eventId: string;
  title: string;
  startAt: number;
  endAt: number;
  allDay: boolean;
  rsvp: string;
}

/**
 * Free/busy across the family for a range — "when is everyone free?".
 * Declined attendances are omitted: saying no frees the slot.
 */
export async function busyBlocks(
  db: Db,
  familyId: string,
  from: number,
  to: number,
): Promise<BusyBlock[]> {
  const rows = await db
    .select({
      memberId: schema.eventAttendees.memberId,
      rsvp: schema.eventAttendees.rsvp,
      id: schema.events.id,
      title: schema.events.title,
      startAt: schema.events.startAt,
      endAt: schema.events.endAt,
      allDay: schema.events.allDay,
    })
    .from(schema.eventAttendees)
    .innerJoin(schema.events, eq(schema.eventAttendees.eventId, schema.events.id))
    .where(
      and(
        eq(schema.events.familyId, familyId),
        eq(schema.events.status, "active"),
        ne(schema.eventAttendees.rsvp, "declined"),
      ),
    );

  return rows
    .map((r) => {
      const span = spanOf({ startAt: r.startAt, endAt: r.endAt, allDay: r.allDay });
      return {
        memberId: r.memberId,
        eventId: r.id,
        title: r.title,
        startAt: span.start,
        endAt: span.end,
        allDay: Boolean(r.allDay),
        rsvp: r.rsvp,
      };
    })
    .filter((b) => b.startAt < to && from < b.endAt)
    .sort((a, b) => a.startAt - b.startAt);
}
