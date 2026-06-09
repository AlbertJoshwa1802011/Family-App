import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

/** Bell button (for an AppBar trailing slot) with an unread-count badge. */
export function NotificationBell() {
  const { data } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () =>
      api<{ unreadCount: number }>("/notifications?unreadOnly=1"),
    // Light polling so the badge stays roughly fresh without a socket.
    refetchInterval: 60_000,
  });

  const unread = data?.unreadCount ?? 0;

  return (
    <Link
      to="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      className="relative flex size-11 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-white/5 active:scale-95"
    >
      <Bell className="size-6" aria-hidden="true" />
      {unread > 0 && (
        <span className="absolute top-1.5 right-1.5 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white tabular-nums">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
