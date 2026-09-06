import {
  FileText,
  Heart,
  LayoutDashboard,
  MessageCircle,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { cn } from "../lib/cn";
import { api } from "../lib/api";

// Instagram-style 5 tabs: Home · Docs · Chat · Activity · Family.
// Calendar/Tasks/Contacts live in the Dashboard quick-access grid;
// Settings is behind the gear on the Family tab.
const items: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/", label: "Home", icon: LayoutDashboard, end: true },
  { to: "/documents", label: "Docs", icon: FileText },
  { to: "/chat", label: "Chat", icon: MessageCircle },
  { to: "/notifications", label: "Activity", icon: Heart },
  { to: "/family", label: "Family", icon: Users },
];

function useUnreadCount(): number {
  const { data } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () =>
      api<{ unreadCount: number }>("/notifications?unreadOnly=1"),
    refetchInterval: 30_000,
    retry: false,
  });
  return data?.unreadCount ?? 0;
}

/** Index of the tab owning the current path, or -1 when none matches. */
function activeIndex(pathname: string): number {
  return items.findIndex((item) =>
    item.end ? pathname === item.to : pathname.startsWith(item.to),
  );
}

export function BottomNav() {
  const unread = useUnreadCount();
  const { pathname } = useLocation();
  const active = activeIndex(pathname);

  return (
    <nav
      aria-label="Primary"
      className="pb-safe pointer-events-none fixed inset-x-0 bottom-0 z-30"
    >
      <div className="mx-auto max-w-md px-4 pt-2 pb-3">
        <ul className="lq lq-chrome lq-raised pointer-events-auto relative flex items-stretch rounded-full p-1.5">
          {/* One liquid blob slides between tabs instead of five separate
              highlights — the continuity is the whole effect. */}
          {active >= 0 && (
            <span
              aria-hidden="true"
              className="lq lq-primary absolute inset-y-1.5 rounded-full transition-[left] duration-[520ms] ease-[var(--ease-liquid)]"
              style={{
                width: `calc((100% - 0.75rem) / ${items.length})`,
                left: `calc(0.375rem + (100% - 0.75rem) * ${active} / ${items.length})`,
              }}
            />
          )}
          {items.map(({ to, label, icon: Icon, end }) => (
            <li key={to} className="relative z-1 flex-1">
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-13 flex-col items-center justify-center gap-0.5 rounded-full py-1.5",
                    "text-[10px] font-semibold transition-colors duration-300",
                    isActive ? "text-white" : "text-fg-subtle hover:text-fg-muted",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="relative">
                      <Icon
                        className="size-5.5 transition-transform duration-500 ease-[var(--ease-spring)]"
                        strokeWidth={isActive ? 2.3 : 1.8}
                        aria-hidden="true"
                      />
                      {to === "/notifications" && unread > 0 && (
                        <span
                          aria-label={`${unread} unread notifications`}
                          className="absolute -top-1 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white shadow-[0_0_0_2px_#060a14]"
                        >
                          {unread > 9 ? "9+" : unread}
                        </span>
                      )}
                    </span>
                    <span>{label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
