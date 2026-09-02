import { HardDrive, Settings } from "lucide-react";
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { cn } from "../../lib/cn";
import { useAuth } from "../../context/AuthContext";
import { BrandLockup } from "../brand/BrandLockup";
import { NAV_ITEMS } from "./navItems";
import {
  clampBubble,
  defaultBubblePosition,
  snapBubbleToEdge,
} from "../../lib/bubbleNav";

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

// ---------------------------------------------------------------------------
// Mobile liquid-glass bottom tab bar
// ---------------------------------------------------------------------------

const BUBBLE_POS_KEY = "fv:nav-bubble";
const BUBBLE_PAD = 12;
const BUBBLE_HEIGHT = 64;

function readBubblePos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(BUBBLE_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { x?: number; y?: number };
    if (typeof parsed.x === "number" && typeof parsed.y === "number") {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    // ignore
  }
  return null;
}

function writeBubblePos(next: { x: number; y: number }) {
  try {
    localStorage.setItem(BUBBLE_POS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function MobileBottomTabs() {
  const { pathname } = useLocation();
  const barRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window === "undefined") return { x: 12, y: 12 };
    const width = Math.min(360, window.innerWidth - 24);
    return (
      readBubblePos() ??
      defaultBubblePosition(
        window.innerWidth,
        window.innerHeight,
        width,
        BUBBLE_HEIGHT,
        BUBBLE_PAD,
      )
    );
  });
  const posRef = useRef(pos);
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);
  const pointerId = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const moved = useRef(false);
  const activeIndex = NAV_ITEMS.findIndex(({ path, matchPrefix }) =>
    isNavActive(path, matchPrefix, pathname),
  );
  const activeColor = activeIndex >= 0 ? NAV_ITEMS[activeIndex].color : "#6366f1";

  const persistSnap = useCallback((next: { x: number; y: number }) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(360, vw - 24);
    const snapped = prefersReducedMotion()
      ? clampBubble(next.x, next.y, vw, vh, width, BUBBLE_HEIGHT, BUBBLE_PAD)
      : snapBubbleToEdge(next.x, next.y, vw, vh, width, BUBBLE_HEIGHT, BUBBLE_PAD);
    setSettling(!prefersReducedMotion());
    posRef.current = snapped;
    setPos(snapped);
    writeBubblePos(snapped);
    window.setTimeout(() => setSettling(false), 420);
  }, []);

  function onPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    pointerId.current = e.pointerId;
    start.current = { x: e.clientX, y: e.clientY, px: posRef.current.x, py: posRef.current.y };
    moved.current = false;
    setSettling(false);
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (pointerId.current !== e.pointerId || !start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (!moved.current && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    moved.current = true;
    setDragging(true);
    try {
      barRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(360, vw - 24);
    const next = clampBubble(
      start.current.px + dx,
      start.current.py + dy,
      vw,
      vh,
      width,
      BUBBLE_HEIGHT,
      BUBBLE_PAD,
    );
    posRef.current = next;
    setPos(next);
  }

  function onPointerUp(e: ReactPointerEvent) {
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    start.current = null;
    try {
      barRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setDragging(false);
    if (moved.current) persistSnap(posRef.current);
  }

  const pillStyle: CSSProperties = {
    left: pos.x,
    top: pos.y,
    width: "min(360px, calc(100vw - 24px))",
    transition: settling
      ? "left 420ms cubic-bezier(0.22, 1.2, 0.36, 1), top 420ms cubic-bezier(0.22, 1.2, 0.36, 1)"
      : undefined,
    borderColor: `${activeColor}55`,
    background: "linear-gradient(180deg, rgba(15,23,42,0.88), rgba(15,23,42,0.78))",
  };

  const bubbleLeft =
    activeIndex >= 0 ? `${(activeIndex / NAV_ITEMS.length) * 100}%` : "0%";
  const bubbleWidth = `${100 / NAV_ITEMS.length}%`;

  return (
    <nav
      aria-label="Primary navigation"
      className="pointer-events-none fixed inset-0 z-30 md:hidden"
    >
      <div
        ref={barRef}
        className={cn(
          "pointer-events-auto absolute touch-none select-none",
          "rounded-full border shadow-lg backdrop-blur-2xl overflow-hidden",
          dragging && "scale-[1.02] shadow-2xl",
        )}
        style={pillStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {activeIndex >= 0 && (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute top-1 bottom-1 rounded-full",
              "transition-[left,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "motion-reduce:transition-none",
            )}
            style={{
              left: bubbleLeft,
              width: bubbleWidth,
              backgroundColor: `${activeColor}40`,
              boxShadow: `0 0 18px ${activeColor}66`,
            }}
          />
        )}

        <ul className="relative z-10 flex items-stretch">
          {NAV_ITEMS.map(({ path, label, icon: Icon, matchPrefix, color }) => {
            const active = isNavActive(path, matchPrefix, pathname);
            return (
              <li key={path} className="flex-1">
                <NavLink
                  to={path}
                  end={path === "/"}
                  className="no-select flex min-h-14 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium"
                  style={{ color: active ? color : `${color}aa` }}
                  onClick={(ev) => {
                    if (moved.current) ev.preventDefault();
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
// Tablet nav rail (icon-only, 64 px wide)
// ---------------------------------------------------------------------------

function NavRail() {
  const { pathname } = useLocation();
  const { user } = useAuth();

  return (
    <nav
      aria-label="Primary navigation"
      className="pt-safe fixed inset-y-0 left-0 z-30 hidden w-16 flex-col border-r border-white/10 bg-ink-950/70 backdrop-blur-xl md:flex lg:hidden"
    >
      <div className="flex h-16 items-center justify-center border-b border-line">
        <BrandLockup size="md" markOnly />
      </div>

      <ul className="flex flex-1 flex-col items-center gap-1 py-3">
        {NAV_ITEMS.map(({ path, label, icon: Icon, matchPrefix, color }) => {
          const active = isNavActive(path, matchPrefix, pathname);
          return (
            <li key={path}>
              <NavLink
                to={path}
                end={path === "/"}
                title={label}
                aria-label={label}
                className={cn(
                  "no-select flex items-center justify-center rounded-xl transition-colors",
                  active ? "bg-white/10" : "hover:bg-white/5",
                )}
                style={{
                  minWidth: "var(--tap-min)",
                  minHeight: "var(--tap-min)",
                  color: active ? color : `${color}99`,
                }}
              >
                <Icon
                  className="size-5"
                  strokeWidth={active ? 2.4 : 1.8}
                  aria-hidden="true"
                />
              </NavLink>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col items-center pb-6 gap-2">
        {user?.isPlatformAdmin && (
          <Link
            to="/admin/storage"
            title="Storage Admin"
            aria-label="Storage Admin"
            className={cn(
              "no-select flex items-center justify-center rounded-xl transition-colors",
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
            "no-select flex items-center justify-center rounded-xl transition-colors",
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
// Desktop nav sidebar (icons + labels, 200 px wide)
// ---------------------------------------------------------------------------

function NavSidebar() {
  const { pathname } = useLocation();
  const { user } = useAuth();

  return (
    <nav
      aria-label="Primary navigation"
      className="pt-safe fixed inset-y-0 left-0 z-30 hidden w-[200px] flex-col border-r border-white/10 bg-ink-950/70 backdrop-blur-xl lg:flex"
    >
      <div className="flex h-16 items-center border-b border-line px-4">
        <BrandLockup size="md" />
      </div>

      <ul className="flex flex-1 flex-col gap-1 px-2 py-3">
        {NAV_ITEMS.map(({ path, label, icon: Icon, matchPrefix, color }) => {
          const active = isNavActive(path, matchPrefix, pathname);
          return (
            <li key={path}>
              <NavLink
                to={path}
                end={path === "/"}
                className={cn(
                  "no-select flex w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                  active ? "bg-white/10" : "hover:bg-white/5 text-fg-subtle",
                )}
                style={{
                  minHeight: "var(--tap-min)",
                  color: active ? color : undefined,
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

      <div className="px-2 pb-6 flex flex-col gap-1">
        {user?.isPlatformAdmin && (
          <Link
            to="/admin/storage"
            className={cn(
              "no-select flex w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
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
            "no-select flex w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
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
 * - Mobile  (<768 px): floating liquid-glass bottom tabs + content
 * - Tablet  (768-1023 px): icon-only nav rail (64 px) + content shifted right
 * - Desktop (>=1024 px): icon+label sidebar (200 px) + content shifted right
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-full">
      <MobileBottomTabs />
      <NavRail />
      <NavSidebar />

      <main
        className={cn(
          // Extra bottom padding so content clears the floating pill
          "min-h-full pb-20 [padding-bottom:calc(5rem+env(safe-area-inset-bottom))]",
          "md:ml-16 md:pb-0 md:[padding-bottom:0]",
          "lg:ml-[200px]",
        )}
      >
        {children}
      </main>
    </div>
  );
}
