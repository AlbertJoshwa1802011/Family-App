import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Heart, SearchX } from "lucide-react";
import { Link } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { cn } from "../lib/cn";
import { api } from "../lib/api";
import {
  groupNotifications,
  notificationMeta,
  relativeTime,
  type NotificationCategory,
} from "../lib/notificationMeta";
import type {
  NotificationItem,
  NotificationsResponse,
} from "../lib/useUnreadNotifications";

type Filter = "all" | "unread" | NotificationCategory;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "calendar", label: "Calendar" },
  { value: "tasks", label: "Tasks" },
  { value: "documents", label: "Documents" },
  { value: "chat", label: "Chat" },
];

function matches(n: NotificationItem, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "unread") return !n.read;
  return notificationMeta(n.type).category === filter;
}

function NotificationSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

function NotificationRow({
  n,
  nowSecs,
  onActivate,
}: {
  n: NotificationItem;
  nowSecs: number;
  onActivate: () => void;
}) {
  const meta = notificationMeta(n.type);
  const Icon = meta.icon;
  const inner = (
    <div className="flex items-start gap-3 px-4 py-3">
      <span
        data-testid="notification-icon"
        className={cn(
          "lq lq-flat lq-tint flex size-10 shrink-0 items-center justify-center rounded-full transition-opacity",
          n.read && "opacity-60",
        )}
        style={{ "--lq-tint": meta.tint, color: meta.tint } as CSSProperties}
      >
        <Icon className="size-5" aria-hidden="true" />
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
          <div className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{n.body}</div>
        )}
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-fg-subtle">
          <span className="font-semibold" style={{ color: meta.tint }}>
            {meta.label}
          </span>
          <span aria-hidden="true">·</span>
          <span>{relativeTime(n.createdAt, nowSecs)}</span>
        </div>
      </div>
      {!n.read && (
        <span
          aria-label="Unread"
          className="mt-1.5 size-2 shrink-0 rounded-full bg-vault-400 shadow-[0_0_8px_var(--color-vault-400)]"
        />
      )}
    </div>
  );

  const cls = cn("lq-press block w-full text-left", !n.read && "bg-white/[0.03]");
  return n.link ? (
    <Link to={n.link} onClick={onActivate} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onActivate} className={cls}>
      {inner}
    </button>
  );
}

export function Notifications() {
  const qc = useQueryClient();
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const [filter, setFilter] = useState<Filter>("all");

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

  const notifications = useMemo(() => data?.notifications ?? [], [data]);
  const unread = data?.unreadCount ?? 0;
  const groups = useMemo(
    () => groupNotifications(notifications.filter((n) => matches(n, filter)), now),
    [notifications, filter, now],
  );

  return (
    <>
      <AppBar
        title="Activity"
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
        {notifications.length > 0 && (
          <div
            role="group"
            aria-label="Filter notifications"
            className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
          >
            {FILTERS.map((f) => (
              <Chip
                key={f.value}
                selected={filter === f.value}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
                {f.value === "unread" && unread > 0 && (
                  <span className="ml-1.5 tabular-nums opacity-80">{unread}</span>
                )}
              </Chip>
            ))}
          </div>
        )}

        {isLoading ? (
          <Card className="divide-y divide-white/8" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <NotificationSkeleton key={i} />
            ))}
          </Card>
        ) : notifications.length === 0 ? (
          <EmptyState
            icon={Heart}
            title="You're all caught up"
            description="Mentions, invites, task assignments, expiring documents and event alerts will show up here."
          />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title={filter === "unread" ? "Nothing unread" : "Nothing here yet"}
            description="Try another filter to see the rest of your activity."
          />
        ) : (
          groups.map(({ group, items }) => (
            <section key={group} aria-label={group} className="bubble-in space-y-2">
              <h2 className="px-1 text-[13px] font-semibold text-fg-muted">
                {group}
              </h2>
              <Card className="divide-y divide-white/8 overflow-hidden">
                {items.map((n) => (
                  <NotificationRow
                    key={n.id}
                    n={n}
                    nowSecs={now}
                    onActivate={() => {
                      if (!n.read) markRead.mutate(n.id);
                    }}
                  />
                ))}
              </Card>
            </section>
          ))
        )}
      </Page>
    </>
  );
}
