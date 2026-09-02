/**
 * Calendar-app integration: per-event ICS download + a subscribable feed.
 *
 * Google Calendar polls ICS feeds on its own schedule (often hours). Instant
 * appearance on the phone uses the Calendar API write path in googleCalendar.ts.
 */
import { Hono } from "hono";
import { and, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { buildCalendar, type IcsAllDayItem, type IcsEvent } from "../lib/ics";
import { generateRandom } from "../lib/crypto";

export const calendarRoutes = new Hono<HonoEnv>();

const FEED_KV_PREFIX = "calfeed:";
const FEED_USER_PREFIX = "calfeed_user:";

calendarRoutes.post("/feed-token", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const old = await c.env.KV.get(`${FEED_USER_PREFIX}${userId}`);
  if (old) await c.env.KV.delete(`${FEED_KV_PREFIX}${old}`);

  const token = generateRandom(24);
  await c.env.KV.put(`${FEED_KV_PREFIX}${token}`, userId);
  await c.env.KV.put(`${FEED_USER_PREFIX}${userId}`, token);

  const appUrl = c.env.APP_URL ?? new URL(c.req.url).origin;
  return c.json({ url: `${appUrl}/api/calendar/feed/${token}.ics` });
});

calendarRoutes.get("/feed-token", requireSession, async (c) => {
  const userId = c.get("userId")!;
  const token = await c.env.KV.get(`${FEED_USER_PREFIX}${userId}`);
  if (!token) return c.json({ url: null });
  const appUrl = c.env.APP_URL ?? new URL(c.req.url).origin;
  return c.json({ url: `${appUrl}/api/calendar/feed/${token}.ics` });
});

calendarRoutes.get("/feed/:file", async (c) => {
  const raw = c.req.param("file");
  if (!raw?.endsWith(".ics")) return c.json({ error: "not_found" }, 404);
  const token = raw.slice(0, -4);

  const userId = await c.env.KV?.get(`${FEED_KV_PREFIX}${token}`);
  if (!userId) return c.json({ error: "not_found" }, 404);

  const db = getDb(c.env);
  const nowSecs = Math.floor(Date.now() / 1000);

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
  const events: IcsEvent[] = [];
  const expiries: IcsAllDayItem[] = [];

  if (familyIds.length > 0) {
    const rows = await db
      .select()
      .from(schema.events)
      .where(
        and(
          inArray(schema.events.familyId, familyIds),
          ne(schema.events.status, "trashed"),
          gte(schema.events.startAt, nowSecs - 30 * 24 * 3600),
        ),
      );
    for (const r of rows) {
      events.push({
        uid: r.id,
        title: r.title,
        description: r.description,
        location: r.location,
        startAt: r.startAt,
        endAt: r.endAt,
        allDay: r.allDay,
        status: r.status === "cancelled" ? "cancelled" : "active",
      });
    }

    const docs = await db
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        expiryDate: schema.documents.expiryDate,
        visibility: schema.documents.visibility,
        ownerUserId: schema.documents.ownerUserId,
        familyId: schema.documents.familyId,
      })
      .from(schema.documents)
      .where(
        and(
          inArray(schema.documents.familyId, familyIds),
          isNotNull(schema.documents.expiryDate),
          ne(schema.documents.status, "trashed"),
        ),
      );
    const roleByFamily = new Map(memberships.map((m) => [m.familyId, m.role]));
    for (const d of docs) {
      if (!d.expiryDate) continue;
      const role = roleByFamily.get(d.familyId);
      if (
        d.visibility === "private" &&
        d.ownerUserId !== userId &&
        role !== "owner" &&
        role !== "admin"
      ) {
        continue;
      }
      expiries.push({
        uid: `doc-expiry-${d.id}`,
        title: `Expires: ${d.title}`,
        startDate: d.expiryDate,
      });
    }
  }

  const ics = buildCalendar({ events, expiries, nowSecs, name: "Family Vault" });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "inline; filename=family-vault.ics",
      "Cache-Control": "private, max-age=300",
    },
  });
});

calendarRoutes.get("/events/:id/ics", requireSession, async (c) => {
  const eventId = c.req.param("id");
  if (!eventId) return c.json({ error: "not_found" }, 404);
  const db = getDb(c.env);
  const event = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.id, eventId), ne(schema.events.status, "trashed")))
    .get();
  if (!event) return c.json({ error: "not_found" }, 404);
  const membership = await requireFamilyMember(c, event.familyId);
  if (membership instanceof Response) return membership;

  const ics = buildCalendar({
    events: [
      {
        uid: event.id,
        title: event.title,
        description: event.description,
        location: event.location,
        startAt: event.startAt,
        endAt: event.endAt,
        allDay: event.allDay,
        status: event.status === "cancelled" ? "cancelled" : "active",
      },
    ],
    name: event.title,
  });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.title.replace(/[^\w.-]+/g, "_")}.ics"`,
    },
  });
});
