import { HardDrive, Settings } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { cn } from "../../lib/cn";
import {
  BUBBLE_HEIGHT,
  BUBBLE_NAV_STORAGE_KEY,
  BUBBLE_PAD,
  bubbleBarWidth,
  clampBubble,
  defaultBubblePosition,
  dragExceeded,
  parseStoredBubble,
  snapBubbleToEdge,
  stepBubbleMotion,
} from "../../lib/bubbleNav";
import { haptic } from "../../lib/haptics";
import { useAuth } from "../../context/AuthContext";
import { BrandLockup } from "../brand/BrandLockup";
import { NAV_ITEMS } from "./navItems";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNavActive(path: string, matchPrefix: string | undefined, pathname: string): boolean {
  if (matchPrefix) return pathname.startsWith(matchPrefix);
  return pathname === path;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Shared chrome for tablet rail + desktop sidebar — full liquid bubble. */
const SIDE_NAV_CHROME =
  "liquid-bubble liquid-chrome rounded-none";

// ---------------------------------------------------------------------------
// Mobile floating bubble tabs — GitHub / Tamil Bible / iOS AssistiveTouch.
// Drag the whole pill; it coasts with inertia and snaps to a vertical edge.
// ---------------------------------------------------------------------------

function measureViewport(): { vw: number; vh: number } {
  if (typeof window === "undefined") return { vw: 390, vh: 844 };
  return { vw: window.innerWidth, vh: window.innerHeight };
}

function persistBubble(pos: { x: number; y: number }) {
  try {
    localStorage.setItem(BUBBLE_NAV_STORAGE_KEY, JSON.stringify(pos));
  } catch {
    // private mode / quota
  }
}

function initialBubbleLayout(): { pos: { x: number; y: number }; width: number } {
  const { vw, vh } = measureViewport();
  const width = bubbleBarWidth(vw);
  let stored: string | null = null;
  try {
    if (typeof localStorage !== "undefined") {
      stored = localStorage.getItem(BUBBLE_NAV_STORAGE_KEY);
    }
  } catch {
    // private mode
  }
  const seed =
    parseStoredBubble(stored) ??
    defaultBubblePosition(vw, vh, width, BUBBLE_HEIGHT, BUBBLE_PAD);
  return {
    width,
    pos: clampBubble(seed.x, seed.y, vw, vh, width, BUBBLE_HEIGHT, BUBBLE_PAD),
  };
}

function MobileBottomTabs() {
  const { pathname } = useLocation();
  const barRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const dragOrigin = useRef<{ px: number; py: number; x: number; y: number } | null>(
    null,
  );
  const lastSample = useRef<{ t: number; x: number; y: number } | null>(null);
  const velocity = useRef({ vx: 0, vy: 0 });
  const coastRaf = useRef<number | null>(null);
  const dragged = useRef(false);
  const [pos, setPos] = useState(() => initialBubbleLayout().pos);
  const posRef = useRef(pos);
  const [barW, setBarW] = useState(() => initialBubbleLayout().width);
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);

  const activeIndex = NAV_ITEMS.findIndex(({ path, matchPrefix }) =>
    isNavActive(path, matchPrefix, pathname),
  );
  const displayIndex = activeIndex >= 0 ? activeIndex : 0;
  const activeColor = NAV_ITEMS[displayIndex]?.color ?? "#6366f1";

  function writePos(next: { x: number; y: number }) {
    posRef.current = next;
    setPos(next);
  }

  function placeInViewport(preferred?: { x: number; y: number } | null) {
    const { vw, vh } = measureViewport();
    const width = bubbleBarWidth(vw);
    setBarW(width);
    const seed =
      preferred ??
      parseStoredBubble(
        typeof localStorage === "undefined"
          ? null
          : localStorage.getItem(BUBBLE_NAV_STORAGE_KEY),
      ) ??
      defaultBubblePosition(vw, vh, width, BUBBLE_HEIGHT, BUBBLE_PAD);
    writePos(clampBubble(seed.x, seed.y, vw, vh, width, BUBBLE_HEIGHT, BUBBLE_PAD));
  }

  useEffect(() => {
    const onResize = () => placeInViewport(posRef.current);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (coastRaf.current != null) cancelAnimationFrame(coastRaf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopCoast() {
    if (coastRaf.current != null) {
      cancelAnimationFrame(coastRaf.current);
      coastRaf.current = null;
    }
  }

  function finishSnap() {
    const { vw, vh } = measureViewport();
    const width = bubbleBarWidth(vw);
    const snapped = prefersReducedMotion()
      ? clampBubble(
          posRef.current.x,
          posRef.current.y,
          vw,
          vh,
          width,
          BUBBLE_HEIGHT,
          BUBBLE_PAD,
        )
      : snapBubbleToEdge(
          posRef.current.x,
          posRef.current.y,
          vw,
          vh,
          width,
          BUBBLE_HEIGHT,
          BUBBLE_PAD,
        );
    setSettling(true);
    writePos(snapped);
    persistBubble(snapped);
    haptic("tap");
    window.setTimeout(() => setSettling(false), 420);
  }

  function coast() {
    const { vw, vh } = measureViewport();
    const width = bubbleBarWidth(vw);
    const stepped = stepBubbleMotion(
      {
        x: posRef.current.x,
        y: posRef.current.y,
        vx: velocity.current.vx,
        vy: velocity.current.vy,
      },
      vw,
      vh,
      width,
      BUBBLE_HEIGHT,
      BUBBLE_PAD,
    );
    velocity.current = { vx: stepped.motion.vx, vy: stepped.motion.vy };
    writePos({ x: stepped.motion.x, y: stepped.motion.y });
    if (stepped.settled) {
      coastRaf.current = null;
      finishSnap();
      return;
    }
    coastRaf.current = requestAnimationFrame(coast);
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    stopCoast();
    pointerId.current = e.pointerId;
    dragged.current = false;
    setSettling(false);
    dragOrigin.current = {
      px: e.clientX,
      py: e.clientY,
      x: posRef.current.x,
      y: posRef.current.y,
    };
    lastSample.current = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    velocity.current = { vx: 0, vy: 0 };
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (pointerId.current !== e.pointerId || !dragOrigin.current) return;
    const dx = e.clientX - dragOrigin.current.px;
    const dy = e.clientY - dragOrigin.current.py;
    if (!dragged.current && !dragExceeded(dx, dy)) return;

    if (!dragged.current) {
      dragged.current = true;
      setDragging(true);
      haptic("selection");
      try {
        barRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }

    const { vw, vh } = measureViewport();
    const width = bubbleBarWidth(vw);
    writePos(
      clampBubble(
        dragOrigin.current.x + dx,
        dragOrigin.current.y + dy,
        vw,
        vh,
        width,
        BUBBLE_HEIGHT,
        BUBBLE_PAD,
      ),
    );

    const prev = lastSample.current;
    if (prev) {
      const dt = Math.max(8, e.timeStamp - prev.t);
      velocity.current = {
        vx: ((e.clientX - prev.x) / dt) * 16,
        vy: ((e.clientY - prev.y) / dt) * 16,
      };
    }
    lastSample.current = { t: e.timeStamp, x: e.clientX, y: e.clientY };
  }

  function onPointerUp(e: ReactPointerEvent) {
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    dragOrigin.current = null;
    try {
      barRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (!dragged.current) {
      setDragging(false);
      return;
    }
    setDragging(false);
    if (prefersReducedMotion()) {
      finishSnap();
      return;
    }
    coastRaf.current = requestAnimationFrame(coast);
  }

  const bubbleLeft = `${(displayIndex / NAV_ITEMS.length) * 100}%`;
  const bubbleWidth = `${100 / NAV_ITEMS.length}%`;

  return (
    <nav
      aria-label="Primary navigation"
      className="pointer-events-none fixed z-30 md:hidden"
      style={{
        left: pos.x,
        top: pos.y,
        width: barW,
        transition: settling
          ? "left 420ms cubic-bezier(0.22, 1.2, 0.36, 1), top 420ms cubic-bezier(0.22, 1.2, 0.36, 1)"
          : undefined,
      }}
    >
      <div
        ref={barRef}
        className={cn(
          "pointer-events-auto liquid-bubble liquid-raised liquid-pill-track relative touch-none select-none overflow-hidden rounded-[28px]",
          dragging && "scale-[1.04]",
        )}
        style={{
          borderColor: `${activeColor}99`,
          background: `linear-gradient(180deg, ${activeColor}55, ${activeColor}22)`,
          boxShadow: `0 14px 36px -10px ${activeColor}88, 0 0 28px ${activeColor}40`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {displayIndex >= 0 && (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute top-1 bottom-1 rounded-full",
              "transition-[left] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "motion-reduce:transition-none",
            )}
            style={{
              left: bubbleLeft,
              width: bubbleWidth,
              background: `linear-gradient(180deg, ${activeColor}cc, ${activeColor}88)`,
              boxShadow: `0 0 22px ${activeColor}aa, inset 0 1px 0 rgba(255,255,255,0.45)`,
            }}
          />
        )}

        <ul className="relative z-10 flex items-stretch">
          {NAV_ITEMS.map(({ path, label, icon: Icon, color }, i) => {
            const active = i === displayIndex;
            return (
              <li key={path} className="flex-1">
                <NavLink
                  to={path}
                  end={path === "/"}
                  className="no-select flex min-h-14 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium"
                  style={{ color: active ? "#fff" : color }}
                  onClick={(ev) => {
                    if (dragged.current) ev.preventDefault();
                  }}
                >
                  <Icon
                    className={cn(
                      "size-5 transition-transform duration-300",
                      active && "scale-110",
                      "motion-reduce:transition-none motion-reduce:scale-100",
                    )}
                    strokeWidth={active ? 2.4 : 1.8}
                    aria-hidden="true"
                  />
                  <span className={cn(active && "font-semibold")}>{label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Tablet nav rail (icon-only, 72 px wide) — liquid glass
// ---------------------------------------------------------------------------

function NavRail() {
  const { pathname } = useLocation();
  const { user } = useAuth();

  return (
    <nav
      aria-label="Primary navigation"
      className={cn(
        "pt-safe fixed inset-y-0 left-0 z-30 hidden w-[4.5rem] flex-col md:flex lg:hidden",
        SIDE_NAV_CHROME,
      )}
    >
      <div className="flex h-16 items-center justify-center border-b border-white/10">
        <BrandLockup size="md" markOnly />
      </div>

      <ul className="relative z-10 flex flex-1 flex-col items-center gap-1.5 px-2 py-3">
        {NAV_ITEMS.map(({ path, label, icon: Icon, matchPrefix, color }) => {
          const active = isNavActive(path, matchPrefix, pathname);
          return (
            <li key={path} className="w-full">
              <NavLink
                to={path}
                end={path === "/"}
                title={label}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "no-select relative flex w-full flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-2 transition-colors",
                  active ? "bg-white/10" : "hover:bg-white/5",
                )}
                style={{
                  minHeight: "var(--tap-min)",
                  color: active ? color : `${color}99`,
                  boxShadow: active
                    ? `0 0 18px ${color}33, inset 0 1px 0 rgba(255,255,255,0.2)`
                    : undefined,
                }}
              >
                <Icon
                  className="size-5"
                  strokeWidth={active ? 2.4 : 1.8}
                  aria-hidden="true"
                />
                <span className="max-w-full truncate text-[9px] font-semibold leading-none">
                  {label}
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col items-center gap-2 px-2 pb-6">
        {user?.isPlatformAdmin && (
          <Link
            to="/admin/storage"
            title="Storage Admin"
            aria-label="Storage Admin"
            className={cn(
              "no-select flex items-center justify-center rounded-2xl transition-colors",
              pathname === "/admin/storage"
                ? "bg-vault-500/15 text-vault-400"
                : "text-fg-subtle hover:bg-white/5 hover:text-fg-muted",
            )}
            style={{ minWidth: "var(--tap-min)", minHeight: "var(--tap-min)" }}
          >
            <HardDrive className="size-5" aria-hidden="true" />
          </Link>
        )}
        <Link
          to="/settings"
          title="Settings"
          aria-label="Settings"
          className={cn(
            "no-select flex items-center justify-center rounded-2xl transition-colors",
            pathname === "/settings"
              ? "bg-vault-500/15 text-vault-400"
              : "text-fg-subtle hover:bg-white/5 hover:text-fg-muted",
          )}
          style={{ minWidth: "var(--tap-min)", minHeight: "var(--tap-min)" }}
        >
          <Settings className="size-5" aria-hidden="true" />
        </Link>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Desktop / laptop nav sidebar (icons + labels, 220 px) — liquid glass
// ---------------------------------------------------------------------------

function NavSidebar() {
  const { pathname } = useLocation();
  const { user } = useAuth();

  return (
    <nav
      aria-label="Primary navigation"
      className={cn(
        "pt-safe fixed inset-y-0 left-0 z-30 hidden w-[13.75rem] flex-col lg:flex",
        SIDE_NAV_CHROME,
      )}
    >
      <div className="flex h-16 items-center border-b border-white/10 px-4">
        <BrandLockup size="md" />
      </div>

      <ul className="relative z-10 flex flex-1 flex-col gap-1 px-2.5 py-3">
        {NAV_ITEMS.map(({ path, label, icon: Icon, matchPrefix, color }) => {
          const active = isNavActive(path, matchPrefix, pathname);
          return (
            <li key={path}>
              <NavLink
                to={path}
                end={path === "/"}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "no-select flex w-full items-center gap-3 rounded-2xl px-3 text-sm font-medium transition-colors",
                  active ? "bg-white/10" : "text-fg-subtle hover:bg-white/5",
                )}
                style={{
                  minHeight: "var(--tap-min)",
                  color: active ? color : undefined,
                  boxShadow: active
                    ? `0 0 20px ${color}28, inset 0 1px 0 rgba(255,255,255,0.18)`
                    : undefined,
                }}
              >
                <Icon
                  className="size-5 shrink-0"
                  strokeWidth={active ? 2.4 : 1.8}
                  aria-hidden="true"
                />
                <span>{label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-1 px-2.5 pb-6">
        {user?.isPlatformAdmin && (
          <Link
            to="/admin/storage"
            className={cn(
              "no-select flex w-full items-center gap-3 rounded-2xl px-3 text-sm font-medium transition-colors",
              pathname === "/admin/storage"
                ? "bg-vault-500/15 text-vault-400"
                : "text-fg-subtle hover:bg-white/5 hover:text-fg-muted",
            )}
            style={{ minHeight: "var(--tap-min)" }}
          >
            <HardDrive className="size-5 shrink-0" aria-hidden="true" />
            <span>Platform Admin</span>
          </Link>
        )}
        <Link
          to="/settings"
          className={cn(
            "no-select flex w-full items-center gap-3 rounded-2xl px-3 text-sm font-medium transition-colors",
            pathname === "/settings"
              ? "bg-vault-500/15 text-vault-400"
              : "text-fg-subtle hover:bg-white/5 hover:text-fg-muted",
          )}
          style={{ minHeight: "var(--tap-min)" }}
        >
          <Settings className="size-5 shrink-0" aria-hidden="true" />
          <span>Settings</span>
        </Link>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// AppShell — composes everything
// ---------------------------------------------------------------------------

export interface AppShellProps {
  children: ReactNode;
}

/**
 * Responsive application shell.
 *
 * - Mobile  (<768 px): free-floating coloured bubble tabs + phone content width
 * - Tablet  (768-1023 px): liquid icon rail (72 px) + wider content
 * - Laptop/Desktop (>=1024 px): liquid sidebar (220 px) + wide multi-column content
 *
 * Mobile bottom tabs stay `md:hidden` — never shown on laptop.
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-full">
      <MobileBottomTabs />
      <NavRail />
      <NavSidebar />

      <main
        className={cn(
          // Extra bottom padding so content clears the default docked bubble on phones only
          "min-h-full pb-20 [padding-bottom:calc(5rem+env(safe-area-inset-bottom))]",
          "md:ml-[4.5rem] md:pb-0 md:[padding-bottom:0]",
          "lg:ml-[13.75rem]",
        )}
      >
        {children}
      </main>
    </div>
  );
}
