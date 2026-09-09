import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MapPinned,
  Navigation,
  Pause,
  Play,
  ShieldCheck,
  Route,
} from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { TrackMap } from "../components/TrackMap";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  formatDuration,
  formatKm,
  weekLabel,
} from "../lib/locationTrack";

interface Prefs {
  enabled: boolean;
  updatedAt: number | null;
}

interface TrackPoint {
  lat: number;
  lng: number;
  accuracyM: number | null;
  recordedAt: number;
}

interface StatsPayload {
  from: number;
  to: number;
  stats: {
    totalDistanceKm: number;
    totalDistanceM: number;
    pointCount: number;
    tripCount: number;
    movingSecs: number;
    stopCount: number;
    days: { day: string; distanceKm: number; tripCount: number }[];
    trips: {
      startAt: number;
      endAt: number;
      distanceKm: number;
      start: { lat: number; lng: number };
      end: { lat: number; lng: number };
    }[];
    stops: {
      lat: number;
      lng: number;
      arrivedAt: number;
      departedAt: number;
      dwellSecs: number;
    }[];
  };
}

interface MemberRow {
  userId: string;
  name: string | null;
  picture: string | null;
  sharingEnabled: boolean;
  canViewTrack: boolean;
  lastPoint: { lat: number; lng: number; recordedAt: number } | null;
}

type PendingPoint = {
  lat: number;
  lng: number;
  accuracyM?: number;
  speedMps?: number;
  headingDeg?: number;
  recordedAt: number;
};

const TRACKING_KEY = "fv.location.tracking";

function haversineM(
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
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function Locations() {
  const { activeFamily, user } = useAuth();
  const qc = useQueryClient();
  const [week, setWeek] = useState(0);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [tracking, setTracking] = useState(() => {
    try {
      return localStorage.getItem(TRACKING_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [permError, setPermError] = useState<string | null>(null);
  const [lastFix, setLastFix] = useState<string | null>(null);
  const watchRef = useRef<number | null>(null);
  const queueRef = useRef<PendingPoint[]>([]);
  const lastSentRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const familyId = activeFamily?.id;
  const me = user?.id ?? null;
  const viewingId = subjectId ?? me;

  const prefsQ = useQuery({
    queryKey: ["location-prefs", familyId],
    queryFn: () =>
      api<{ prefs: Prefs }>(`/locations/prefs?familyId=${familyId}`).then((r) => r.prefs),
    enabled: Boolean(familyId),
  });

  const membersQ = useQuery({
    queryKey: ["location-members", familyId],
    queryFn: () =>
      api<{ members: MemberRow[] }>(`/locations/members?familyId=${familyId}`).then(
        (r) => r.members,
      ),
    enabled: Boolean(familyId),
  });

  const trackQ = useQuery({
    queryKey: ["location-track", familyId, viewingId, week],
    queryFn: () =>
      api<{ points: TrackPoint[]; from: number; to: number }>(
        `/locations/track?familyId=${familyId}&userId=${viewingId}&week=${week}`,
      ),
    enabled: Boolean(familyId && viewingId),
    refetchInterval: tracking && viewingId === me ? 30_000 : false,
  });

  const statsQ = useQuery({
    queryKey: ["location-stats", familyId, viewingId, week],
    queryFn: () =>
      api<StatsPayload>(
        `/locations/stats?familyId=${familyId}&userId=${viewingId}&week=${week}`,
      ),
    enabled: Boolean(familyId && viewingId),
    refetchInterval: tracking && viewingId === me ? 30_000 : false,
  });

  const setPrefs = useMutation({
    mutationFn: (enabled: boolean) =>
      api<{ prefs: Prefs }>("/locations/prefs", {
        method: "PUT",
        body: JSON.stringify({ familyId, enabled }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["location-prefs", familyId] });
      void qc.invalidateQueries({ queryKey: ["location-members", familyId] });
    },
  });

  const flushQueue = async () => {
    if (!familyId || queueRef.current.length === 0) return;
    const batch = queueRef.current.splice(0, 100);
    try {
      await api("/locations/points", {
        method: "POST",
        body: JSON.stringify({ familyId, points: batch }),
      });
      void qc.invalidateQueries({ queryKey: ["location-track", familyId] });
      void qc.invalidateQueries({ queryKey: ["location-stats", familyId] });
      void qc.invalidateQueries({ queryKey: ["location-members", familyId] });
    } catch (e) {
      // Put points back so a transient failure doesn't lose the trail.
      queueRef.current.unshift(...batch);
      if (e instanceof ApiError && e.code === "location_sharing_disabled") {
        setTracking(false);
        setPermError(e.message);
      }
    }
  };

  // Start / stop device geolocation watch.
  useEffect(() => {
    try {
      localStorage.setItem(TRACKING_KEY, tracking ? "1" : "0");
    } catch {
      /* ignore */
    }

    const stopWatch = () => {
      if (watchRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
      if (flushTimer.current) {
        clearInterval(flushTimer.current);
        flushTimer.current = null;
      }
    };

    if (!tracking || !prefsQ.data?.enabled) {
      stopWatch();
      return stopWatch;
    }

    if (!navigator.geolocation) {
      // Defer state updates so we don't sync-set inside the effect body.
      queueMicrotask(() => {
        setPermError("This browser can't share location.");
        setTracking(false);
      });
      return stopWatch;
    }

    queueMicrotask(() => setPermError(null));
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy, speed, heading } = pos.coords;
        const recordedAt = Math.floor(pos.timestamp / 1000);
        const last = lastSentRef.current;
        const moved = !last || haversineM(last, { lat, lng }) >= 15;
        const aged = !last || recordedAt - last.at >= 30;
        if (!moved && !aged) return;
        lastSentRef.current = { lat, lng, at: recordedAt };
        queueRef.current.push({
          lat,
          lng,
          accuracyM: Number.isFinite(accuracy) ? accuracy : undefined,
          speedMps: speed != null && speed >= 0 ? speed : undefined,
          headingDeg:
            heading != null && Number.isFinite(heading) && heading >= 0
              ? heading
              : undefined,
          recordedAt,
        });
        setLastFix(new Date(recordedAt * 1000).toLocaleTimeString());
        if (queueRef.current.length >= 8) void flushQueue();
      },
      (err) => {
        setPermError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Enable it in browser settings."
            : "Couldn't read your location right now.",
        );
        setTracking(false);
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );

    flushTimer.current = setInterval(() => {
      void flushQueue();
    }, 20_000);

    return stopWatch;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flushQueue closes over familyId
  }, [tracking, prefsQ.data?.enabled, familyId]);

  const enabled = prefsQ.data?.enabled ?? false;
  const stats = statsQ.data?.stats;
  const points = trackQ.data?.points ?? [];
  const members = membersQ.data ?? [];
  const viewable = members.filter((m) => m.canViewTrack);

  async function enableAndTrack() {
    setPermError(null);
    try {
      if (!enabled) await setPrefs.mutateAsync(true);
      setTracking(true);
    } catch (e) {
      setPermError(e instanceof Error ? e.message : "Couldn't enable sharing");
    }
  }

  async function disableSharing() {
    setTracking(false);
    try {
      await setPrefs.mutateAsync(false);
    } catch (e) {
      setPermError(e instanceof Error ? e.message : "Couldn't update sharing");
    }
  }

  return (
    <>
      <AppBar title="Location" back />
      <Page className="space-y-5">
        <Card className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <div className="lq lq-raised flex size-10 shrink-0 items-center justify-center rounded-full">
              <ShieldCheck className="size-5 text-vault" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium text-fg">Opt-in travel trail</p>
              <p className="text-sm text-fg-muted">
                Your path is private until you turn sharing on. Family only sees
                your map while sharing is enabled — and only while this app can
                read GPS (best with the page open).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {!enabled ? (
              <Button loading={setPrefs.isPending} onClick={() => void enableAndTrack()}>
                Allow & start tracking
              </Button>
            ) : tracking ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setTracking(false);
                  void flushQueue();
                }}
              >
                <Pause className="size-4" /> Pause tracking
              </Button>
            ) : (
              <Button onClick={() => setTracking(true)}>
                <Play className="size-4" /> Resume tracking
              </Button>
            )}
            {enabled && (
              <Button variant="ghost" loading={setPrefs.isPending} onClick={() => void disableSharing()}>
                Turn sharing off
              </Button>
            )}
          </div>

          {tracking && (
            <p className="flex items-center gap-2 text-xs text-fg-subtle">
              <Navigation className="size-3.5 animate-pulse text-success" />
              Recording{lastFix ? ` · last fix ${lastFix}` : "…"}
            </p>
          )}
          {permError && <p className="text-sm text-danger">{permError}</p>}
        </Card>

        <div className="flex items-center justify-between gap-3">
          <SegmentedControl
            value={String(week)}
            onChange={(v) => setWeek(Number(v))}
            options={[
              { value: "0", label: "This week" },
              { value: "1", label: "Last week" },
            ]}
          />
        </div>

        {viewable.length > 1 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {viewable.map((m) => {
              const active = (viewingId ?? "") === m.userId;
              return (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() => setSubjectId(m.userId)}
                  className={`lq lq-press shrink-0 rounded-full px-3 py-1.5 text-sm ${
                    active ? "lq-primary text-white" : "text-fg"
                  }`}
                >
                  {m.userId === me ? "You" : m.name || "Member"}
                </button>
              );
            })}
          </div>
        )}

        {statsQ.isLoading || trackQ.isLoading ? (
          <Skeleton className="aspect-[4/3] w-full rounded-bubble" />
        ) : (
          <TrackMap points={points} stops={stats?.stops ?? []} />
        )}

        {statsQ.data && (
          <p className="text-center text-xs text-fg-subtle">
            {weekLabel(statsQ.data.from, statsQ.data.to)}
          </p>
        )}

        {statsQ.isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-20 rounded-bubble" />
            <Skeleton className="h-20 rounded-bubble" />
            <Skeleton className="h-20 rounded-bubble" />
            <Skeleton className="h-20 rounded-bubble" />
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 gap-3">
            <StatChip label="Distance" value={`${formatKm(stats.totalDistanceKm)} km`} />
            <StatChip label="Trips" value={String(stats.tripCount)} />
            <StatChip label="Stops" value={String(stats.stopCount)} />
            <StatChip label="Moving" value={formatDuration(stats.movingSecs)} />
          </div>
        ) : null}

        {stats && stats.days.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-fg">Daily km</h2>
            <Card variant="flat" className="divide-y divide-white/5">
              {stats.days.map((d) => (
                <div key={d.day} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="text-fg-muted">{d.day}</span>
                  <span className="tabular-nums text-fg">
                    {formatKm(d.distanceKm)} km
                    <span className="ml-2 text-fg-subtle">· {d.tripCount} trips</span>
                  </span>
                </div>
              ))}
            </Card>
          </section>
        )}

        {stats && stats.stops.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-fg">Where you lingered</h2>
            <Card variant="flat" className="divide-y divide-white/5">
              {stats.stops.slice(0, 12).map((s, i) => (
                <div key={`${s.arrivedAt}-${i}`} className="px-4 py-2.5 text-sm">
                  <p className="font-medium text-fg">
                    Stop {i + 1}
                    <span className="ml-2 font-normal text-fg-subtle">
                      {formatDuration(s.dwellSecs)}
                    </span>
                  </p>
                  <p className="text-xs text-fg-muted tabular-nums">
                    {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
                  </p>
                </div>
              ))}
            </Card>
          </section>
        )}

        {stats && stats.trips.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-fg">Trips</h2>
            <Card variant="flat" className="divide-y divide-white/5">
              {stats.trips.map((t, i) => (
                <div key={`${t.startAt}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                  <Route className="size-4 shrink-0 text-info" />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="text-fg">
                      {formatKm(t.distanceKm)} km
                      <span className="ml-2 text-fg-subtle">
                        {new Date(t.startAt * 1000).toLocaleString(undefined, {
                          weekday: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </p>
                  </div>
                </div>
              ))}
            </Card>
          </section>
        )}

        {!statsQ.isLoading && stats && stats.pointCount === 0 && (
          <EmptyState
            icon={MapPinned}
            title="No trail for this week"
            description={
              enabled
                ? "Start tracking and keep the app open while you travel — points upload as you move."
                : "Allow location sharing to begin recording your week."
            }
          />
        )}
      </Page>
    </>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <Card className="space-y-1 p-4">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-fg">{value}</p>
    </Card>
  );
}
