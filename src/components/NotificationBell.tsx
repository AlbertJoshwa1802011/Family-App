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
      className="lq-press relative flex size-10 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-white/8 hover:text-fg"
    >
      <Bell className="size-5.5" aria-hidden="true" />
      {unread > 0 && (
        <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold tabular-nums text-white shadow-[0_0_0_2px_#080d18]">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
