/**
 * Notify family members when an event is created or updated.
 * In-app notification always; email is best-effort via Resend.
 */
import type { Env } from "../types";
import type { Db } from "../db/client";
import { schema } from "../db/client";
import { and, eq, inArray } from "drizzle-orm";
import { createNotification } from "./notify";
import { reminderEmailHtml, sendEmail } from "./email";

export async function notifyEventChange(
  env: Env,
  db: Db,
  opts: {
    familyId: string;
    actorUserId: string;
    eventId: string;
    title: string;
    kind: "created" | "updated" | "cancelled";
    attendeeMemberIds: string[];
    whenLabel: string;
  },
): Promise<{ emailsAttempted: number; emailsSent: number }> {
  const actor = await db
    .select({ name: schema.users.name, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, opts.actorUserId))
    .get();

  const memberIds = [...new Set(opts.attendeeMemberIds)];
  const members = memberIds.length
    ? await db
        .select({
          memberId: schema.familyMembers.id,
          userId: schema.familyMembers.userId,
        })
        .from(schema.familyMembers)
        .where(
          and(
            eq(schema.familyMembers.familyId, opts.familyId),
            inArray(schema.familyMembers.id, memberIds),
          ),
        )
    : [];

  const userIds = new Set<string>();
  userIds.add(opts.actorUserId);
  for (const m of members) {
    if (m.userId) userIds.add(m.userId);
  }

  const users = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, [...userIds]));

  const prefs = await db
    .select({
      userId: schema.reminderPrefs.userId,
      emailEnabled: schema.reminderPrefs.emailEnabled,
      reminderEmail: schema.reminderPrefs.reminderEmail,
    })
    .from(schema.reminderPrefs)
    .where(inArray(schema.reminderPrefs.userId, [...userIds]));
  const prefByUser = new Map(prefs.map((p) => [p.userId, p]));

  const verb =
    opts.kind === "created"
      ? "added"
      : opts.kind === "cancelled"
        ? "cancelled"
        : "updated";
  const title = `Event ${verb}: ${opts.title}`;
  const body = `${actor?.name ?? actor?.email ?? "Someone"} ${verb} “${opts.title}” — ${opts.whenLabel}.`;
  const link = `/calendar/events/${opts.eventId}`;
  const appUrl = env.APP_URL ?? "";

  let emailsAttempted = 0;
  let emailsSent = 0;

  for (const u of users) {
    await createNotification(db, {
      userId: u.id,
      familyId: opts.familyId,
      type: `event_${opts.kind}`,
      title,
      body,
      link,
    });

    const pref = prefByUser.get(u.id);
    const emailOn = pref ? pref.emailEnabled : true;
    const to = (pref?.reminderEmail ?? u.email)?.trim().toLowerCase();
    if (!emailOn || !to) continue;
    emailsAttempted += 1;
    const ok = await sendEmail(env, {
      to,
      subject: title,
      html: reminderEmailHtml({
        heading: title,
        body,
        ctaLabel: "Open event",
        ctaUrl: appUrl ? `${appUrl}${link}` : link,
      }),
      text: `${body}\n${appUrl}${link}`,
    });
    if (ok) emailsSent += 1;
  }

  return { emailsAttempted, emailsSent };
}
