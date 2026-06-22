import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarDays, CalendarHeart, CheckCheck, FileText, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { cn } from "../lib/cn";
import { api } from "../lib/api";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  read: boolean;
  createdAt: number;
}

interface NotificationsResponse {
  notifications: NotificationItem[];
  unreadCount: number;
}

function relativeTime(epochSecs: number): string {
  const diff = Math.floor(Date.now() / 1000) - epochSecs;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function typeIcon(type: string) {
  if (type === "event") return CalendarDays;
  if (type === "expiry") return FileText;
  if (type === "occasion") return CalendarHeart;
  if (type === "message") return MessageCircle;
  return Bell;
}

function NotificationSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Skeleton className="size-9 rounded-xl" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

export function Notifications() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<NotificationsResponse>("/notifications"),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAll = useMutation({
    mutationFn: () => api("/notifications/read-all", { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const notifications = data?.notifications ?? [];
  const unread = data?.unreadCount ?? 0;

  return (
    <>
      <AppBar
        title="Notifications"
        back
        trailing={
          unread > 0 ? (
            <Button
              variant="ghost"
              loading={markAll.isPending}
              leadingIcon={<CheckCheck className="size-4" />}
              onClick={() => markAll.mutate()}
            >
              Mark all
            </Button>
          ) : undefined
        }
      />
      <Page className="space-y-4">
        {isLoading ? (
          <Card className="divide-y divide-line" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <NotificationSkeleton key={i} />
            ))}
          </Card>
        ) : notifications.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No notifications"
            description="Reminders about expiring documents and upcoming events will appear here."
          />
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {notifications.map((n) => {
              const Icon = typeIcon(n.type);
              const inner = (
                <div className="flex items-start gap-3 px-4 py-3">
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-xl",
                      n.read
                        ? "bg-white/5 text-fg-muted"
                        : "bg-vault-500/15 text-vault-300",
                    )}
                  >
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        "truncate text-sm",
                        n.read ? "text-fg-muted" : "font-semibold text-fg",
                      )}
                    >
                      {n.title}
                    </div>
                    {n.body && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-fg-muted">
                        {n.body}
                      </div>
                    )}
                    <div className="mt-1 text-[11px] text-fg-subtle">
                      {relativeTime(n.createdAt)}
                    </div>
                  </div>
                  {!n.read && (
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-vault-400" />
                  )}
                </div>
              );

              const onActivate = () => {
                if (!n.read) markRead.mutate(n.id);
              };

              return n.link ? (
                <Link key={n.id} to={n.link} onClick={onActivate} className="block">
                  {inner}
                </Link>
              ) : (
                <button
                  key={n.id}
                  onClick={onActivate}
                  className="block w-full text-left"
                >
                  {inner}
                </button>
              );
            })}
          </Card>
        )}
      </Page>
    </>
  );
}
