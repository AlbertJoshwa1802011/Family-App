import { Hono } from "hono";
import { and, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { buildCalendar, type IcsAllDayItem, type IcsEvent } from "../lib/ics";
import { generateRandom } from "../lib/crypto";

export const calendarRoutes = new Hono<HonoEnv>();

const FEED_KV_PREFIX = "calfeed:";
const FEED_USER_PREFIX = "calfeed_user:";

/**
 * Calendar-app integration.
 *
 * Two surfaces:
 *  - POST /calendar/feed-token → mints (or rotates) a capability token and
 *    returns the subscribable webcal/https feed URL for the current user.
 *  - GET /calendar/feed/:token.ics → the feed itself. Calendar apps
 *    (Google/Apple/Outlook) can't send session cookies, so this is a
 *    capability URL: the unguessable token IS the credential. Rotating the
 *    token invalidates the old URL. Content respects private-doc visibility.
 */

// POST /calendar/feed-token — mint/rotate the current user's feed token.
calendarRoutes.post("/feed-token", requireSession, async (c) => {
  const userId = c.get("userId")!;

  // Invalidate any previous token (rotation semantics).
  const old = await c.env.KV.get(`${FEED_USER_PREFIX}${userId}`);
  if (old) await c.env.KV.delete(`${FEED_KV_PREFIX}${old}`);

  const token = generateRandom(24);
  await c.env.KV.put(`${FEED_KV_PREFIX}${token}`, userId);
  await c.env.KV.put(`${FEED_USER_PREFIX}${userId}`, token);

  const appUrl = c.env.APP_URL ?? new URL(c.req.url).origin;
  return c.json({ url: `${appUrl}/api/calendar/feed/${token}.ics` });
});

// GET /calendar/feed/:token.ics — subscribable calendar (capability URL).
calendarRoutes.get("/feed/:file", async (c) => {
  const raw = c.req.param("file");
  if (!raw.endsWith(".ics")) return c.json({ error: "not_found" }, 404);
  const token = raw.slice(0, -4);

  const userId = await c.env.KV.get(`${FEED_KV_PREFIX}${token}`);
  if (!userId) return c.json({ error: "not_found" }, 404);

  const db = getDb(c.env);
  const nowSecs = Math.floor(Date.now() / 1000);

  // The user's active family memberships.
  const memberships = await db
    .select({
      familyId: schema.familyMembers.familyId,
      role: schema.familyMembers.role,
    })
    .from(schema.familyMembers)
    .where(
      and(
        eq(schema.familyMembers.userId, userId),
        eq(schema.familyMembers.status, "active"),
      ),
    );

  const familyIds = memberships.map((m) => m.familyId);
  const roleByFamily = new Map(memberships.map((m) => [m.familyId, m.role]));

  const events: IcsEvent[] = [];
  const expiries: IcsAllDayItem[] = [];

  if (familyIds.length > 0) {
    // Events: last 30 days onward, active + cancelled (cancelled marked).
    const rows = await db
      .select()
      .from(schema.events)
      .where(
        and(
          inArray(schema.events.familyId, familyIds),
          ne(schema.events.status, "trashed"),
          gte(schema.events.startAt, nowSecs - 30 * 86400),
        ),
      );

    for (const ev of rows) {
      events.push({
        uid: `event-${ev.id}@family-vault`,
        title: ev.title,
        description: ev.description,
        location: ev.location,
        startAt: ev.startAt,
        endAt: ev.endAt,
        allDay: Boolean(ev.allDay),
        cancelled: ev.status === "cancelled",
      });
    }

    // Document expiries as all-day items (private docs only for their owner
    // unless the user is owner/admin of that family).
    const docs = await db
      .select()
      .from(schema.documents)
      .where(
        and(
          inArray(schema.documents.familyId, familyIds),
          eq(schema.documents.status, "active"),
          isNotNull(schema.documents.expiryDate),
        ),
      );

    for (const doc of docs) {
      const role = roleByFamily.get(doc.familyId) ?? "member";
      const hidden =
        doc.visibility === "private" &&
        doc.ownerUserId !== userId &&
        role !== "owner" &&
        role !== "admin";
      if (hidden) continue;
      expiries.push({
        uid: `expiry-${doc.id}@family-vault`,
        title: `${doc.title} expires`,
        date: doc.expiryDate!,
        description: "Family Vault expiry reminder",
      });
    }
  }

  const body = buildCalendar({
    name: "Family Vault",
    events,
    allDayItems: expiries,
    nowSecs,
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="family-vault.ics"',
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
