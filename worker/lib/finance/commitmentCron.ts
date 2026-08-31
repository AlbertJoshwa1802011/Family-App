/**
 * Daily commitment sweep: materialise upcoming due dates, remind their owner,
 * and (when asked) log the expense automatically.
 *
 * This is what makes reminders independent of app usage — it runs from the
 * Worker's scheduled() handler, so a commitment configured months ago still
 * emails on time even if nobody has opened the site since.
 *
 * Idempotency comes from `commitment_payments`: the unique (commitmentId,
 * periodKey) index means a re-run can't create a second row, and `remindedAt`
 * means it can't re-notify.
 */

import { and, eq } from "drizzle-orm";
import type { Env } from "../../types";
import { getDb, schema, type Db } from "../../db/client";
import { createNotification } from "../notify";
import { reminderEmailHtml, sendEmail } from "../email";
import { dueDatesBetween, periodKeyFor, addDays, toUtc } from "./periods";

/** How far ahead to materialise the schedule, in days. */
const HORIZON_DAYS = 45;

export interface CommitmentCronStats {
  commitmentsScanned: number;
  periodsCreated: number;
  remindersSent: number;
  emailsSent: number;
  expensesLogged: number;
}

function money(amountMinor: number, currency: string): string {
  // Minor units are 2dp for every currency this app currently supports.
  const major = (amountMinor / 100).toFixed(2);
  return `${currency} ${major}`;
}

/** Resolve a member's delivery address and email opt-in. */
async function ownerContact(
  db: Db,
  userId: string,
): Promise<{ email: string | null; emailEnabled: boolean }> {
  const row = await db
    .select({
      email: schema.users.email,
      reminderEmail: schema.reminderPrefs.reminderEmail,
      emailEnabled: schema.reminderPrefs.emailEnabled,
    })
    .from(schema.users)
    .leftJoin(schema.reminderPrefs, eq(schema.reminderPrefs.userId, schema.users.id))
    .where(eq(schema.users.id, userId))
    .get();

  if (!row) return { email: null, emailEnabled: false };
  return {
    email: row.reminderEmail ?? row.email,
    emailEnabled: row.emailEnabled ?? true,
  };
}

export async function runCommitmentReminders(
  env: Env,
  nowMs = Date.now(),
): Promise<CommitmentCronStats> {
  const db = getDb(env);
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const horizon = addDays(today, HORIZON_DAYS);
  const appUrl = env.APP_URL ?? "";

  const stats: CommitmentCronStats = {
    commitmentsScanned: 0,
    periodsCreated: 0,
    remindersSent: 0,
    emailsSent: 0,
    expensesLogged: 0,
  };

  const active = await db
    .select()
    .from(schema.commitments)
    .where(eq(schema.commitments.status, "active"));

  for (const c of active) {
    stats.commitmentsScanned++;
    try {
      // Percent-of-income commitments need this cycle's income to price, which
      // the overview computes on read. Skip auto-logging them; still remind.
      const perOccurrence = c.amountKind === "fixed" ? (c.amountMinor ?? 0) : 0;

      const dueDates = dueDatesBetween(
        {
          cadence: c.cadence,
          startDate: c.startDate,
          endDate: c.endDate,
          dayOfMonth: c.dayOfMonth,
          dayOfWeek: c.dayOfWeek,
          totalInstallments: c.totalInstallments,
        },
        // Look slightly back so a missed run still catches yesterday's due date.
        addDays(today, -7),
        horizon,
      );

      for (const dueDate of dueDates) {
        const periodKey = periodKeyFor(c.cadence, dueDate);

        // Claim the period row. onConflictDoNothing makes this race-free.
        const insert = await db
          .insert(schema.commitmentPayments)
          .values({
            id: crypto.randomUUID(),
            commitmentId: c.id,
            periodKey,
            dueDate,
            amountMinor: perOccurrence,
            currency: c.currency,
          })
          .onConflictDoNothing()
          .run();
        if ((insert.meta?.changes ?? 0) > 0) stats.periodsCreated++;

        const period = await db
          .select()
          .from(schema.commitmentPayments)
          .where(
            and(
              eq(schema.commitmentPayments.commitmentId, c.id),
              eq(schema.commitmentPayments.periodKey, periodKey),
            ),
          )
          .get();
        if (!period) continue;

        const daysUntil = Math.round(
          (toUtc(dueDate) - toUtc(today)) / 86_400_000,
        );

        // ── Auto-log the expense on/after the due date ───────────────────────
        if (
          c.autoLog &&
          !period.expenseId &&
          perOccurrence > 0 &&
          daysUntil <= 0
        ) {
          const member = await db
            .select({ id: schema.familyMembers.id })
            .from(schema.familyMembers)
            .where(
              and(
                eq(schema.familyMembers.familyId, c.familyId),
                eq(schema.familyMembers.userId, c.ownerUserId),
                eq(schema.familyMembers.status, "active"),
              ),
            )
            .get();

          if (member) {
            const expenseId = crypto.randomUUID();
            await db.insert(schema.expenses).values({
              id: expenseId,
              familyId: c.familyId,
              paidByMemberId: member.id,
              categoryId: c.categoryId,
              amountMinor: perOccurrence,
              currency: c.currency,
              expenseDate: dueDate,
              merchant: c.name,
              description: `Automatic ${c.kind} entry`,
              visibility: c.visibility,
              createdByUserId: c.ownerUserId,
            });
            await db
              .update(schema.commitmentPayments)
              .set({ expenseId, paid: true, paidAt: Math.floor(nowMs / 1000) })
              .where(eq(schema.commitmentPayments.id, period.id));
            stats.expensesLogged++;
          }
        }

        // ── Remind, once, inside the lead-time window ───────────────────────
        const inWindow = daysUntil >= 0 && daysUntil <= c.remindDaysBefore;
        if (!inWindow || period.remindedAt || period.paid) continue;

        const amountText =
          perOccurrence > 0 ? ` — ${money(perOccurrence, c.currency)}` : "";
        const title =
          daysUntil === 0
            ? `${c.name} is due today${amountText}`
            : `${c.name} is due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}${amountText}`;
        const body =
          c.totalInstallments
            ? `Scheduled for ${dueDate}. Part of a ${c.totalInstallments}-installment plan.`
            : `Scheduled for ${dueDate}.`;

        // Mark first: a duplicate email is worse than a missed one here,
        // and the in-app notification is the durable record either way.
        await db
          .update(schema.commitmentPayments)
          .set({ remindedAt: Math.floor(nowMs / 1000) })
          .where(eq(schema.commitmentPayments.id, period.id));

        await createNotification(db, {
          userId: c.ownerUserId,
          familyId: c.familyId,
          type: "expiry",
          title,
          body,
          link: "/money/commitments",
        });
        stats.remindersSent++;

        const contact = await ownerContact(db, c.ownerUserId);
        if (contact.emailEnabled && contact.email) {
          const ok = await sendEmail(env, {
            to: contact.email,
            subject: title,
            html: reminderEmailHtml({
              heading: title,
              body,
              ctaLabel: "Review commitments",
              ctaUrl: `${appUrl}/money/commitments`,
            }),
          });
          if (ok) stats.emailsSent++;
        }
      }
    } catch (err) {
      console.error(`[cron] commitment ${c.id} failed:`, err);
    }
  }

  console.log(
    `[cron] commitments done: scanned=${stats.commitmentsScanned} ` +
      `periods=${stats.periodsCreated} reminders=${stats.remindersSent} ` +
      `emails=${stats.emailsSent} autologged=${stats.expensesLogged}`,
  );
  return stats;
}
