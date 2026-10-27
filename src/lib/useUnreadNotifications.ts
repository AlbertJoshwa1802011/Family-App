import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  read: boolean;
  createdAt: number;
}

export interface NotificationsResponse {
  notifications: NotificationItem[];
  unreadCount: number;
}

export const UNREAD_NOTIFICATIONS_KEY = ["notifications", "unread"] as const;

/**
 * The one unread poll shared by the bell, the bottom-nav badge and the arrival
 * banner. They used to poll under two different keys (twice the requests and
 * badges that could disagree); one key means one request and one truth.
 */
export function useUnreadNotifications() {
  const { data } = useQuery({
    queryKey: UNREAD_NOTIFICATIONS_KEY,
    queryFn: () => api<NotificationsResponse>("/notifications?unreadOnly=1"),
    // Light polling so the badge stays roughly fresh without a socket.
    refetchInterval: 30_000,
    retry: false,
  });
  return {
    unreadCount: data?.unreadCount ?? 0,
    unread: data?.notifications ?? null,
  };
}
