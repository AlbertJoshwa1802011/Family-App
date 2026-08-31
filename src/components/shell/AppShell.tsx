import { HardDrive, Settings } from "lucide-react";
import type { ReactNode } from "react";
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
  // Home ("/") matches only the exact root
  return pathname === path;
}

// ---------------------------------------------------------------------------
// Mobile bottom tab bar
// ---------------------------------------------------------------------------

function MobileBottomTabs() {
  const { pathname } = useLocation();

  return (
    <nav
      aria-label="Primary navigation"
      className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink-950/85 backdrop-blur-lg md:hidden"
    >
      <ul className="mx-auto flex max-w-md items-stretch">
        {NAV_ITEMS.map(({ path, label, icon: Icon, matchPrefix }) => {
          const active = isNavActive(path, matchPrefix, pathname);
          return (
            <li key={path} className="flex-1">
              <NavLink
                to={path}
                end={path === "/"}
                className={cn(
                  "no-select flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors",
                  active ? "text-vault-300" : "text-fg-subtle hover:text-fg-muted",
                )}
              >
                <Icon
                  className="size-5"
                  strokeWidth={active ? 2.4 : 1.8}
                  aria-hidden="true"
                />
                <span>{label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Mobile top header bar
// ---------------------------------------------------------------------------
// Tablet nav rail (icon-only, 64 px wide)
// ---------------------------------------------------------------------------

function NavRail() {
  const { pathname } = useLocation();
  const { user } = useAuth();

  return (
    <nav
      aria-label="Primary navigation"
      className="pt-safe fixed inset-y-0 left-0 z-30 hidden w-16 flex-col border-r border-line bg-ink-950/90 backdrop-blur-lg md:flex lg:hidden"
    >
      {/* Brand mark */}
      <div className="flex h-16 items-center justify-center border-b border-line">
        <BrandLockup size="md" markOnly />
      </div>

      {/* Nav items */}
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

      {/* Settings & Admin at bottom */}
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
      className="pt-safe fixed inset-y-0 left-0 z-30 hidden w-[200px] flex-col border-r border-line bg-ink-950/90 backdrop-blur-lg lg:flex"
    >
      {/* Brand */}
      <div className="flex h-16 items-center border-b border-line px-4">
        <BrandLockup size="md" />
      </div>

      {/* Nav items */}
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

      {/* Settings & Admin at bottom */}
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
 * - Mobile  (<768 px): mobile top bar + content area + fixed bottom tabs
 * - Tablet  (768-1023 px): icon-only nav rail (64 px) + content shifted right
 * - Desktop (>=1024 px): icon+label sidebar (200 px) + content shifted right
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-full">
      {/* Mobile chrome — the page's own AppBar is the header; see ui/AppBar.tsx */}
      <MobileBottomTabs />

      {/* Tablet rail */}
      <NavRail />

      {/* Desktop sidebar */}
      <NavSidebar />

      {/*
       * Main content area.
       * - Mobile:  no left offset; bottom padding clears the fixed tab bar + safe area.
       * - Tablet:  left offset = rail width (64 px / w-16); no bottom tabs.
       * - Desktop: left offset = sidebar width (200 px).
       */}
      <main
        className={cn(
          // Mobile: account for top bar (h-14) and bottom tabs
          "min-h-full pb-16 [padding-bottom:calc(4rem+env(safe-area-inset-bottom))]",
          // Tablet: shift right past rail, drop bottom padding
          "md:ml-16 md:pb-0 md:[padding-bottom:0]",
          // Desktop: shift right past sidebar
          "lg:ml-[200px]",
        )}
      >
        {children}
      </main>
    </div>
  );
}
