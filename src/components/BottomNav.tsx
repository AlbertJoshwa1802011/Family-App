import {
  FileText,
  Heart,
  LayoutDashboard,
  MessageCircle,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";
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

export function BottomNav() {
  const unread = useUnreadCount();

  return (
    <nav
      aria-label="Primary"
      className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink-950/85 backdrop-blur-lg"
    >
      <ul className="mx-auto flex max-w-md items-stretch">
        {items.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors",
                  isActive ? "text-vault-300" : "text-fg-subtle hover:text-fg-muted",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <Icon
                      className="size-5"
                      strokeWidth={isActive ? 2.4 : 1.8}
                      aria-hidden="true"
                    />
                    {to === "/notifications" && unread > 0 && (
                      <span
                        aria-label={`${unread} unread notifications`}
                        className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white"
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
    </nav>
  );
}
