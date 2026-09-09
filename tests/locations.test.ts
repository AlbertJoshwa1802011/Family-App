/**
 * Location tracking: opt-in prefs, point ingest, track/stats, privacy.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../worker/index";
import {
  computeTrackStats,
  haversineM,
  weekRange,
  weekStartUtc,
} from "../worker/lib/geo";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

let t: TestEnv;
let familyId: string;
let owner: ReturnType<typeof seedActor>;
let member: ReturnType<typeof seedActor>;

beforeEach(() => {
  t = createTestEnv();
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  owner = seedActor(t.sqlite, familyId, "owner", { name: "Olive Owner" });
  member = seedActor(t.sqlite, familyId, "member", { name: "Milo Member" });
});

function req(method: string, path: string, cookie: string, body?: object) {
  return app.request(
    path,
    {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
    t.env,
  );
}

async function enableSharing(cookie: string) {
  const res = await req("PUT", "/api/locations/prefs", cookie, {
    familyId,
    enabled: true,
  });
  expect(res.status).toBe(200);
}

describe("geo helpers", () => {
  it("haversine is ~0 for identical points and ~111km per degree lat", () => {
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
    const d = haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it("computeTrackStats sums distance and splits trips on time gaps", () => {
    const base = 1_700_000_000;
    const points = [
      { lat: 12.97, lng: 77.59, recordedAt: base },
      { lat: 12.98, lng: 77.59, recordedAt: base + 60 },
      { lat: 12.99, lng: 77.59, recordedAt: base + 120 },
      // 2h gap → new trip
      { lat: 13.0, lng: 77.6, recordedAt: base + 7200 },
      { lat: 13.01, lng: 77.6, recordedAt: base + 7260 },
    ];
    const stats = computeTrackStats(points);
    expect(stats.pointCount).toBe(5);
    expect(stats.tripCount).toBe(2);
    expect(stats.totalDistanceKm).toBeGreaterThan(2);
    expect(stats.days.length).toBeGreaterThan(0);
  });

  it("weekStartUtc lands on Monday 00:00 UTC", () => {
    // 2024-06-12 was a Wednesday
    const wed = Date.UTC(2024, 5, 12, 15, 0, 0) / 1000;
    const start = weekStartUtc(wed);
    const d = new Date(start * 1000);
    expect(d.getUTCDay()).toBe(1);
    expect(d.getUTCHours()).toBe(0);
    const range = weekRange(wed, 0);
    expect(range.to - range.from).toBe(7 * 86400 - 1);
  });
});

describe("location API", () => {
  it("prefs default off; enable → ingest → track/stats roundtrip", async () => {
    const prefs0 = await req(
      "GET",
      `/api/locations/prefs?familyId=${familyId}`,
      member.cookie,
    );
    expect(prefs0.status).toBe(200);
    expect(((await prefs0.json()) as { prefs: { enabled: boolean } }).prefs.enabled).toBe(
      false,
    );

    // Ingest rejected while sharing off
    const now = Math.floor(Date.now() / 1000);
    const denied = await req("POST", "/api/locations/points", member.cookie, {
      familyId,
      points: [{ lat: 12.97, lng: 77.59, recordedAt: now }],
    });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: string }).error).toBe(
      "location_sharing_disabled",
    );

    await enableSharing(member.cookie);

    const base = now - 600;
    const ingest = await req("POST", "/api/locations/points", member.cookie, {
      familyId,
      points: [
        { lat: 12.97, lng: 77.59, accuracyM: 12, recordedAt: base },
        { lat: 12.975, lng: 77.595, accuracyM: 10, recordedAt: base + 120 },
        { lat: 12.98, lng: 77.6, accuracyM: 8, recordedAt: base + 240 },
      ],
    });
    expect(ingest.status).toBe(201);
    expect(((await ingest.json()) as { inserted: number }).inserted).toBe(3);

    const track = await req(
      "GET",
      `/api/locations/track?familyId=${familyId}&week=0`,
      member.cookie,
    );
    expect(track.status).toBe(200);
    const trackBody = (await track.json()) as { points: unknown[] };
    expect(trackBody.points).toHaveLength(3);

    const stats = await req(
      "GET",
      `/api/locations/stats?familyId=${familyId}&week=0`,
      member.cookie,
    );
    expect(stats.status).toBe(200);
    const statsBody = (await stats.json()) as {
      stats: { totalDistanceKm: number; pointCount: number; tripCount: number };
    };
    expect(statsBody.stats.pointCount).toBe(3);
    expect(statsBody.stats.totalDistanceKm).toBeGreaterThan(0);
  });

  it("validation: bad coords / empty points / missing familyId → 400", async () => {
    await enableSharing(member.cookie);
    expect(
      (
        await req("POST", "/api/locations/points", member.cookie, {
          familyId,
          points: [{ lat: 200, lng: 0, recordedAt: 1 }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("POST", "/api/locations/points", member.cookie, {
          familyId,
          points: [],
        })
      ).status,
    ).toBe(400);
    expect((await req("GET", "/api/locations/prefs", member.cookie)).status).toBe(400);
    expect(
      (
        await req("PUT", "/api/locations/prefs", member.cookie, {
          familyId,
          enabled: "yes",
        })
      ).status,
    ).toBe(400);
  });

  it("privacy: other members cannot read track unless subject opted in", async () => {
    await enableSharing(member.cookie);
    const now = Math.floor(Date.now() / 1000);
    await req("POST", "/api/locations/points", member.cookie, {
      familyId,
      points: [{ lat: 1, lng: 1, recordedAt: now }],
    });

    // Owner cannot read member track until... wait, member DID enable. Owner should see it.
    const ok = await req(
      "GET",
      `/api/locations/track?familyId=${familyId}&userId=${member.userId}&week=0`,
      owner.cookie,
    );
    expect(ok.status).toBe(200);

    // Turn member sharing off → owner forbidden
    await req("PUT", "/api/locations/prefs", member.cookie, {
      familyId,
      enabled: false,
    });
    const denied = await req(
      "GET",
      `/api/locations/track?familyId=${familyId}&userId=${member.userId}&week=0`,
      owner.cookie,
    );
    expect(denied.status).toBe(403);

    // Member can still read own track
    expect(
      (
        await req(
          "GET",
          `/api/locations/track?familyId=${familyId}&userId=${member.userId}&week=0`,
          member.cookie,
        )
      ).status,
    ).toBe(200);
  });

  it("family isolation + no session", async () => {
    const strangerUser = seedUser(t.sqlite);
    const other = seedFamily(t.sqlite, strangerUser.id);
    const stranger = seedActor(t.sqlite, other.id, "owner");

    expect(
      (await req("GET", `/api/locations/prefs?familyId=${familyId}`, stranger.cookie))
        .status,
    ).toBe(404);
    expect(
      (
        await req("POST", "/api/locations/points", stranger.cookie, {
          familyId,
          points: [{ lat: 0, lng: 0, recordedAt: 1 }],
        })
      ).status,
    ).toBe(404);
    expect(
      (await app.request(`/api/locations/prefs?familyId=${familyId}`, {}, t.env)).status,
    ).toBe(401);
  });

  it("members list exposes sharing flags; last point only when sharing", async () => {
    await enableSharing(member.cookie);
    const now = Math.floor(Date.now() / 1000);
    await req("POST", "/api/locations/points", member.cookie, {
      familyId,
      points: [{ lat: 12.9, lng: 77.5, recordedAt: now }],
    });

    const res = await req(
      "GET",
      `/api/locations/members?familyId=${familyId}`,
      owner.cookie,
    );
    expect(res.status).toBe(200);
    const { members } = (await res.json()) as {
      members: {
        userId: string;
        sharingEnabled: boolean;
        lastPoint: { lat: number } | null;
        canViewTrack: boolean;
      }[];
    };
    const milo = members.find((m) => m.userId === member.userId)!;
    expect(milo.sharingEnabled).toBe(true);
    expect(milo.lastPoint?.lat).toBeCloseTo(12.9, 5);
    expect(milo.canViewTrack).toBe(true);
  });

  it("CSRF: cross-origin prefs PUT is rejected", async () => {
    const res = await app.request(
      "/api/locations/prefs",
      {
        method: "PUT",
        headers: {
          Cookie: member.cookie,
          "Content-Type": "application/json",
          Origin: "https://evil.example",
        },
        body: JSON.stringify({ familyId, enabled: true }),
      },
      t.env,
    );
    expect(res.status).toBe(403);
  });

  it("unknown deep path returns JSON not_found", async () => {
    const res = await req(
      "GET",
      `/api/locations/nope?familyId=${familyId}`,
      member.cookie,
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("not_found");
  });
});
