import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { notificationMeta } from "../lib/notificationMeta";
import {
  useUnreadNotifications,
  type NotificationItem,
} from "../lib/useUnreadNotifications";

/** How long the banner stays up before sliding away on its own. */
export const NOTIFICATION_TOAST_MS = 6000;

/**
 * iOS-style arrival banner, mounted once in Layout so it works on every page.
 *
 * Driven by the shared unread poll: the first response only *seeds* what we've
 * seen (opening the app shouldn't replay yesterday's backlog as banners); any
 * unread id that appears after that is "new". The Activity page is the list
 * itself, so no banner there.
 */
export function NotificationToast() {
  const { unread } = useUnreadNotifications();
  const seen = useRef<Set<string> | null>(null);
  const [current, setCurrent] = useState<{ item: NotificationItem; more: number } | null>(
    null,
  );
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const onActivity = pathname.startsWith("/notifications");

  useEffect(() => {
    if (!unread) return;
    if (!seen.current) {
      seen.current = new Set(unread.map((n) => n.id));
      return;
    }
    const fresh = unread.filter((n) => !seen.current!.has(n.id));
    for (const n of fresh) seen.current.add(n.id);
    // Arriving while the list is on screen: the list already shows it.
    if (fresh.length === 0 || onActivity) return;
    setCurrent({ item: fresh[0], more: fresh.length - 1 });
  }, [unread, onActivity]);

  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setCurrent(null), NOTIFICATION_TOAST_MS);
    return () => clearTimeout(t);
  }, [current]);

  if (!current || onActivity) return null;

  const { item, more } = current;
  const meta = notificationMeta(item.type);
  const Icon = meta.icon;

  const open = () => {
    setCurrent(null);
    if (more === 0) {
      void api(`/notifications/${item.id}/read`, { method: "POST" })
        .then(() => qc.invalidateQueries({ queryKey: ["notifications"] }))
        .catch(() => undefined);
    }
    navigate(more === 0 && item.link ? item.link : "/notifications");
  };

  return (
    <div className="pt-safe pointer-events-none fixed inset-x-0 top-0 z-50">
      <div
        role="status"
        aria-live="polite"
        className="lq lq-chrome lq-raised bubble-in pointer-events-auto mx-auto mt-3 flex w-[calc(100%-2rem)] max-w-sm items-center gap-3 rounded-bubble py-2.5 pr-2 pl-3"
      >
        <button
          type="button"
          onClick={open}
          aria-label={`Open notification: ${item.title}`}
          className="lq-press flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span
            className="lq lq-flat lq-tint flex size-10 shrink-0 items-center justify-center rounded-full"
            style={{ "--lq-tint": meta.tint, color: meta.tint } as React.CSSProperties}
          >
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-fg">{item.title}</span>
            <span className="block truncate text-xs text-fg-muted">
              {more > 0 ? `+${more} more new` : (item.body ?? meta.label)}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setCurrent(null)}
          aria-label="Dismiss notification"
          className="lq-press flex size-9 shrink-0 items-center justify-center rounded-full text-fg-subtle hover:text-fg"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
