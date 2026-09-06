/**
 * Scheduling notifications — telling people what was scheduled *for them*.
 *
 * Family Vault's whole point is that one member arranges something on another
 * member's behalf. Before this module the only in-app notifications came from
 * the daily cron and from chat @mentions, so being added to an event produced
 * nothing until a reminder window happened to open — for an event booked two
 * months out that is a month of silence, while the UI already promised
 * "Tagged members will be notified" (src/pages/EventForm.tsx).
 *
 * Rules that hold for every function here:
 *  - The actor is never notified about their own action.
 *  - Dependents (member_type='dependent', user_id NULL) have no account, so
 *    they are silently skipped — their guardians see the event on the family
 *    calendar.
 *  - Only 'active' members are notified; invited/removed members are not.
 *  - Email is best-effort and follows the member's reminder_prefs.emailEnabled;
 *    a failed send never fails the request that triggered it.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { schema } from "../db/client";
import type { Env } from "../types";
import { createNotification } from "./notify";
import { sendEmail } from "./email";
import { reminderEmail } from "./emailTemplates";

export interface NotifyTarget {
  userId: string;
  email: string | null;
  emailEnabled: boolean;
}

/**
 * Resolves family-member ids to notifiable users, dropping dependents,
 * non-active members and the actor themselves.
 */
export async function targetsForMembers(
  db: Db,
  memberIds: string[],
  actorUserId: string | null,
): Promise<NotifyTarget[]> {
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return [];

  const rows = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      emailEnabled: schema.reminderPrefs.emailEnabled,
    })
    .from(schema.familyMembers)
    .innerJoin(schema.users, eq(schema.familyMembers.userId, schema.users.id))
    .leftJoin(schema.reminderPrefs, eq(schema.reminderPrefs.userId, schema.users.id))
    .where(
      and(
        inArray(schema.familyMembers.id, unique),
        eq(schema.familyMembers.status, "active"),
        isNotNull(schema.familyMembers.userId),
      ),
    );

  const seen = new Set<string>();
  const out: NotifyTarget[] = [];
  for (const r of rows) {
    if (r.userId === actorUserId) continue; // never notify the actor
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);
    // No prefs row → email defaults ON (matches reminder_prefs default).
    out.push({ userId: r.userId, email: r.email, emailEnabled: r.emailEnabled ?? true });
  }
  return out;
}

/** All active attendee member ids of an event, optionally excluding declines. */
export async function attendeeMemberIds(
  db: Db,
  eventId: string,
  opts: { excludeDeclined?: boolean } = {},
): Promise<string[]> {
  const rows = await db
    .select({ memberId: schema.eventAttendees.memberId, rsvp: schema.eventAttendees.rsvp })
    .from(schema.eventAttendees)
    .where(eq(schema.eventAttendees.eventId, eventId));
  return rows
    .filter((r) => !opts.excludeDeclined || r.rsvp !== "declined")
    .map((r) => r.memberId);
}

function fmtWhen(startAtSecs: number, allDay: boolean): string {
  const d = new Date(startAtSecs * 1000);
  const date = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  if (allDay) return date;
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `${date} at ${time} UTC`;
}

interface DispatchOpts {
  db: Db;
  env: Env;
  targets: NotifyTarget[];
  familyId: string;
  type: string;
  title: string;
  body: string;
  link: string;
  ctaLabel: string;
  urgency?: "info" | "warning" | "danger";
}

/**
 * Writes an in-app notification for each target and best-effort emails them.
 * Never throws: a scheduling mutation must not fail because email is down.
 */
async function dispatch(o: DispatchOpts): Promise<number> {
  let sent = 0;
  const appUrl = o.env.APP_URL ?? "";
  for (const t of o.targets) {
    try {
      await createNotification(o.db, {
        userId: t.userId,
        familyId: o.familyId,
        type: o.type,
        title: o.title,
        body: o.body,
        link: o.link,
      });
      sent++;
      if (t.emailEnabled && t.email) {
        await sendEmail(o.env, {
          to: t.email,
          subject: o.title,
          html: reminderEmail({
            heading: o.title,
            body: o.body,
            ctaLabel: o.ctaLabel,
            ctaUrl: `${appUrl}${o.link}`,
            urgency: o.urgency ?? "info",
          }),
        });
      }
    } catch (err) {
      console.error(`[scheduleNotify] ${o.type} → ${t.userId} failed:`, err);
    }
  }
  return sent;
}

export interface EventSummary {
  id: string;
  familyId: string;
  title: string;
  startAt: number;
  allDay: boolean;
  location?: string | null;
}

/** "Dad added you to Dentist — Tue 9 Sep at 10:00 UTC". */
export async function notifyEventInvited(
  db: Db,
  env: Env,
  ev: EventSummary,
  memberIds: string[],
  actor: { userId: string; name: string },
): Promise<number> {
  const targets = await targetsForMembers(db, memberIds, actor.userId);
  if (targets.length === 0) return 0;
  return dispatch({
    db,
    env,
    targets,
    familyId: ev.familyId,
    type: "event_invite",
    title: `${actor.name} added you to "${ev.title}"`,
    body: `${fmtWhen(ev.startAt, ev.allDay)}${ev.location ? ` · ${ev.location}` : ""}`,
    link: `/calendar/events/${ev.id}`,
    ctaLabel: "View event",
  });
}

/** Sent to every attendee (and the creator) when the time or place moves. */
export async function notifyEventRescheduled(
  db: Db,
  env: Env,
  ev: EventSummary,
  memberIds: string[],
  actor: { userId: string; name: string },
  previousStartAt: number,
): Promise<number> {
  const targets = await targetsForMembers(db, memberIds, actor.userId);
  if (targets.length === 0) return 0;
  return dispatch({
    db,
    env,
    targets,
    familyId: ev.familyId,
    type: "event_rescheduled",
    title: `"${ev.title}" moved`,
    body:
      `${actor.name} changed it from ${fmtWhen(previousStartAt, ev.allDay)} ` +
      `to ${fmtWhen(ev.startAt, ev.allDay)}.`,
    link: `/calendar/events/${ev.id}`,
    ctaLabel: "View event",
    urgency: "warning",
  });
}

export async function notifyEventCancelled(
  db: Db,
  env: Env,
  ev: EventSummary,
  memberIds: string[],
  actor: { userId: string; name: string },
): Promise<number> {
  const targets = await targetsForMembers(db, memberIds, actor.userId);
  if (targets.length === 0) return 0;
  return dispatch({
    db,
    env,
    targets,
    familyId: ev.familyId,
    type: "event_cancelled",
    title: `"${ev.title}" was cancelled`,
    body: `${actor.name} cancelled the event set for ${fmtWhen(ev.startAt, ev.allDay)}.`,
    link: `/calendar/events/${ev.id}`,
    ctaLabel: "View event",
    urgency: "danger",
  });
}

/** Told to people dropped from the attendee list, so they stop planning for it. */
export async function notifyEventUninvited(
  db: Db,
  env: Env,
  ev: EventSummary,
  memberIds: string[],
  actor: { userId: string; name: string },
): Promise<number> {
  const targets = await targetsForMembers(db, memberIds, actor.userId);
  if (targets.length === 0) return 0;
  return dispatch({
    db,
    env,
    targets,
    familyId: ev.familyId,
    type: "event_uninvited",
    title: `You were removed from "${ev.title}"`,
    body: `${actor.name} removed you from the event on ${fmtWhen(ev.startAt, ev.allDay)}.`,
    link: "/calendar",
    ctaLabel: "Open calendar",
  });
}

/** Back-channel: the organizer learns how an attendee answered. */
export async function notifyRsvpAnswered(
  db: Db,
  env: Env,
  ev: EventSummary,
  organizerMemberIds: string[],
  actor: { userId: string; name: string },
  rsvp: string,
  onBehalfOf?: string | null,
): Promise<number> {
  const targets = await targetsForMembers(db, organizerMemberIds, actor.userId);
  if (targets.length === 0) return 0;
  const who = onBehalfOf ? `${actor.name} (for ${onBehalfOf})` : actor.name;
  return dispatch({
    db,
    env,
    targets,
    familyId: ev.familyId,
    type: "event_rsvp",
    title: `${who} ${rsvp} "${ev.title}"`,
    body: `${fmtWhen(ev.startAt, ev.allDay)}`,
    link: `/calendar/events/${ev.id}`,
    ctaLabel: "View event",
  });
}

export interface TaskSummary {
  id: string;
  familyId: string;
  title: string;
  dueDate?: string | null;
}

export async function notifyTaskAssigned(
  db: Db,
  env: Env,
  task: TaskSummary,
  memberIds: string[],
  actor: { userId: string; name: string },
): Promise<number> {
  const targets = await targetsForMembers(db, memberIds, actor.userId);
  if (targets.length === 0) return 0;
  return dispatch({
    db,
    env,
    targets,
    familyId: task.familyId,
    type: "task_assigned",
    title: `${actor.name} assigned you "${task.title}"`,
    body: task.dueDate ? `Due ${task.dueDate}.` : "No due date set.",
    link: `/tasks/${task.id}`,
    ctaLabel: "View task",
  });
}

/** The previous assignee learns the job is no longer theirs. */
export async function notifyTaskUnassigned(
  db: Db,
  env: Env,
  task: TaskSummary,
  memberIds: string[],
  actor: { userId: string; name: string },
): Promise<number> {
  const targets = await targetsForMembers(db, memberIds, actor.userId);
  if (targets.length === 0) return 0;
  return dispatch({
    db,
    env,
    targets,
    familyId: task.familyId,
    type: "task_unassigned",
    title: `"${task.title}" was reassigned`,
    body: `${actor.name} moved this task to someone else.`,
    link: "/tasks",
    ctaLabel: "Open tasks",
  });
}
