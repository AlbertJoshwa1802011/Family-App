import { projectTrack, type MapPoint } from "../lib/locationTrack";

interface TrackMapProps {
  points: MapPoint[];
  stops?: MapPoint[];
  className?: string;
}

/** SVG trail map — no external tiles (CSP-safe). */
export function TrackMap({ points, stops = [], className }: TrackMapProps) {
  const width = 320;
  const height = 240;
  // Project path + stops together so they share the same bounds.
  const withStops = projectTrack([...points, ...stops], width, height);
  const projected = withStops.slice(0, points.length);
  const stopDots = withStops.slice(points.length);

  if (projected.length === 0 && stopDots.length === 0) {
    return (
      <div
        className={`flex aspect-[4/3] items-center justify-center rounded-bubble text-sm text-fg-muted ${className ?? ""}`}
        style={{
          background:
            "radial-gradient(ellipse at 30% 20%, color-mix(in oklab, var(--color-vault) 18%, transparent), transparent 55%), radial-gradient(ellipse at 70% 80%, color-mix(in oklab, var(--color-info) 14%, transparent), transparent 50%), color-mix(in oklab, var(--color-surface) 70%, transparent)",
        }}
      >
        No trail yet this week
      </div>
    );
  }

  const d = projected
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const start = projected[0];
  const end = projected[projected.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`aspect-[4/3] w-full overflow-hidden rounded-bubble ${className ?? ""}`}
      role="img"
      aria-label="Travel path for the selected week"
    >
      <defs>
        <linearGradient id="track-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="color-mix(in oklab, var(--color-vault) 22%, #0f172a)" />
          <stop offset="100%" stopColor="color-mix(in oklab, var(--color-info) 18%, #0b1220)" />
        </linearGradient>
        <linearGradient id="track-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#5eead4" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <rect width={width} height={height} fill="url(#track-bg)" />
      {Array.from({ length: 5 }, (_, i) => (
        <line
          key={`h${i}`}
          x1={0}
          x2={width}
          y1={(height / 5) * (i + 1)}
          y2={(height / 5) * (i + 1)}
          stroke="rgba(255,255,255,0.06)"
        />
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <line
          key={`v${i}`}
          y1={0}
          y2={height}
          x1={(width / 5) * (i + 1)}
          x2={(width / 5) * (i + 1)}
          stroke="rgba(255,255,255,0.06)"
        />
      ))}
      {d && (
        <path
          d={d}
          fill="none"
          stroke="url(#track-line)"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {stopDots.map((p, i) => (
        <circle
          key={`s${i}`}
          cx={p.x}
          cy={p.y}
          r={5}
          fill="rgba(251, 191, 36, 0.9)"
          stroke="rgba(15,23,42,0.6)"
          strokeWidth={1}
        />
      ))}
      {start && (
        <circle cx={start.x} cy={start.y} r={6} fill="#34d399" stroke="#064e3b" strokeWidth={1.5} />
      )}
      {end && projected.length > 1 && (
        <circle cx={end.x} cy={end.y} r={6} fill="#f87171" stroke="#7f1d1d" strokeWidth={1.5} />
      )}
    </svg>
  );
}
