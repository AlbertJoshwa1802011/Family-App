import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { DEFAULT_WINDOWS, parseWindows } from "../lib/reminders";
import {
  canSendEmail,
  reminderEmailHtml,
  sendEmailDetailed,
} from "../lib/email";


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

// POST /notifications/:id/read — mark a single notification read.

// POST /notifications/test-email — send a short test reminder to the signed-in user.
// Registered before /:id/read so "test-email" is not captured as an id.
notificationRoutes.post("/test-email", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const db = getDb(c.env);

  if (!(await canSendEmail(c.env, userId))) {
    return c.json(
      {
        error: "email_not_configured",
        message:
          "Connect Gmail in Settings (gmail.send) or set RESEND_API_KEY.",
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

  // Optional override: only self or the family admin test inbox.
  let to = user.email.trim().toLowerCase();
  try {
    const body = await c.req.json().catch(() => ({}));
    const requested =
      typeof body?.to === "string" ? body.to.trim().toLowerCase() : "";
    const allowed = new Set([to, "albertjoshrock101@gmail.com"]);
    if (requested && allowed.has(requested)) to = requested;
  } catch {
    // no body — use login email
  }

  const appUrl = (c.env.APP_URL ?? new URL(c.req.url).origin).replace(/\/$/, "");
  const result = await sendEmailDetailed(
    c.env,
    {
      to,
      subject: "Family Vault test email",
      html: reminderEmailHtml({
        heading: "Family Vault test email",
        body: "This is a test. If you received it, email delivery from your account is working.",
        ctaLabel: "Open Family Vault",
        ctaUrl: appUrl,
      }),
      text: "Family Vault test email — delivery is working.",
    },
    { fromUserId: userId },
  );

  if (!result.ok) {
    const error = result.error ?? "email_send_failed";
    const message =
      error === "gmail_api_disabled"
        ? "Enable Gmail API on the Google Cloud project, then Connect Gmail in Settings again. Or set RESEND_API_KEY with a verified domain."
        : error === "resend_testing_recipients"
          ? "Resend is in testing mode and can only email the Resend account owner. Connect Gmail in Settings so mail sends from your Google account."
          : error === "gmail_auth_failed"
            ? "Gmail rejected the send. Tap Connect Gmail in Settings and approve gmail.send."
            : "Could not send via Gmail or Resend. Connect Gmail in Settings or set RESEND_API_KEY.";
    return c.json({ error, message }, error === "email_not_configured" ? 503 : 502);
  }

  return c.json({ ok: true, to, via: result.via, from: result.from });
});

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
