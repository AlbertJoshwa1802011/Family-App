import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Bell,
  Calendar,
  Check,
  ChevronRight,
  Contact,
  HardDrive,
  ListTodo,
  LogOut,
  MessageCircle,
  Settings as SettingsIcon,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Avatar } from "./ui/Avatar";
import { Badge } from "./ui/Badge";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/cn";

interface MenuLink {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

// Destinations that aren't primary nav tabs live here, so the tab bar stays at five.
const LINKS: MenuLink[] = [
  { to: "/chat", label: "Family chat", icon: MessageCircle },
  { to: "/money", label: "Money", icon: Wallet },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/tasks", label: "Tasks", icon: ListTodo },
  { to: "/contacts", label: "Contacts", icon: Contact },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/admin/storage", label: "Platform admin", icon: HardDrive, adminOnly: true },
];

/**
 * AccountMenu — the avatar button in the header and the profile panel it opens.
 *
 * Liquid-chrome sheet (phone) / floating bubble card (laptop), matching AppBar
 * and Modal so the profile surface feels like the rest of the glass UI.
 */
export function AccountMenu() {
  const { user, families, activeFamily, setActiveFamilyId, signOut } = useAuth();
  const [open, setOpen] = useState(false);
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

  const visibleLinks = LINKS.filter((l) => !l.adminOnly || user?.isPlatformAdmin);

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
          "liquid-press flex items-center justify-center rounded-full p-0.5 transition-[box-shadow,transform]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vault-400",
          open
            ? "liquid-bubble liquid-chrome ring-2 ring-vault-400/80"
            : "hover:bg-white/8",
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
            <div
              className="fixed inset-0 z-40 bg-black/45 backdrop-blur-md md:hidden"
              aria-hidden="true"
            />

            <div
              ref={panelRef}
              role="menu"
              aria-label="Account"
              className={cn(
                "pb-safe liquid-bubble liquid-chrome bubble-in fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-3xl",
                "animate-[slideUp_220ms_cubic-bezier(0.22,1,0.36,1)]",
                // Tablet and up: a floating liquid card under the header's right edge.
                "md:inset-x-auto md:right-4 md:bottom-auto",
                "md:top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)]",
                "md:w-80 md:rounded-3xl md:animate-[fadeIn_150ms_ease-out]",
              )}
            >
              {/* Grab handle (mobile) */}
              <div className="flex justify-center pt-3 md:hidden">
                <span className="h-1 w-10 rounded-full bg-white/25" />
              </div>

              {/* Identity */}
              <div className="flex items-center gap-3 px-4 py-4">
                <span className="liquid-bubble liquid-raised flex shrink-0 rounded-full p-0.5 [--lq-bg:#14b8a633]">
                  <Avatar
                    name={user?.name}
                    email={user?.email}
                    src={user?.picture}
                    className="size-12"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">
                    {user?.name ?? "Signed in"}
                  </p>
                  <p className="truncate text-xs text-fg-muted">{user?.email}</p>
                </div>
              </div>

              {/* Family switcher */}
              {families.length > 0 && (
                <div className="border-t border-white/10 px-2 py-2">
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
                              "liquid-press flex w-full items-center gap-3 rounded-2xl px-2 text-left transition-colors",
                              isActive
                                ? "liquid-bubble [--lq-bg:#14b8a626]"
                                : "hover:bg-white/8",
                            )}
                            style={{ minHeight: "var(--tap-min)" }}
                          >
                            <span className="liquid-bubble flex size-8 shrink-0 items-center justify-center rounded-xl text-vault-300 [--lq-bg:#14b8a626]">
                              <Users className="size-4" aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-fg">
                                {f.name}
                              </span>
                            </span>
                            <Badge tone={isActive ? "vault" : "neutral"}>{f.role}</Badge>
                            {isActive && (
                              <Check
                                className="size-4 shrink-0 text-vault-400"
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Secondary destinations */}
              <div className="border-t border-white/10 px-2 py-2">
                <ul>
                  {visibleLinks.map(({ to, label, icon: Icon }) => (
                    <li key={to}>
                      <Link
                        to={to}
                        role="menuitem"
                        onClick={() => setOpen(false)}
                        className="liquid-press flex w-full items-center gap-3 rounded-2xl px-2 text-sm font-medium text-fg-muted transition-colors hover:bg-white/8 hover:text-fg"
                        style={{ minHeight: "var(--tap-min)" }}
                      >
                        <span className="liquid-bubble flex size-8 shrink-0 items-center justify-center rounded-xl text-fg-muted [--lq-bg:#ffffff0f]">
                          <Icon className="size-4" aria-hidden="true" />
                        </span>
                        <span className="flex-1">{label}</span>
                        <ChevronRight
                          className="size-4 text-fg-subtle"
                          aria-hidden="true"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Sign out */}
              <div className="border-t border-white/10 px-2 py-2 pb-3">
                <button
                  type="button"
                  role="menuitem"
                  onClick={signOut}
                  className="liquid-press flex w-full items-center gap-3 rounded-2xl px-2 text-sm font-medium text-danger transition-colors hover:bg-danger/15"
                  style={{ minHeight: "var(--tap-min)" }}
                >
                  <span className="liquid-bubble flex size-8 shrink-0 items-center justify-center rounded-xl text-danger [--lq-bg:#ef444426]">
                    <LogOut className="size-4" aria-hidden="true" />
                  </span>
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
