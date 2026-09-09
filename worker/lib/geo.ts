/**
 * Pure geo helpers for location tracking — haversine distance, trip splits,
 * stop detection, and weekly stats. All distances in metres; callers convert
 * to km for display.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
  recordedAt: number; // unix seconds
  accuracyM?: number | null;
}

export interface TripSegment {
  startAt: number;
  endAt: number;
  distanceM: number;
  pointCount: number;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
}

export interface StopPlace {
  lat: number;
  lng: number;
  arrivedAt: number;
  departedAt: number;
  dwellSecs: number;
}

export interface DayDistance {
  /** ISO yyyy-mm-dd (UTC calendar day of the segment end). */
  day: string;
  distanceM: number;
  tripCount: number;
}

export interface TrackStats {
  totalDistanceM: number;
  totalDistanceKm: number;
  pointCount: number;
  tripCount: number;
  movingSecs: number;
  stopCount: number;
  days: DayDistance[];
  trips: TripSegment[];
  stops: StopPlace[];
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Drop obvious GPS junk before measuring. */
export function filterTrackPoints(
  points: GeoPoint[],
  opts: { maxAccuracyM?: number } = {},
): GeoPoint[] {
  const maxAcc = opts.maxAccuracyM ?? 150;
  return points
    .filter(
      (p) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng) &&
        p.lat >= -90 &&
        p.lat <= 90 &&
        p.lng >= -180 &&
        p.lng <= 180 &&
        (p.accuracyM == null || p.accuracyM <= maxAcc),
    )
    .sort((a, b) => a.recordedAt - b.recordedAt);
}

/**
 * Split a trail into trips. A gap longer than `gapSecs` or a jump larger than
 * `jumpM` starts a new trip. Tiny segments under `minTripM` are dropped from
 * the trip list but their distance still counts toward the day total via the
 * consecutive-point walk in `computeTrackStats`.
 */
export function segmentTrips(
  points: GeoPoint[],
  opts: { gapSecs?: number; jumpM?: number; minTripM?: number } = {},
): TripSegment[] {
  const gapSecs = opts.gapSecs ?? 30 * 60;
  const jumpM = opts.jumpM ?? 2_000;
  const minTripM = opts.minTripM ?? 50;
  if (points.length < 2) return [];

  const trips: TripSegment[] = [];
  let startIdx = 0;
  let dist = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const d = haversineM(prev, cur);
    const dt = cur.recordedAt - prev.recordedAt;
    const split = dt > gapSecs || d > jumpM;
    if (split) {
      if (dist >= minTripM) {
        const start = points[startIdx]!;
        const end = points[i - 1]!;
        trips.push({
          startAt: start.recordedAt,
          endAt: end.recordedAt,
          distanceM: dist,
          pointCount: i - startIdx,
          start: { lat: start.lat, lng: start.lng },
          end: { lat: end.lat, lng: end.lng },
        });
      }
      startIdx = i;
      dist = 0;
      continue;
    }
    dist += d;
  }

  if (dist >= minTripM) {
    const start = points[startIdx]!;
    const end = points[points.length - 1]!;
    trips.push({
      startAt: start.recordedAt,
      endAt: end.recordedAt,
      distanceM: dist,
      pointCount: points.length - startIdx,
      start: { lat: start.lat, lng: start.lng },
      end: { lat: end.lat, lng: end.lng },
    });
  }

  return trips;
}

/** Places where the user stayed within `radiusM` for at least `minDwellSecs`. */
export function detectStops(
  points: GeoPoint[],
  opts: { radiusM?: number; minDwellSecs?: number } = {},
): StopPlace[] {
  const radiusM = opts.radiusM ?? 80;
  const minDwellSecs = opts.minDwellSecs ?? 5 * 60;
  if (points.length === 0) return [];

  const stops: StopPlace[] = [];
  let cluster: GeoPoint[] = [points[0]!];

  const flush = () => {
    if (cluster.length === 0) return;
    const first = cluster[0]!;
    const last = cluster[cluster.length - 1]!;
    const dwell = last.recordedAt - first.recordedAt;
    if (dwell >= minDwellSecs) {
      const lat = cluster.reduce((s, p) => s + p.lat, 0) / cluster.length;
      const lng = cluster.reduce((s, p) => s + p.lng, 0) / cluster.length;
      stops.push({
        lat,
        lng,
        arrivedAt: first.recordedAt,
        departedAt: last.recordedAt,
        dwellSecs: dwell,
      });
    }
    cluster = [];
  };

  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const anchor = cluster[0]!;
    if (haversineM(anchor, p) <= radiusM) {
      cluster.push(p);
    } else {
      flush();
      cluster = [p];
    }
  }
  flush();
  return stops;
}

function utcDay(secs: number): string {
  const d = new Date(secs * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function computeTrackStats(raw: GeoPoint[]): TrackStats {
  const points = filterTrackPoints(raw);
  if (points.length === 0) {
    return {
      totalDistanceM: 0,
      totalDistanceKm: 0,
      pointCount: 0,
      tripCount: 0,
      movingSecs: 0,
      stopCount: 0,
      days: [],
      trips: [],
      stops: [],
      bounds: null,
    };
  }

  const gapSecs = 30 * 60;
  const jumpM = 2_000;
  let totalDistanceM = 0;
  let movingSecs = 0;
  const dayMap = new Map<string, { distanceM: number; tripCount: number }>();

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const d = haversineM(prev, cur);
    const dt = cur.recordedAt - prev.recordedAt;
    if (dt > gapSecs || d > jumpM) continue;
    // Ignore sub-metre jitter so stationary noise doesn't inflate km.
    if (d < 5) continue;
    totalDistanceM += d;
    movingSecs += Math.max(dt, 0);
    const day = utcDay(cur.recordedAt);
    const row = dayMap.get(day) ?? { distanceM: 0, tripCount: 0 };
    row.distanceM += d;
    dayMap.set(day, row);
  }

  const trips = segmentTrips(points);
  for (const trip of trips) {
    const day = utcDay(trip.endAt);
    const row = dayMap.get(day) ?? { distanceM: 0, tripCount: 0 };
    row.tripCount += 1;
    dayMap.set(day, row);
  }

  const stops = detectStops(points);
  let minLat = points[0]!.lat;
  let maxLat = points[0]!.lat;
  let minLng = points[0]!.lng;
  let maxLng = points[0]!.lng;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }

  const days = [...dayMap.entries()]
    .map(([day, v]) => ({ day, distanceM: v.distanceM, tripCount: v.tripCount }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return {
    totalDistanceM,
    totalDistanceKm: Math.round((totalDistanceM / 1000) * 100) / 100,
    pointCount: points.length,
    tripCount: trips.length,
    movingSecs,
    stopCount: stops.length,
    days,
    trips,
    stops,
    bounds: { minLat, maxLat, minLng, maxLng },
  };
}

/** Monday 00:00 UTC of the week containing `nowSecs`, as unix seconds. */
export function weekStartUtc(nowSecs: number): number {
  const d = new Date(nowSecs * 1000);
  const day = d.getUTCDay(); // 0=Sun
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + mondayOffset) / 1000;
}

export function weekRange(nowSecs: number, weeksAgo = 0): { from: number; to: number } {
  const start = weekStartUtc(nowSecs) - weeksAgo * 7 * 86400;
  return { from: start, to: start + 7 * 86400 - 1 };
}
