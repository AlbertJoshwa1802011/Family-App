import { and, eq, isNotNull, lte, ne } from "drizzle-orm";
import type { Env } from "./types";
import { getDb, type Db } from "./db/client";
import { schema } from "./db/client";
import {
  REMINDER_SCAN_DAYS,
  daysUntilIso,
  daysUntilUnix,
  dueReminderWindow,
  eventReminderText,
  expiryReminderText,
  parseWindows,
} from "./lib/reminders";
import { createNotification } from "./lib/notify";
import { reminderEmailHtml, sendEmail } from "./lib/email";

/** ISO yyyy-mm-dd `daysAhead` days from the instant `nowMs` (UTC). */
function isoDaysAhead(nowMs: number, daysAhead: number): string {
  return new Date(nowMs + daysAhead * 86_400_000).toISOString().slice(0, 10);
}

/** A family member who is a real, notifiable user. */
interface Recipient {
  userId: string;
  /** Where mail actually goes: the reminder override if set, else the login address. */
  email: string;
  windows: number[];
  emailEnabled: boolean;
}

/**
 * Loads the notifiable recipients for a family: active members that map to a
 * real user account (dependents have no userId and can't be notified). Each
 * recipient is decorated with their reminder preferences (windows + email
 * toggle), defaulting sanely when no prefs row exists.
 */
async function loadRecipients(db: Db, familyId: string): Promise<Recipient[]> {
  const rows = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      windowsJson: schema.reminderPrefs.windowsJson,
      emailEnabled: schema.reminderPrefs.emailEnabled,
      reminderEmail: schema.reminderPrefs.reminderEmail,
    })
    .from(schema.familyMembers)
    .innerJoin(schema.users, eq(schema.familyMembers.userId, schema.users.id))
    .leftJoin(schema.reminderPrefs, eq(schema.reminderPrefs.userId, schema.users.id))
    .where(
      and(
        eq(schema.familyMembers.familyId, familyId),
        eq(schema.familyMembers.status, "active"),
        isNotNull(schema.familyMembers.userId),
      ),
    );

  return rows.map((r) => ({
    userId: r.userId,
    // Deliver to the configured inbox when the member set one; the Google
    // sign-in address is only the fallback.
    email: r.reminderEmail ?? r.email,
    windows: parseWindows(r.windowsJson),
    // No prefs row → email defaults ON (matches reminder_prefs.emailEnabled default).
    emailEnabled: r.emailEnabled ?? true,
  }));
}

interface RunStats {
  docsScanned: number;
  eventsScanned: number;
  inAppSent: number;
  emailsSent: number;
}

/**
 * Daily expiry/event reminder job (RANGE-based; Cloudflare cron is best-effort,
 * so we never key off exact equality with "today").
 *
 *  1. Scan active documents whose expiry is within REMINDER_SCAN_DAYS (or past).
 *  2. For each notifiable recipient, pick the tightest due window (see
 *     lib/reminders.dueReminderWindow) and, if not already logged, create an
 *     in-app notification + (when enabled) a Resend email.
 *  3. Record reminders_log rows per channel for idempotent dedupe.
 *  4. Same for upcoming events via event_reminders_log.
 *
 * Every subject is wrapped in try/catch so one bad row can't abort the run.
 */
export async function runExpiryReminders(env: Env): Promise<void> {
  const db = getDb(env);
  const nowMs = Date.now();
  const horizon = isoDaysAhead(nowMs, REMINDER_SCAN_DAYS);
  const appUrl = env.APP_URL ?? "";

  const stats: RunStats = { docsScanned: 0, eventsScanned: 0, inAppSent: 0, emailsSent: 0 };
  const recipientCache = new Map<string, Recipient[]>();

  async function recipientsFor(familyId: string): Promise<Recipient[]> {
    let cached = recipientCache.get(familyId);
    if (!cached) {
      cached = await loadRecipients(db, familyId);
      recipientCache.set(familyId, cached);
    }
    return cached;
  }

  // ── Documents ───────────────────────────────────────────────────────────────
  const docs = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.status, "active"),
        isNotNull(schema.documents.expiryDate),
        lte(schema.documents.expiryDate, horizon),
      ),
    );

  for (const doc of docs) {
    stats.docsScanned++;
    try {
      const daysUntil = daysUntilIso(doc.expiryDate!, nowMs);
      if (daysUntil === null) continue;

      const all = await recipientsFor(doc.familyId);
      // Private docs only remind their owner; family docs remind everyone.
      const recipients =
        doc.visibility === "private"
          ? all.filter((r) => r.userId === doc.ownerUserId)
          : all;

      for (const r of recipients) {
        const window = dueReminderWindow(daysUntil, r.windows);
        if (window === null) continue;
        const text = expiryReminderText(doc.title, daysUntil);
        const link = `/documents/${doc.id}`;

        if (
          await recordReminderOnce(db, "doc_in_app", {
            documentId: doc.id,
            userId: r.userId,
            windowDays: window,
            channel: "in_app",
          })
        ) {
          await createNotification(db, {
            userId: r.userId,
            familyId: doc.familyId,
            type: "expiry",
            title: text.title,
            body: text.body,
            link,
          });
          stats.inAppSent++;
        }

        if (
          r.emailEnabled &&
          r.email &&
          (await recordReminderOnce(db, "doc_email", {
            documentId: doc.id,
            userId: r.userId,
            windowDays: window,
            channel: "email",
          }))
        ) {
          const ok = await sendEmail(env, {
            to: r.email,
            subject: text.title,
            html: reminderEmailHtml({
              heading: text.title,
              body: text.body,
              ctaLabel: "View document",
              ctaUrl: `${appUrl}${link}`,
            }),
          });
          if (ok) stats.emailsSent++;
          else await unrecordReminder(db, "doc_email", doc.id, r.userId, window);
        }
      }
    } catch (err) {
      console.error(`[cron] document ${doc.id} reminder failed:`, err);
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────────
  const nowSecs = Math.floor(nowMs / 1000);
  const events = await db
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.status, "active"),
        lte(schema.events.startAt, nowSecs + REMINDER_SCAN_DAYS * 86_400),
        ne(schema.events.status, "trashed"),
      ),
    );

  for (const ev of events) {
    stats.eventsScanned++;
    try {
      const daysUntil = daysUntilUnix(ev.startAt, nowMs);
      if (daysUntil < 0) continue; // past events don't remind
      const recipients = await recipientsFor(ev.familyId);

      for (const r of recipients) {
        const window = dueReminderWindow(daysUntil, r.windows);
        if (window === null) continue;
        const text = eventReminderText(ev.title, daysUntil);
        const link = `/calendar/events/${ev.id}`;

        if (
          await recordReminderOnce(db, "event_in_app", {
            eventId: ev.id,
            userId: r.userId,
            windowDays: window,
            channel: "in_app",
          })
        ) {
          await createNotification(db, {
            userId: r.userId,
            familyId: ev.familyId,
            type: "event",
            title: text.title,
            body: text.body,
            link,
          });
          stats.inAppSent++;
        }

        if (
          r.emailEnabled &&
          r.email &&
          (await recordReminderOnce(db, "event_email", {
            eventId: ev.id,
            userId: r.userId,
            windowDays: window,
            channel: "email",
          }))
        ) {
          const ok = await sendEmail(env, {
            to: r.email,
            subject: text.title,
            html: reminderEmailHtml({
              heading: text.title,
              body: text.body,
              ctaLabel: "View event",
              ctaUrl: `${appUrl}${link}`,
            }),
          });
          if (ok) stats.emailsSent++;
          else await unrecordReminder(db, "event_email", ev.id, r.userId, window);
        }
      }
    } catch (err) {
      console.error(`[cron] event ${ev.id} reminder failed:`, err);
    }
  }

  console.log(
    `[cron] reminders done: docs=${stats.docsScanned} events=${stats.eventsScanned} ` +
      `in_app=${stats.inAppSent} emails=${stats.emailsSent}`,
  );
}

type DocLog = {
  documentId: string;
  userId: string;
  windowDays: number;
  channel: "in_app" | "email";
};
type EventLog = {
  eventId: string;
  userId: string;
  windowDays: number;
  channel: "in_app" | "email";
};

/**
 * Atomically claims a (subject, user, window, channel) slot in the dedupe log.
 * Returns true if THIS call inserted the row (so the caller should send), false
 * if a row already existed (already sent). Relies on the unique constraint +
 * onConflictDoNothing for race-free idempotency.
 */
async function recordReminderOnce(
  db: Db,
  kind: "doc_in_app" | "doc_email" | "event_in_app" | "event_email",
  log: DocLog | EventLog,
): Promise<boolean> {
  if (kind.startsWith("doc")) {
    const l = log as DocLog;
    const res = await db
      .insert(schema.remindersLog)
      .values({
        id: crypto.randomUUID(),
        documentId: l.documentId,
        userId: l.userId,
        windowDays: l.windowDays,
        channel: l.channel,
      })
      .onConflictDoNothing()
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }
  const l = log as EventLog;
  const res = await db
    .insert(schema.eventRemindersLog)
    .values({
      id: crypto.randomUUID(),
      eventId: l.eventId,
      userId: l.userId,
      windowDays: l.windowDays,
      channel: l.channel,
    })
    .onConflictDoNothing()
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Removes an email dedupe row so a failed send is retried next run. */
async function unrecordReminder(
  db: Db,
  kind: "doc_email" | "event_email",
  subjectId: string,
  userId: string,
  windowDays: number,
): Promise<void> {
  if (kind === "doc_email") {
    await db
      .delete(schema.remindersLog)
      .where(
        and(
          eq(schema.remindersLog.documentId, subjectId),
          eq(schema.remindersLog.userId, userId),
          eq(schema.remindersLog.windowDays, windowDays),
          eq(schema.remindersLog.channel, "email"),
        ),
      );
  } else {
    await db
      .delete(schema.eventRemindersLog)
      .where(
        and(
          eq(schema.eventRemindersLog.eventId, subjectId),
          eq(schema.eventRemindersLog.userId, userId),
          eq(schema.eventRemindersLog.windowDays, windowDays),
          eq(schema.eventRemindersLog.channel, "email"),
        ),
      );
  }
}
