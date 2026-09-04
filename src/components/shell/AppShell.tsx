import { HardDrive, Settings } from "lucide-react";
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { cn } from "../../lib/cn";
import { indexFromX } from "../../lib/liquidNav";
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
// Mobile liquid-glass bottom tab bar (pinned like WhatsApp / iOS)
// Long-press then drag moves the active pill *inside* the bar only.
// ---------------------------------------------------------------------------

const LONG_PRESS_MS = 380;

function MobileBottomTabs() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const barRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const pressTimer = useRef<number | null>(null);
  const armed = useRef(false);
  const dragged = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const activeIndex = NAV_ITEMS.findIndex(({ path, matchPrefix }) =>
    isNavActive(path, matchPrefix, pathname),
  );
  const displayIndex = dragIndex ?? (activeIndex >= 0 ? activeIndex : 0);
  const activeColor = NAV_ITEMS[displayIndex]?.color ?? "#6366f1";

  function clearPressTimer() {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function indexAt(clientX: number): number {
    const el = barRef.current;
    if (!el) return displayIndex;
    const rect = el.getBoundingClientRect();
    return indexFromX(clientX - rect.left, rect.width, NAV_ITEMS.length);
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    pointerId.current = e.pointerId;
    armed.current = false;
    dragged.current = false;
    const startX = e.clientX;
    pressTimer.current = window.setTimeout(() => {
      armed.current = true;
      setDragging(true);
      setDragIndex(indexAt(startX));
      try {
        barRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }, prefersReducedMotion() ? 10_000 : LONG_PRESS_MS);
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (pointerId.current !== e.pointerId) return;
    if (!armed.current) return;
    dragged.current = true;
    setDragIndex(indexAt(e.clientX));
  }

  function onPointerUp(e: ReactPointerEvent) {
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    clearPressTimer();
    try {
      barRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (armed.current) {
      const next = indexAt(e.clientX);
      const item = NAV_ITEMS[next];
      if (item) navigate(item.path);
    }
    armed.current = false;
    setDragging(false);
    setDragIndex(null);
  }

  const bubbleLeft = `${(displayIndex / NAV_ITEMS.length) * 100}%`;
  const bubbleWidth = `${100 / NAV_ITEMS.length}%`;

  return (
    <nav
      aria-label="Primary navigation"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(10px,env(safe-area-inset-bottom))] md:hidden"
    >
      <div
        ref={barRef}
        className={cn(
          "pointer-events-auto relative mx-auto max-w-md touch-none select-none overflow-hidden",
          "rounded-[28px] border border-white/20 shadow-[0_8px_40px_-8px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.28)]",
          "bg-white/12 backdrop-blur-2xl backdrop-saturate-150",
          dragging && "scale-[1.015]",
        )}
        style={{ borderColor: `${activeColor}66` }}
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
              dragging
                ? undefined
                : "transition-[left] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "motion-reduce:transition-none",
            )}
            style={{
              left: bubbleLeft,
              width: bubbleWidth,
              background: `linear-gradient(180deg, ${activeColor}55, ${activeColor}28)`,
              boxShadow: `0 0 22px ${activeColor}55, inset 0 1px 0 rgba(255,255,255,0.35)`,
            }}
          />
        )}

        <ul className="relative z-10 flex items-stretch">
          {NAV_ITEMS.map(({ path, label, icon: Icon, matchPrefix, color }, i) => {
            const active = i === displayIndex;
            return (
              <li key={path} className="flex-1">
                <NavLink
                  to={path}
                  end={path === "/"}
                  className="no-select flex min-h-14 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium"
                  style={{ color: active ? color : `${color}aa` }}
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
 * - Mobile  (<768 px): pinned liquid-glass bottom tabs + content
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
          // Extra bottom padding so content clears the pinned tab bar
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
