/**
 * Opt-in family location tracking.
 *
 * Device posts GPS breadcrumbs while sharing is enabled. Members only see
 * another person's track/stats when that person has opted in. Distance, trips,
 * and stops are computed server-side from points (see worker/lib/geo.ts).
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { HonoEnv } from "../types";
import { getDb, schema } from "../db/client";
import { requireSession } from "../middleware/requireSession";
import { requireFamilyMember } from "../middleware/requireMember";
import { checkRateLimit } from "../lib/rateLimit";
import {
  computeTrackStats,
  weekRange,
  type GeoPoint,
} from "../lib/geo";

export const locationRoutes = new Hono<HonoEnv>();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const prefsSchema = z.object({
  familyId: z.string().min(1),
  enabled: z.boolean(),
});

const pointSchema = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  accuracyM: z.number().positive().max(10_000).optional(),
  speedMps: z.number().min(0).max(200).optional(),
  headingDeg: z.number().min(0).max(360).optional(),
  recordedAt: z.number().int().positive(),
});

const ingestSchema = z.object({
  familyId: z.string().min(1),
  points: z.array(pointSchema).min(1).max(100),
});

function zv<T extends z.ZodType>(s: T) {
  return zValidator("json", s, (result, c) => {
    if (!result.success)
      return c.json({ error: "validation_error", issues: result.error.issues }, 400);
  });
}

async function getPref(
  db: ReturnType<typeof getDb>,
  familyId: string,
  userId: string,
) {
  return db
    .select()
    .from(schema.locationSharingPrefs)
    .where(
      and(
        eq(schema.locationSharingPrefs.familyId, familyId),
        eq(schema.locationSharingPrefs.userId, userId),
      ),
    )
    .get();
}

async function sharingEnabled(
  db: ReturnType<typeof getDb>,
  familyId: string,
  userId: string,
): Promise<boolean> {
  const pref = await getPref(db, familyId, userId);
  return (pref?.enabled ?? 0) === 1;
}

/** Self always; others only when they opted in. */
async function canReadTrack(
  db: ReturnType<typeof getDb>,
  familyId: string,
  viewerId: string,
  subjectId: string,
): Promise<boolean> {
  if (viewerId === subjectId) return true;
  return sharingEnabled(db, familyId, subjectId);
}

function parseWindowQuery(c: {
  req: { query: (k: string) => string | undefined };
}): { from: number; to: number } | { error: string; status: 400 } {
  const fromQ = c.req.query("from");
  const toQ = c.req.query("to");
  const weekQ = c.req.query("week"); // 0 = this week UTC, 1 = last week, …
  const now = Math.floor(Date.now() / 1000);

  if (fromQ && toQ && /^\d+$/.test(fromQ) && /^\d+$/.test(toQ)) {
    const from = Number(fromQ);
    const to = Number(toQ);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
      return { error: "invalid_range", status: 400 };
    }
    if (to - from > 31 * 86400) {
      return { error: "range_too_large", status: 400 };
    }
    return { from, to };
  }

  if (fromQ && isoDate.safeParse(fromQ).success && toQ && isoDate.safeParse(toQ).success) {
    const from = Date.parse(`${fromQ}T00:00:00Z`) / 1000;
    const to = Date.parse(`${toQ}T23:59:59Z`) / 1000;
    if (to < from || to - from > 31 * 86400) {
      return { error: "invalid_range", status: 400 };
    }
    return { from, to };
  }

  const weeksAgo = weekQ != null ? Number(weekQ) : 0;
  if (!Number.isInteger(weeksAgo) || weeksAgo < 0 || weeksAgo > 12) {
    return { error: "invalid_week", status: 400 };
  }
  return weekRange(now, weeksAgo);
}

async function loadPoints(
  db: ReturnType<typeof getDb>,
  familyId: string,
  userId: string,
  from: number,
  to: number,
): Promise<GeoPoint[]> {
  const rows = await db
    .select({
      lat: schema.locationPoints.lat,
      lng: schema.locationPoints.lng,
      accuracyM: schema.locationPoints.accuracyM,
      recordedAt: schema.locationPoints.recordedAt,
    })
    .from(schema.locationPoints)
    .where(
      and(
        eq(schema.locationPoints.familyId, familyId),
        eq(schema.locationPoints.userId, userId),
        gte(schema.locationPoints.recordedAt, from),
        lte(schema.locationPoints.recordedAt, to),
      ),
    )
    .orderBy(asc(schema.locationPoints.recordedAt))
    .limit(20_000);

  return rows.map((r) => ({
    lat: Number(r.lat),
    lng: Number(r.lng),
    accuracyM: r.accuracyM,
    recordedAt: r.recordedAt,
  }));
}

// GET /locations/prefs?familyId=
locationRoutes.get("/prefs", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);
  const userId = c.get("userId")!;

  const membership = await requireFamilyMember(c, familyId, "member", "location");
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const pref = await getPref(db, familyId, userId);
  return c.json({
    prefs: {
      familyId,
      userId,
      enabled: (pref?.enabled ?? 0) === 1,
      updatedAt: pref?.updatedAt ?? null,
    },
  });
});

// PUT /locations/prefs — opt in / out
locationRoutes.put("/prefs", requireSession, zv(prefsSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const membership = await requireFamilyMember(c, data.familyId, "member", "location");
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  const now = Math.floor(Date.now() / 1000);
  const existing = await getPref(db, data.familyId, userId);

  if (existing) {
    await db
      .update(schema.locationSharingPrefs)
      .set({ enabled: data.enabled ? 1 : 0, updatedAt: now })
      .where(eq(schema.locationSharingPrefs.id, existing.id));
  } else {
    await db.insert(schema.locationSharingPrefs).values({
      id: crypto.randomUUID(),
      familyId: data.familyId,
      userId,
      enabled: data.enabled ? 1 : 0,
      updatedAt: now,
      createdAt: now,
    });
  }

  return c.json({
    prefs: {
      familyId: data.familyId,
      userId,
      enabled: data.enabled,
      updatedAt: now,
    },
  });
});

// POST /locations/points — ingest breadcrumbs (must be opted in)
locationRoutes.post("/points", requireSession, zv(ingestSchema), async (c) => {
  const userId = c.get("userId")!;
  const data = c.req.valid("json");

  const limited = await checkRateLimit(c, `loc-ingest:${userId}`, {
    limit: 120,
    windowSecs: 60,
  });
  if (limited) return limited;

  const membership = await requireFamilyMember(c, data.familyId, "member", "location");
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);
  if (!(await sharingEnabled(db, data.familyId, userId))) {
    return c.json({ error: "location_sharing_disabled" }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  // Reject points more than 24h in the future or 14 days in the past.
  const minAt = now - 14 * 86400;
  const maxAt = now + 86400;
  const accepted = data.points.filter(
    (p) => p.recordedAt >= minAt && p.recordedAt <= maxAt,
  );
  if (accepted.length === 0) {
    return c.json({ error: "validation_error", issues: [{ message: "no_valid_points" }] }, 400);
  }

  const values = accepted.map((p) => ({
    id: crypto.randomUUID(),
    familyId: data.familyId,
    userId,
    lat: String(p.lat),
    lng: String(p.lng),
    accuracyM: p.accuracyM != null ? Math.round(p.accuracyM) : null,
    speedMps: p.speedMps != null ? String(p.speedMps) : null,
    headingDeg: p.headingDeg != null ? Math.round(p.headingDeg) : null,
    recordedAt: p.recordedAt,
    createdAt: now,
  }));

  // D1 batch insert in chunks.
  const chunk = 50;
  for (let i = 0; i < values.length; i += chunk) {
    await db.insert(schema.locationPoints).values(values.slice(i, i + chunk));
  }

  return c.json({ ok: true, inserted: values.length }, 201);
});

// GET /locations/track?familyId=&userId=&week=0|from=&to=
locationRoutes.get("/track", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);
  const viewerId = c.get("userId")!;
  const subjectId = c.req.query("userId") ?? viewerId;

  const membership = await requireFamilyMember(c, familyId, "member", "location");
  if (membership instanceof Response) return membership;

  const window = parseWindowQuery(c);
  if ("error" in window) return c.json({ error: window.error }, window.status);

  const db = getDb(c.env);
  if (!(await canReadTrack(db, familyId, viewerId, subjectId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const points = await loadPoints(db, familyId, subjectId, window.from, window.to);
  return c.json({
    userId: subjectId,
    from: window.from,
    to: window.to,
    points: points.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      accuracyM: p.accuracyM ?? null,
      recordedAt: p.recordedAt,
    })),
  });
});

// GET /locations/stats?familyId=&userId=&week=0
locationRoutes.get("/stats", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);
  const viewerId = c.get("userId")!;
  const subjectId = c.req.query("userId") ?? viewerId;

  const membership = await requireFamilyMember(c, familyId, "member", "location");
  if (membership instanceof Response) return membership;

  const window = parseWindowQuery(c);
  if ("error" in window) return c.json({ error: window.error }, window.status);

  const db = getDb(c.env);
  if (!(await canReadTrack(db, familyId, viewerId, subjectId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const points = await loadPoints(db, familyId, subjectId, window.from, window.to);
  const stats = computeTrackStats(points);
  return c.json({
    userId: subjectId,
    from: window.from,
    to: window.to,
    stats: {
      totalDistanceKm: stats.totalDistanceKm,
      totalDistanceM: Math.round(stats.totalDistanceM),
      pointCount: stats.pointCount,
      tripCount: stats.tripCount,
      movingSecs: stats.movingSecs,
      stopCount: stats.stopCount,
      days: stats.days.map((d) => ({
        day: d.day,
        distanceKm: Math.round((d.distanceM / 1000) * 100) / 100,
        tripCount: d.tripCount,
      })),
      trips: stats.trips.map((t) => ({
        startAt: t.startAt,
        endAt: t.endAt,
        distanceKm: Math.round((t.distanceM / 1000) * 100) / 100,
        pointCount: t.pointCount,
        start: t.start,
        end: t.end,
      })),
      stops: stats.stops.map((s) => ({
        lat: Math.round(s.lat * 1e6) / 1e6,
        lng: Math.round(s.lng * 1e6) / 1e6,
        arrivedAt: s.arrivedAt,
        departedAt: s.departedAt,
        dwellSecs: s.dwellSecs,
      })),
      bounds: stats.bounds,
    },
  });
});

// GET /locations/members?familyId= — who is sharing + last known point
locationRoutes.get("/members", requireSession, async (c) => {
  const familyId = c.req.query("familyId");
  if (!familyId) return c.json({ error: "familyId query param required" }, 400);
  const viewerId = c.get("userId")!;

  const membership = await requireFamilyMember(c, familyId, "member", "location");
  if (membership instanceof Response) return membership;

  const db = getDb(c.env);

  const members = await db
    .select({
      userId: schema.familyMembers.userId,
      name: schema.users.name,
      picture: schema.users.picture,
      role: schema.familyMembers.role,
      status: schema.familyMembers.status,
    })
    .from(schema.familyMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.familyMembers.userId))
    .where(
      and(
        eq(schema.familyMembers.familyId, familyId),
        eq(schema.familyMembers.status, "active"),
      ),
    );

  const prefs = await db
    .select()
    .from(schema.locationSharingPrefs)
    .where(eq(schema.locationSharingPrefs.familyId, familyId));
  const prefByUser = new Map(prefs.map((p) => [p.userId, p.enabled === 1]));

  const out = [];
  for (const m of members) {
    if (!m.userId) continue;
    const enabled = prefByUser.get(m.userId) ?? false;
    const visible = m.userId === viewerId || enabled;
    let last: {
      lat: number;
      lng: number;
      recordedAt: number;
      accuracyM: number | null;
    } | null = null;

    if (visible && (enabled || m.userId === viewerId)) {
      // Only expose last point when sharing (or self). Self without sharing
      // can still see own last point for the tracker UI.
      if (enabled || m.userId === viewerId) {
        const row = await db
          .select({
            lat: schema.locationPoints.lat,
            lng: schema.locationPoints.lng,
            recordedAt: schema.locationPoints.recordedAt,
            accuracyM: schema.locationPoints.accuracyM,
          })
          .from(schema.locationPoints)
          .where(
            and(
              eq(schema.locationPoints.familyId, familyId),
              eq(schema.locationPoints.userId, m.userId),
            ),
          )
          .orderBy(desc(schema.locationPoints.recordedAt), desc(sql`"location_points".rowid`))
          .limit(1)
          .get();
        if (row) {
          last = {
            lat: Number(row.lat),
            lng: Number(row.lng),
            recordedAt: row.recordedAt,
            accuracyM: row.accuracyM,
          };
        }
      }
    }

    out.push({
      userId: m.userId,
      name: m.name,
      picture: m.picture,
      role: m.role,
      sharingEnabled: enabled,
      // Hide last point from others unless sharing.
      lastPoint: visible && (enabled || m.userId === viewerId) ? last : null,
      canViewTrack: visible && (enabled || m.userId === viewerId),
    });
  }

  return c.json({ members: out });
});
