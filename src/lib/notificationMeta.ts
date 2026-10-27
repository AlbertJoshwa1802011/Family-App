import {
  Bell,
  BellRing,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CalendarX,
  ClipboardCheck,
  FileWarning,
  ListChecks,
  ListX,
  MessageCircle,
  UserMinus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** What a notification is about — drives the filter chips on /notifications. */
export type NotificationCategory = "calendar" | "tasks" | "documents" | "chat";

export interface NotificationMeta {
  icon: LucideIcon;
  /** Short human label shown beside the timestamp ("Invite", "Expiring"). */
  label: string;
  category: NotificationCategory | null;
  /** Any CSS colour; feeds `--lq-tint` and the icon colour. */
  tint: string;
}

/**
 * Every notification `type` the worker writes. A test scans `worker/` for
 * `type: "..."` notification writes and fails if one isn't listed here, so a
 * new type can't silently fall back to the generic bell.
 */
export const NOTIFICATION_META: Record<string, NotificationMeta> = {
  expiry: { icon: FileWarning, label: "Expiring", category: "documents", tint: "var(--color-warning)" },
  reminder: { icon: BellRing, label: "Reminder", category: "documents", tint: "var(--color-warning)" },
  mention: { icon: MessageCircle, label: "Mention", category: "chat", tint: "var(--color-info)" },
  event: { icon: CalendarDays, label: "Upcoming", category: "calendar", tint: "var(--color-vault-400)" },
  event_invite: { icon: CalendarPlus, label: "Invite", category: "calendar", tint: "var(--color-vault-400)" },
  event_rescheduled: { icon: CalendarClock, label: "Rescheduled", category: "calendar", tint: "var(--color-warning)" },
  event_cancelled: { icon: CalendarX, label: "Cancelled", category: "calendar", tint: "var(--color-danger)" },
  event_uninvited: { icon: UserMinus, label: "Removed", category: "calendar", tint: "var(--color-fg-subtle)" },
  event_rsvp: { icon: CalendarCheck, label: "RSVP", category: "calendar", tint: "var(--color-success)" },
  meeting_followup: { icon: ClipboardCheck, label: "Follow-up", category: "calendar", tint: "var(--color-info)" },
  task: { icon: ListChecks, label: "Task due", category: "tasks", tint: "var(--color-warning)" },
  task_assigned: { icon: ListChecks, label: "Assigned", category: "tasks", tint: "var(--color-vault-400)" },
  task_unassigned: { icon: ListX, label: "Unassigned", category: "tasks", tint: "var(--color-fg-subtle)" },
};

const FALLBACK: NotificationMeta = {
  icon: Bell,
  label: "Update",
  category: null,
  tint: "var(--color-vault-400)",
};

export function notificationMeta(type: string): NotificationMeta {
  return NOTIFICATION_META[type] ?? FALLBACK;
}

/** Compact relative time: "just now", "5m", "3h", "2d", then a short date. */
export function relativeTime(epochSecs: number, nowSecs: number): string {
  const diff = Math.max(0, nowSecs - epochSecs);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
    new Date(epochSecs * 1000),
  );
}

export type NotificationGroup = "Today" | "Yesterday" | "This week" | "Earlier";

/** Bucket an instant relative to the viewer's local calendar day. */
export function notificationGroup(epochSecs: number, nowSecs: number): NotificationGroup {
  const startOfToday = new Date(nowSecs * 1000);
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime() / 1000;
  if (epochSecs >= today) return "Today";
  if (epochSecs >= today - 86400) return "Yesterday";
  if (epochSecs >= today - 6 * 86400) return "This week";
  return "Earlier";
}

/** Group an already newest-first list, preserving order within each bucket. */
export function groupNotifications<T extends { createdAt: number }>(
  items: T[],
  nowSecs: number,
): { group: NotificationGroup; items: T[] }[] {
  const out: { group: NotificationGroup; items: T[] }[] = [];
  for (const item of items) {
    const group = notificationGroup(item.createdAt, nowSecs);
    const last = out[out.length - 1];
    if (last?.group === group) last.items.push(item);
    else out.push({ group, items: [item] });
  }
  return out;
}
