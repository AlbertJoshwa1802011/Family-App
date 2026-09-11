import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { DEFAULT_WINDOWS, parseWindows } from "../lib/reminders";
import { reminderEmailHtml, sendEmailDetailed, canSendEmail } from "../lib/email";
import { absoluteAppUrl } from "../lib/publicUrl";

export const notificationRoutes = new Hono<HonoEnv>();

const NOTIFICATION_LIMIT = 50;

const prefsSchema = z.object({
  emailEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  // Lead-time windows in days (0 = day of expiry/event); sanitized server-side.
  windows: z.array(z.number().int().min(0).max(365)).max(10).optional(),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

// ── In-app notifications ────────────────────────────────────────────────────────

// GET /notifications?unreadOnly=1 — most recent first, plus unread count.
notificationRoutes.get("/", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const db = getDb(c.env);
  const unreadOnly = c.req.query("unreadOnly") === "1";

  const conditions = [eq(schema.notifications.userId, userId)];
  if (unreadOnly) conditions.push(eq(schema.notifications.read, false));

  const notifications = await db
    .select()
    .from(schema.notifications)
    .where(and(...(conditions as [typeof conditions[0], ...typeof conditions])))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(NOTIFICATION_LIMIT);

  const unread = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.read, false),
      ),
    );

  return c.json({ notifications, unreadCount: unread.length });
});

// POST /notifications/read-all — mark every notification read.
// MUST be registered before /:id/read so "read-all" isn't captured as an :id.
notificationRoutes.post("/read-all", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const db = getDb(c.env);
  await db
    .update(schema.notifications)
    .set({ read: true })
    .where(eq(schema.notifications.userId, userId));
  return c.json({ ok: true });
});

// POST /notifications/test-email — send a one-off reminder to the caller's address.
// MUST be registered before /:id/read so "test-email" isn't captured as an :id.
notificationRoutes.post("/test-email", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  if (!(await canSendEmail(c.env, userId))) {
    return c.json(
      {
        error: "email_not_configured",
        message:
          "Sign out and sign back in to allow Gmail send, or add a Resend API key.",
      },
      503,
    );
  }

  const user = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!user?.email) return c.json({ error: "not_found" }, 404);

  const to = user.email.trim().toLowerCase();
  const appUrl = absoluteAppUrl(c.env, c.req.url);

  const result = await sendEmailDetailed(
    c.env,
    {
      to,
      subject: "Test reminder",
      html: reminderEmailHtml({
        heading: "Family Vault test reminder",
        body: "This is a test. If you received it, reminder email delivery is working.",
        ctaLabel: "Open Family Vault",
        ctaUrl: appUrl,
      }),
      text: "Family Vault test reminder — delivery is working.",
    },
    { fromUserId: userId },
  );

  if (!result.ok) {
    const needsConsent = result.error === "gmail_missing_scope" || result.error === "gmail_auth_failed";
    return c.json(
      {
        error: needsConsent ? "gmail_missing_scope" : "email_send_failed",
        message: needsConsent
          ? "Google has not granted Gmail send yet. Sign out and sign back in, accept Gmail permission, then try again."
          : "Could not send via Gmail or Resend. Sign out/in to grant Gmail send, or add a Resend API key with a verified domain.",
      },
      502,
    );
  }

  return c.json({ ok: true, to, via: result.via, from: result.from });
});

// POST /notifications/:id/read — mark a single notification read.
notificationRoutes.post("/:id/read", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const { id } = c.req.param();
  const db = getDb(c.env);

  const notif = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.id, id))
    .get();

  // 404 (not 403) when it isn't the caller's notification — don't reveal it exists.
  if (!notif || notif.userId !== userId) {
    return c.json({ error: "not_found" }, 404);
  }

  await db
    .update(schema.notifications)
    .set({ read: true })
    .where(eq(schema.notifications.id, id));

  return c.json({ ok: true });
});

// ── Reminder preferences (per user) ──────────────────────────────────────────────

// GET /notifications/prefs — current user's reminder preferences (with defaults).
notificationRoutes.get("/prefs", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  const row = await db
    .select()
    .from(schema.reminderPrefs)
    .where(eq(schema.reminderPrefs.userId, userId))
    .get();

  return c.json({
    prefs: {
      emailEnabled: row?.emailEnabled ?? true,
      pushEnabled: row?.pushEnabled ?? false,
      windows: parseWindows(row?.windowsJson),
      reminderEmail: null,
    },
  });
});

// PUT /notifications/prefs — upsert reminder preferences.
notificationRoutes.put("/prefs", requireSession, zv(prefsSchema), async (c) => {
  const userId = c.get("userId")!;
  const updates = c.req.valid("json");
  const db = getDb(c.env);

  const existing = await db
    .select()
    .from(schema.reminderPrefs)
    .where(eq(schema.reminderPrefs.userId, userId))
    .get();

  // Sanitize/normalize windows the same way the cron reads them.
  const windowsJson =
    updates.windows !== undefined
      ? JSON.stringify(parseWindows(JSON.stringify(updates.windows)))
      : (existing?.windowsJson ?? JSON.stringify(DEFAULT_WINDOWS));

  const emailEnabled = updates.emailEnabled ?? existing?.emailEnabled ?? true;
  const pushEnabled = updates.pushEnabled ?? existing?.pushEnabled ?? false;

  if (existing) {
    await db
      .update(schema.reminderPrefs)
      .set({ emailEnabled, pushEnabled, windowsJson })
      .where(eq(schema.reminderPrefs.userId, userId));
  } else {
    await db
      .insert(schema.reminderPrefs)
      .values({ userId, emailEnabled, pushEnabled, windowsJson });
  }

  return c.json({
    prefs: { emailEnabled, pushEnabled, windows: parseWindows(windowsJson) },
  });
});
