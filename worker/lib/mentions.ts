/**
 * Tag-a-family-member notifications.
 *
 * Two entry points share one delivery path (in-app notification + best-effort
 * email honoring the recipient's email preference):
 *  - chat @mentions ("@Priya don't forget the passport")
 *  - explicit document reminders ("Remind…" on a document)
 */
import { and, eq, isNotNull } from "drizzle-orm";
import type { Env } from "../types";
import type { Db } from "../db/client";
import { schema } from "../db/client";
import { createNotification } from "./notify";
import { sendEmail } from "./email";
import { reminderEmail } from "./emailTemplates";

export interface MentionableMember {
  userId: string;
  name: string | null;
  email: string;
  emailEnabled: boolean;
}

/** Active user-members of a family with their email preference. */
export async function loadMentionableMembers(
  db: Db,
  familyId: string,
): Promise<MentionableMember[]> {
  const rows = await db
    .select({
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      emailEnabled: schema.reminderPrefs.emailEnabled,
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
  return rows.map((r) => ({ ...r, emailEnabled: r.emailEnabled ?? true }));
}

/**
 * Finds members tagged in a message. A mention is "@" followed by the member's
 * first name or full name (case-insensitive); "@everyone" tags all members.
 */
export function findMentions(
  body: string,
  members: MentionableMember[],
): MentionableMember[] {
  const lower = body.toLowerCase();
  if (/@everyone\b/.test(lower)) return members;

  const hit = new Map<string, MentionableMember>();
  for (const m of members) {
    if (!m.name) continue;
    const candidates = [m.name, m.name.split(/\s+/)[0]];
    for (const cand of candidates) {
      if (cand && lower.includes(`@${cand.toLowerCase()}`)) {
        hit.set(m.userId, m);
        break;
      }
    }
  }
  return [...hit.values()];
}

/** Delivers one tag/remind notification (in-app always, email if enabled). */
export async function notifyMember(
  env: Env,
  db: Db,
  opts: {
    recipient: MentionableMember;
    familyId: string;
    type: "mention" | "reminder";
    title: string;
    body: string;
    link: string;
  },
): Promise<void> {
  await createNotification(db, {
    userId: opts.recipient.userId,
    familyId: opts.familyId,
    type: opts.type,
    title: opts.title,
    body: opts.body,
    link: opts.link,
  });

  if (opts.recipient.emailEnabled && opts.recipient.email) {
    const appUrl = env.APP_URL ?? "";
    await sendEmail(env, {
      to: opts.recipient.email,
      subject: opts.title,
      html: reminderEmail({
        heading: opts.title,
        body: opts.body,
        ctaLabel: "Open Family Vault",
        ctaUrl: `${appUrl}${opts.link}`,
        urgency: "info",
      }),
    });
  }
}
