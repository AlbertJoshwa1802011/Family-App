import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Calendar,
  Check,
  ChevronRight,
  Contact,
  HardDrive,
  ListTodo,
  LogOut,
  PiggyBank,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Avatar } from "./ui/Avatar";
import { Badge } from "./ui/Badge";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { cn } from "../lib/cn";

interface MenuLink {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

// Destinations that aren't primary nav tabs live here, so the tab bar stays at five.
const LINKS: MenuLink[] = [
  { to: "/settings", label: "Settings", icon: SettingsIcon },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/tasks", label: "Tasks", icon: ListTodo },
  { to: "/contacts", label: "Contacts", icon: Contact },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/admin/storage", label: "Platform admin", icon: HardDrive, adminOnly: true },
];

const EXTRA_LINKS: MenuLink[] = [
  { to: "/expenses?tab=plan", label: "Money plan", icon: PiggyBank },
];

/**
 * AccountMenu — the avatar button in the header and the profile panel it opens.
 *
 * Replaces the old settings gear: tapping the avatar shows who you are, which
 * family you're acting in (and lets you switch), the secondary destinations that
 * don't warrant a tab, and sign-out.
 */
export function AccountMenu() {
  const { user, families, activeFamily, setActiveFamilyId } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on Escape and on any click that lands outside the panel/trigger.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        !panelRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  async function signOut() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // Even if revocation fails we still clear local state and leave.
    }
    qc.clear();
    navigate("/login", { replace: true });
  }

  const visibleLinks = [...LINKS, ...EXTRA_LINKS].filter(
    (l) => !l.adminOnly || user?.isPlatformAdmin,
  );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Your account"
        className={cn(
          "flex items-center justify-center rounded-full transition-[background-color,transform] active:scale-95",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vault-400",
          open && "ring-2 ring-vault-400",
        )}
        style={{ minWidth: "var(--tap-min)", minHeight: "var(--tap-min)" }}
      >
        <Avatar
          name={user?.name}
          email={user?.email}
          src={user?.picture}
          className="size-8"
        />
      </button>

      {open &&
        // Portalled to <body> on purpose: the AppBar sets `backdrop-filter`,
        // which makes it a containing block for fixed-position descendants —
        // a panel rendered inside it would anchor to the 56px header instead of
        // the viewport. The portal escapes that.
        createPortal(
          <>
            {/* Scrim on phones. On tablet+ the dropdown leaves the page visible. */}
            <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden" />

            <div
              ref={panelRef}
              role="menu"
              aria-label="Account"
              className={cn(
                "pb-safe fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-3xl",
                "border border-line bg-surface shadow-pop",
                "animate-[slideUp_220ms_cubic-bezier(0.22,1,0.36,1)]",
                // Tablet and up: a dropdown card tucked under the header's right edge.
                "md:inset-x-auto md:right-4 md:bottom-auto",
                "md:top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)]",
                "md:w-80 md:rounded-2xl md:animate-[fadeIn_150ms_ease-out]",
              )}
            >
            {/* Grab handle (mobile) */}
            <div className="flex justify-center pt-3 md:hidden">
              <span className="h-1 w-10 rounded-full bg-line-strong" />
            </div>

            {/* Identity */}
            <div className="flex items-center gap-3 px-4 py-4">
              <Avatar
                name={user?.name}
                email={user?.email}
                src={user?.picture}
                className="size-12"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg">
                  {user?.name ?? "Signed in"}
                </p>
                <p className="truncate text-xs text-fg-muted">{user?.email}</p>
              </div>
            </div>

            {/* Family switcher */}
            {families.length > 0 && (
              <div className="border-t border-line px-2 py-2">
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                  {families.length > 1 ? "Switch family" : "Your family"}
                </p>
                <ul>
                  {families.map((f) => {
                    const isActive = f.id === activeFamily?.id;
                    return (
                      <li key={f.id}>
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={isActive}
                          onClick={() => {
                            setActiveFamilyId(f.id);
                            setOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl px-2 text-left transition-colors",
                            isActive ? "bg-vault-500/10" : "hover:bg-white/5",
                          )}
                          style={{ minHeight: "var(--tap-min)" }}
                        >
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-vault-600/25 text-vault-300">
                            <Users className="size-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-fg">
                              {f.name}
                            </span>
                          </span>
                          <Badge tone={isActive ? "vault" : "neutral"}>{f.role}</Badge>
                          {isActive && (
                            <Check className="size-4 shrink-0 text-vault-400" aria-hidden="true" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Secondary destinations */}
            <div className="border-t border-line px-2 py-2">
              <ul>
                {visibleLinks.map(({ to, label, icon: Icon }) => (
                  <li key={to}>
                    <Link
                      to={to}
                      role="menuitem"
                      onClick={() => setOpen(false)}
                      className="flex w-full items-center gap-3 rounded-xl px-2 text-sm font-medium text-fg-muted transition-colors hover:bg-white/5 hover:text-fg"
                      style={{ minHeight: "var(--tap-min)" }}
                    >
                      <Icon className="size-5 shrink-0" aria-hidden="true" />
                      <span className="flex-1">{label}</span>
                      <ChevronRight className="size-4 text-fg-subtle" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Sign out */}
            <div className="border-t border-line px-2 py-2">
              <button
                type="button"
                role="menuitem"
                onClick={signOut}
                className="flex w-full items-center gap-3 rounded-xl px-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
                style={{ minHeight: "var(--tap-min)" }}
              >
                <LogOut className="size-5 shrink-0" aria-hidden="true" />
                <span>Sign out</span>
              </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
