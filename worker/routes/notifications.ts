import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { parseWindows } from "../lib/reminders";
import { reminderEmailHtml, sendEmailDetailed, canSendEmail } from "../lib/email";

export const notificationRoutes = new Hono<HonoEnv>();

const NOTIFICATION_LIMIT = 50;

const prefsSchema = z.object({
  emailEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  // Lead-time windows in days; sanitized server-side before storage.
  windows: z.array(z.number().int().positive().max(365)).max(10).optional(),
  // Where reminders are delivered. Empty string or null clears the override and
  // falls back to the account's sign-in address.
  reminderEmail: z.union([z.string().email().max(320), z.literal(""), z.null()]).optional(),
  digestEnabled: z.boolean().optional(),
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
      reminderEmail: row?.reminderEmail ?? null,
      digestEnabled: row?.digestEnabled ?? true,
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
      : (existing?.windowsJson ?? "[30,7,1]");

  const emailEnabled = updates.emailEnabled ?? existing?.emailEnabled ?? true;
  const pushEnabled = updates.pushEnabled ?? existing?.pushEnabled ?? false;
  const digestEnabled = updates.digestEnabled ?? existing?.digestEnabled ?? true;
  // "" is an explicit clear; undefined means "leave as is".
  const reminderEmail =
    updates.reminderEmail === undefined
      ? (existing?.reminderEmail ?? null)
      : updates.reminderEmail === "" || updates.reminderEmail === null
        ? null
        : updates.reminderEmail.trim().toLowerCase();

  if (existing) {
    await db
      .update(schema.reminderPrefs)
      .set({ emailEnabled, pushEnabled, windowsJson, reminderEmail, digestEnabled })
      .where(eq(schema.reminderPrefs.userId, userId));
  } else {
    await db
      .insert(schema.reminderPrefs)
      .values({ userId, emailEnabled, pushEnabled, windowsJson, reminderEmail, digestEnabled });
  }

  return c.json({
    prefs: {
      emailEnabled,
      pushEnabled,
      windows: parseWindows(windowsJson),
      reminderEmail,
      digestEnabled,
    },
  });
});

// POST /notifications/test-email — send a short "Family Vault test reminder"
// to prefs.reminderEmail ?? user.email. Session required.
notificationRoutes.post("/test-email", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  if (!(await canSendEmail(c.env, userId))) {
    return c.json(
      {
        error: "email_not_configured",
        message:
          "Reconnect Google Drive storage (includes Gmail send) or set RESEND_API_KEY.",
      },
      503,
    );
  }

  const user = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!user) return c.json({ error: "not_found" }, 404);

  const prefs = await db
    .select({ reminderEmail: schema.reminderPrefs.reminderEmail })
    .from(schema.reminderPrefs)
    .where(eq(schema.reminderPrefs.userId, userId))
    .get();

  const to = (prefs?.reminderEmail ?? user.email).trim().toLowerCase();
  const appUrl = c.env.APP_URL ?? "";

  const result = await sendEmailDetailed(
    c.env,
    {
      to,
      subject: "Test reminder",
      html: reminderEmailHtml({
        heading: "Family Vault test reminder",
        body: "This is a test. If you received it, reminder email delivery is working.",
        ctaLabel: "Open Family Vault",
        ctaUrl: appUrl || "https://familyvault.app",
      }),
      text: "Family Vault test reminder — delivery is working.",
    },
    { fromUserId: userId },
  );

  if (!result.ok) {
    return c.json(
      {
        error: "email_send_failed",
        message:
          "Could not send via Gmail or Resend. Reconnect Admin → Storage so mail can leave from your Gmail, or add a Resend API key.",
      },
      502,
    );
  }

  return c.json({ ok: true, to, via: result.via, from: result.from });
});
