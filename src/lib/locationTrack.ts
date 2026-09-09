/**
 * Client-side helpers for the location map (mirrors worker/lib/geo projection
 * needs without importing Worker code into the SPA bundle).
 */

export interface MapPoint {
  lat: number;
  lng: number;
}

/** Web-Mercator-ish project into an SVG viewBox. */
export function projectTrack(
  points: MapPoint[],
  width = 320,
  height = 240,
  pad = 16,
): { x: number; y: number }[] {
  if (points.length === 0) return [];
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
  // Avoid zero-size bounds when all points coincide.
  if (maxLat - minLat < 0.0002) {
    minLat -= 0.001;
    maxLat += 0.001;
  }
  if (maxLng - minLng < 0.0002) {
    minLng -= 0.001;
    maxLng += 0.001;
  }

  // Correct longitude span by latitude so the path isn't horizontally stretched.
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const latSpan = maxLat - minLat;
  const lngSpan = (maxLng - minLng) * Math.cos(midLat);
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;
  const scale = Math.min(usableW / Math.max(lngSpan, 1e-9), usableH / Math.max(latSpan, 1e-9));
  const drawW = lngSpan * scale;
  const drawH = latSpan * scale;
  const ox = pad + (usableW - drawW) / 2;
  const oy = pad + (usableH - drawH) / 2;

  return points.map((p) => {
    const x = ox + (p.lng - minLng) * Math.cos(midLat) * scale;
    const y = oy + (maxLat - p.lat) * scale;
    return { x, y };
  });
}

export function formatKm(km: number): string {
  if (km < 10) return km.toFixed(2);
  if (km < 100) return km.toFixed(1);
  return String(Math.round(km));
}

export function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

export function weekLabel(fromSecs: number, toSecs: number): string {
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${fmt.format(new Date(fromSecs * 1000))} – ${fmt.format(new Date(toSecs * 1000))}`;
}
