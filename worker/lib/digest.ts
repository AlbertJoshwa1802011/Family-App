/**
 * Weekly family digest — "your family week ahead" report email.
 *
 * Runs from the daily cron but only sends on Mondays (UTC), deduped per
 * (user, ISO week) via digest_log so retries/cron overlaps can't double-send.
 * Respects reminder email preferences and private-document visibility.
 */
import { and, eq, gte, isNotNull, lte, ne, sql } from "drizzle-orm";
import type { Env } from "../types";
import { getDb, type Db, schema } from "../db/client";
import { sendEmail } from "./email";
import { weeklyDigestEmail, type DigestData } from "./emailTemplates";

/** ISO-8601 week key, e.g. "2026-W28". */
export function isoWeekKey(date: Date): string {
  // Thursday of the current week decides the ISO year/week.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function isoDaysAhead(nowMs: number, days: number): string {
  return new Date(nowMs + days * 86_400_000).toISOString().slice(0, 10);
}

function daysUntilIso(dateStr: string, nowMs: number): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const today = new Date(nowMs);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - todayUtc) / 86_400_000);
}

function periodLabel(nowMs: number): string {
  const fmt = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });
  const start = new Date(nowMs);
  const end = new Date(nowMs + 6 * 86_400_000);
  return `${fmt.format(start)} – ${fmt.format(end)} ${end.getUTCFullYear()}`;
}

/** True if this (user, week) was already sent; records it otherwise. */
async function claimDigestSlot(db: Db, userId: string, periodKey: string): Promise<boolean> {
  const res = await db
    .insert(schema.digestLog)
    .values({ id: crypto.randomUUID(), userId, periodKey })
    .onConflictDoNothing()
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function runWeeklyDigest(
  env: Env,
  nowMs = Date.now(),
): Promise<{ sent: number }> {
  // Monday-only (UTC). The cron fires daily; other days are a no-op.
  if (new Date(nowMs).getUTCDay() !== 1) return { sent: 0 };

  const db = getDb(env);
  const week = isoWeekKey(new Date(nowMs));
  const appUrl = env.APP_URL ?? "";
  const nowSecs = Math.floor(nowMs / 1000);
  let sent = 0;

  // Recipients: active user-members with email reminders enabled (default on).
  const recipients = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      familyId: schema.familyMembers.familyId,
      role: schema.familyMembers.role,
      // aliased: would otherwise collide with users.name in the result row
      familyName: sql<string>`${schema.families.name}`.as("family_name"),
      emailEnabled: schema.reminderPrefs.emailEnabled,
    })
    .from(schema.familyMembers)
    .innerJoin(schema.users, eq(schema.familyMembers.userId, schema.users.id))
    .innerJoin(schema.families, eq(schema.familyMembers.familyId, schema.families.id))
    .leftJoin(schema.reminderPrefs, eq(schema.reminderPrefs.userId, schema.users.id))
    .where(eq(schema.familyMembers.status, "active"));

  // One digest per user for their FIRST family (multi-family users get their
  // active memberships merged in a future iteration; one clear report beats
  // a confusing merge for v1).
  const seen = new Set<string>();
  for (const r of recipients) {
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);
    if (!(r.emailEnabled ?? true) || !r.email) continue;

    try {
      const [expiringDocs, weekEvents, openTasks] = await Promise.all([
        db
          .select()
          .from(schema.documents)
          .where(
            and(
              eq(schema.documents.familyId, r.familyId),
              eq(schema.documents.status, "active"),
              isNotNull(schema.documents.expiryDate),
              lte(schema.documents.expiryDate, isoDaysAhead(nowMs, 30)),
            ),
          ),
        db
          .select()
          .from(schema.events)
          .where(
            and(
              eq(schema.events.familyId, r.familyId),
              eq(schema.events.status, "active"),
              gte(schema.events.startAt, nowSecs),
              lte(schema.events.startAt, nowSecs + 7 * 86_400),
            ),
          ),
        db
          .select()
          .from(schema.tasks)
          .where(
            and(
              eq(schema.tasks.familyId, r.familyId),
              eq(schema.tasks.status, "open"),
              ne(schema.tasks.title, ""),
            ),
          ),
      ]);

      // Private docs only appear for their owner (or family owner/admin).
      const visibleExpiring = expiringDocs.filter(
        (doc) =>
          doc.visibility !== "private" ||
          doc.ownerUserId === r.userId ||
          r.role === "owner" ||
          r.role === "admin",
      );

      // Skip completely empty weeks — no-news emails train people to unsubscribe.
      if (visibleExpiring.length === 0 && weekEvents.length === 0 && openTasks.length === 0) {
        continue;
      }

      if (!(await claimDigestSlot(db, r.userId, week))) continue;

      const timeFmt = new Intl.DateTimeFormat("en", {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
      });

      const data: DigestData = {
        recipientName: r.name,
        familyName: r.familyName,
        appUrl,
        periodLabel: periodLabel(nowMs),
        expiring: visibleExpiring
          .map((doc) => ({
            title: doc.title,
            expiryDate: doc.expiryDate!,
            daysLeft: daysUntilIso(doc.expiryDate!, nowMs),
            link: `${appUrl}/documents/${doc.id}`,
          }))
          .sort((a, b) => a.daysLeft - b.daysLeft)
          .slice(0, 8),
        events: weekEvents
          .sort((a, b) => a.startAt - b.startAt)
          .slice(0, 8)
          .map((ev) => ({
            title: ev.title,
            when: ev.allDay
              ? new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(ev.startAt * 1000))
              : timeFmt.format(new Date(ev.startAt * 1000)),
            location: ev.location,
          })),
        openTasks: openTasks.slice(0, 8).map((tk) => ({
          title: tk.title,
          dueDate: tk.dueDate,
          assignee: null,
        })),
      };

      const ok = await sendEmail(env, {
        to: r.email,
        subject: `Your family week ahead — ${data.periodLabel}`,
        html: weeklyDigestEmail(data),
      });
      if (ok) sent++;
    } catch (err) {
      console.error(`[digest] failed for user ${r.userId}:`, err);
    }
  }

  console.log(`[digest] ${week}: sent=${sent}`);
  return { sent };
}
