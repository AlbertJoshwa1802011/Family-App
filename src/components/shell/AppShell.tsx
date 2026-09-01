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

const DRAG_MAX_X = 24;
const SHEET_PEEK_Y = 40;

function MobileBottomTabs() {
  const { pathname } = useLocation();
  const barRef = useRef<HTMLElement>(null);
  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);
  const [peeking, setPeeking] = useState(false);
  const [settling, setSettling] = useState(false);
  const pointerId = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const activeIndex = NAV_ITEMS.findIndex(({ path, matchPrefix }) =>
    isNavActive(path, matchPrefix, pathname),
  );

  // Reset drag offset when the route changes (adjust state during render).
  const [dragPath, setDragPath] = useState(pathname);
  if (pathname !== dragPath) {
    setDragPath(pathname);
    setDragX(0);
    setDragY(0);
    setPeeking(false);
    setSettling(false);
  }

  const springBack = useCallback(() => {
    if (prefersReducedMotion()) {
      setDragX(0);
      setDragY(0);
      setPeeking(false);
      setSettling(false);
      return;
    }
    setSettling(true);
    setDragX(0);
    setDragY(0);
    setPeeking(false);
    window.setTimeout(() => setSettling(false), 420);
  }, []);

  function onPointerDown(e: ReactPointerEvent) {
    // Don't steal clicks from NavLinks — only start drag after slight move.
    if (e.button !== 0) return;
    pointerId.current = e.pointerId;
    start.current = { x: e.clientX, y: e.clientY };
    setSettling(false);
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (pointerId.current !== e.pointerId || !start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;

    // Require a small threshold before capturing so taps still navigate.
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6 && !peeking) return;

    try {
      barRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (prefersReducedMotion()) return;

    // Rubber-band horizontal drag
    const clampedX = Math.max(-DRAG_MAX_X, Math.min(DRAG_MAX_X, dx * 0.55));
    setDragX(clampedX);

    // Vertical up → sheet peek (don't navigate away)
    if (dy < -SHEET_PEEK_Y) {
      setPeeking(true);
      setDragY(Math.max(-56, dy * 0.35));
    } else {
      setPeeking(false);
      setDragY(Math.max(-12, Math.min(0, dy * 0.2)));
    }
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
    springBack();
  }

  const pillStyle: CSSProperties = {
    transform: `translate3d(${dragX}px, ${dragY}px, 0)`,
    transition: settling
      ? "transform 420ms cubic-bezier(0.22, 1.2, 0.36, 1)"
      : undefined,
  };

  const bubbleLeft =
    activeIndex >= 0 ? `${(activeIndex / NAV_ITEMS.length) * 100}%` : "0%";
  const bubbleWidth = `${100 / NAV_ITEMS.length}%`;

  return (
    <nav
      ref={barRef}
      aria-label="Primary navigation"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 md:hidden"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <div
        className={cn(
          "pointer-events-auto relative mx-3 mb-2 touch-none select-none",
          "rounded-full border border-white/15 bg-white/10 shadow-lg backdrop-blur-2xl",
          "overflow-hidden",
          peeking && "liquid-sheen",
        )}
        style={pillStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Morphing active bubble */}
        {activeIndex >= 0 && (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute top-1 bottom-1 rounded-full",
              "bg-white/18 shadow-inner",
              "transition-[left,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "motion-reduce:transition-none",
            )}
            style={{ left: bubbleLeft, width: bubbleWidth }}
          />
        )}

        <ul className="relative z-10 flex items-stretch">
          {NAV_ITEMS.map(({ path, label, icon: Icon, matchPrefix }) => {
            const active = isNavActive(path, matchPrefix, pathname);
            return (
              <li key={path} className="flex-1">
                <NavLink
                  to={path}
                  end={path === "/"}
                  className={cn(
                    "no-select flex min-h-14 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors",
                    active
                      ? "text-white"
                      : "text-fg-subtle/90 hover:text-fg-muted",
                  )}
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
        {NAV_ITEMS.map(({ path, label, icon: Icon, matchPrefix }) => {
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
                  active
                    ? "bg-vault-500/15 text-vault-400"
                    : "text-fg-subtle hover:bg-white/5 hover:text-fg-muted",
                )}
                style={{ minWidth: "var(--tap-min)", minHeight: "var(--tap-min)" }}
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
        {NAV_ITEMS.map(({ path, label, icon: Icon, matchPrefix }) => {
          const active = isNavActive(path, matchPrefix, pathname);
          return (
            <li key={path}>
              <NavLink
                to={path}
                end={path === "/"}
                className={cn(
                  "no-select flex w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                  active
                    ? "bg-vault-500/15 text-vault-400"
                    : "text-fg-subtle hover:bg-white/5 hover:text-fg-muted",
                )}
                style={{ minHeight: "var(--tap-min)" }}
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
