import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  Contact,
  Bell,
  FileText,
  ListTodo,
  Lock,
  Plus,
  Quote,
  Wallet,
} from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { NotificationBell } from "../components/NotificationBell";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Avatar } from "../components/ui/Avatar";
import { ActionSheet, type ActionSheetItem } from "../components/ui/ActionSheet";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { expiryStatus } from "../lib/expiry";
import { formatHomeDate, greetingForHour } from "../lib/greeting";
import { quoteForDate } from "../lib/quotes";
import { haptic } from "../lib/haptics";
import { useCardGestures, useSwipe } from "../hooks/useGestures";
import { eventTypeColor, formatEventTime } from "../lib/eventTime";
import type { EventSummary } from "./Calendar";
import { cn } from "../lib/cn";

interface FamilyMember {
  id: string;
  userId: string | null;
  displayName: string | null;
  status: string;
  name: string | null;
  email: string | null;
  picture: string | null;
}

interface DashboardStats {
  documentCount: number;
  expiringCount: number;
  memberCount: number;
  storageBytes: number;
  tasksTotal: number;
  tasksCompleted: number;
}

interface TaskSummary {
  id: string;
  title: string;
  dueDate?: string | null;
  status: "open" | "done" | "archived";
}

interface DocumentSummary {
  id: string;
  title: string;
  expiryDate?: string | null;
}

interface SheetState {
  title: string;
  message?: string;
  actions: ActionSheetItem[];
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

function Pressable({
  className,
  children,
  onTap,
  onDoubleTap,
  onLongPress,
  ariaLabel,
}: {
  className?: string;
  children: ReactNode;
  onTap?: () => void;
  onDoubleTap?: () => void;
  onLongPress?: () => void;
  ariaLabel: string;
}) {
  const g = useCardGestures({ onTap, onDoubleTap, onLongPress });
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={cn(
        "select-none text-left transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "active:scale-[0.97] focus:outline-none",
        className,
      )}
      {...g}
    >
      {children}
    </button>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, activeFamilyId } = useAuth();
  const firstName = user?.name?.split(" ")[0] ?? "there";

  const [now] = useState(() => new Date());
  const greeting = greetingForHour(now.getHours());
  const quote = quoteForDate(now);
  const dateLine = formatHomeDate(now);
  const [nowTime] = useState(() => Math.floor(now.getTime() / 1000));
  const [selectedDate, setSelectedDate] = useState(() => now);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [copied, setCopied] = useState(false);

  const daysOfWeek = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      d.setHours(0, 0, 0, 0);
      return d;
    });
  }, [now]);

  const { data: stats, isLoading: isLoadingStats } = useQuery({
    queryKey: ["dashboard-stats", activeFamilyId],
    queryFn: () => api<DashboardStats>("/families/me/dashboard-stats"),
  });

  const { data: membersData } = useQuery({
    queryKey: ["family-members", activeFamilyId],
    queryFn: () => api<{ members: FamilyMember[] }>("/families/me/members"),
  });

  const { data: tasksData } = useQuery({
    queryKey: ["tasks", activeFamilyId],
    queryFn: () =>
      api<{ tasks: TaskSummary[] }>(
        activeFamilyId ? `/tasks?familyId=${activeFamilyId}` : "/tasks",
      ),
  });

  const thirtyDaysLater = nowTime + 30 * 24 * 3600;
  const { data: eventsData } = useQuery({
    queryKey: ["events", "dashboard", activeFamilyId],
    queryFn: () =>
      api<{ events: EventSummary[] }>(
        `/events?from=${nowTime}&to=${thirtyDaysLater}${
          activeFamilyId ? `&familyId=${activeFamilyId}` : ""
        }`,
      ),
  });

  const { data: docsData } = useQuery({
    queryKey: ["documents", "home", activeFamilyId],
    queryFn: () =>
      api<{ documents: DocumentSummary[] }>(
        activeFamilyId ? `/documents?familyId=${activeFamilyId}` : "/documents",
      ),
  });

  const { data: notifData } = useQuery({
    queryKey: ["notifications", "home"],
    queryFn: () =>
      api<{ unreadCount: number }>("/notifications?unreadOnly=1"),
  });

  const toggleTask = useMutation({
    mutationFn: (t: TaskSummary) =>
      api(`/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: t.status === "done" ? "open" : "done" }),
      }),
    onSuccess: () => {
      haptic("success");
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });

  const refresh = useCallback(async () => {
    haptic("selection");
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] }),
      qc.invalidateQueries({ queryKey: ["tasks"] }),
      qc.invalidateQueries({ queryKey: ["events"] }),
      qc.invalidateQueries({ queryKey: ["documents"] }),
      qc.invalidateQueries({ queryKey: ["notifications"] }),
      qc.invalidateQueries({ queryKey: ["family-members"] }),
    ]);
  }, [qc]);

  const pull = useSwipe({
    onSwipeDown: () => {
      if (typeof window !== "undefined" && window.scrollY < 28) void refresh();
    },
  });

  const members = (membersData?.members ?? []).filter((m) => m.status === "active");
  const openTasks = (tasksData?.tasks ?? []).filter((t) => t.status === "open");
  const openPreview = openTasks.slice(0, 4);

  const expiringDocs = (docsData?.documents ?? [])
    .map((d) => ({ doc: d, status: expiryStatus(d.expiryDate) }))
    .filter(
      (x): x is { doc: DocumentSummary; status: NonNullable<ReturnType<typeof expiryStatus>> } =>
        Boolean(x.status && (x.status.tone === "danger" || x.status.tone === "warning")),
    )
    .slice(0, 3);

  const activeEvents = (eventsData?.events ?? []).filter((e) => e.status === "active");

  const selectedDayEvents = activeEvents.filter((e) => {
    const eventDate = new Date(e.startAt * 1000);
    return (
      eventDate.getFullYear() === selectedDate.getFullYear() &&
      eventDate.getMonth() === selectedDate.getMonth() &&
      eventDate.getDate() === selectedDate.getDate()
    );
  });

  const todayEvents = activeEvents.filter((e) => {
    const eventDate = new Date(e.startAt * 1000);
    return (
      eventDate.getFullYear() === now.getFullYear() &&
      eventDate.getMonth() === now.getMonth() &&
      eventDate.getDate() === now.getDate()
    );
  });
  const nextEvent = todayEvents[0] ?? activeEvents[0];

  const headline = expiringDocs[0]
    ? `${expiringDocs[0].doc.title} · ${expiringDocs[0].status.label}`
    : todayEvents[0]
      ? todayEvents[0].title
      : openTasks.length > 0
        ? `${openTasks.length} open ${openTasks.length === 1 ? "task" : "tasks"}`
        : greeting.wish;

  async function copyQuote() {
    const line = `"${quote.text}" — ${quote.attribution}`;
    try {
      await navigator.clipboard.writeText(line);
      haptic("success");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      haptic("error");
    }
  }

  async function shareQuote() {
    const line = `"${quote.text}" — ${quote.attribution}`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ text: line });
        haptic("success");
        return;
      }
    } catch {
      /* user cancelled */
    }
    await copyQuote();
  }

  const storageUsed = stats?.storageBytes ?? 0;
  const maxStorage = 5 * 1024 * 1024 * 1024;
  const storagePct = Math.min(100, (storageUsed / maxStorage) * 100);
  const taskPct =
    (stats?.tasksTotal ?? 0) > 0
      ? Math.round(((stats?.tasksCompleted ?? 0) / (stats?.tasksTotal ?? 1)) * 100)
      : 0;

  return (
    <>
      <AppBar title="Today" trailing={<NotificationBell />} />
      <div {...pull}>
      <Page width="wide" className="space-y-6 pb-12">
        {/* Large title — iOS Home */}
        <header className="space-y-1 pt-1">
          <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
            {dateLine}
          </p>
          <h2 className="text-[34px] font-bold leading-tight tracking-tight text-fg">
            {greeting.phrase}, {firstName}
          </h2>
          <p className="text-[15px] leading-snug text-fg-muted">{headline}</p>
          <div className="flex items-center gap-2 pt-2">
            <div className="flex -space-x-2">
              {members.slice(0, 4).map((member) => (
                <Avatar
                  key={member.id}
                  name={member.name}
                  email={member.email}
                  src={member.picture}
                  className="size-7 ring-2 ring-ink-950"
                />
              ))}
            </div>
            {members.length > 0 && (
              <span className="text-xs text-fg-subtle">
                {members.length} at home
              </span>
            )}
          </div>
        </header>

        {/* Daily quote */}
        <Pressable
          ariaLabel="Today's quote. Double tap to copy. Hold for more."
          onDoubleTap={() => void copyQuote()}
          onLongPress={() =>
            setSheet({
              title: "Today's quote",
              message: quote.attribution,
              actions: [
                { id: "copy", label: "Copy quote", onSelect: () => void copyQuote() },
                { id: "share", label: "Share", onSelect: () => void shareQuote() },
              ],
            })
          }
          className="block w-full"
        >
          <Card className="relative overflow-hidden border-white/15 bg-white/8 p-5 backdrop-blur-xl">
            <Quote className="absolute -right-2 -top-2 size-16 text-white/5" aria-hidden />
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-vault-300">
              {copied ? "Copied" : "Today"}
            </p>
            <blockquote className="mt-2 text-[17px] font-medium leading-snug text-fg">
              “{quote.text}”
            </blockquote>
            <p className="mt-3 text-[13px] text-fg-muted">— {quote.attribution}</p>
            <p className="mt-3 text-[11px] text-fg-subtle">
              Double tap to copy · hold for share
            </p>
          </Card>
        </Pressable>

        {/* Needs attention */}
        {(expiringDocs.length > 0 || nextEvent || (notifData?.unreadCount ?? 0) > 0) && (
          <section className="space-y-2">
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
              Needs you
            </h3>
            <Card className="divide-y divide-line overflow-hidden">
              {expiringDocs.map(({ doc, status }) => (
                <Pressable
                  key={doc.id}
                  ariaLabel={doc.title}
                  onTap={() => navigate(`/documents/${doc.id}`)}
                  onLongPress={() =>
                    setSheet({
                      title: doc.title,
                      message: status.label,
                      actions: [
                        {
                          id: "open",
                          label: "Open document",
                          onSelect: () => navigate(`/documents/${doc.id}`),
                        },
                        {
                          id: "all",
                          label: "See all expiring",
                          onSelect: () => navigate("/documents?tab=expiring"),
                        },
                      ],
                    })
                  }
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-3"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-danger/15 text-danger">
                    <FileText className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">
                      {doc.title}
                    </span>
                    <span className="text-xs text-danger">{status.label}</span>
                  </span>
                </Pressable>
              ))}
              {nextEvent && (
                <Pressable
                  ariaLabel={nextEvent.title}
                  onTap={() => navigate(`/calendar/events/${nextEvent.id}`)}
                  onDoubleTap={() => navigate(`/calendar/events/${nextEvent.id}`)}
                  onLongPress={() =>
                    setSheet({
                      title: nextEvent.title,
                      actions: [
                        {
                          id: "open",
                          label: "Open event",
                          onSelect: () => navigate(`/calendar/events/${nextEvent.id}`),
                        },
                        {
                          id: "cal",
                          label: "Open calendar",
                          onSelect: () => navigate("/calendar"),
                        },
                      ],
                    })
                  }
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-3"
                >
                  <span
                    className={cn(
                      "flex size-10 items-center justify-center rounded-xl",
                      eventTypeColor(nextEvent.type).bg,
                      eventTypeColor(nextEvent.type).text,
                    )}
                  >
                    <CalendarDays className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">
                      {nextEvent.title}
                    </span>
                    <span className="text-xs text-fg-muted">
                      {formatEventTime(nextEvent.startAt, nextEvent.endAt, nextEvent.allDay)}
                    </span>
                  </span>
                </Pressable>
              )}
              {(notifData?.unreadCount ?? 0) > 0 && (
                <Pressable
                  ariaLabel="Notifications"
                  onTap={() => navigate("/notifications")}
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-3"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-vault-500/15 text-vault-300">
                    <Bell className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-fg">Reminders</span>
                    <span className="text-xs text-fg-muted">
                      {notifData?.unreadCount} unread
                    </span>
                  </span>
                </Pressable>
              )}
            </Card>
          </section>
        )}

        {/* Widgets — 2×2 like iOS stacks */}
        <div className="grid grid-cols-2 gap-3">
          <Pressable
            ariaLabel="Documents"
            onTap={() => navigate("/documents")}
            onLongPress={() =>
              setSheet({
                title: "Documents",
                actions: [
                  { id: "all", label: "All documents", onSelect: () => navigate("/documents") },
                  {
                    id: "new",
                    label: "Add a document",
                    onSelect: () => navigate("/documents/new"),
                  },
                  {
                    id: "exp",
                    label: "Expiring",
                    onSelect: () => navigate("/documents?tab=expiring"),
                  },
                ],
              })
            }
            className="block"
          >
            <Card className="h-full bg-white/6 p-4 backdrop-blur-xl">
              <FileText className="size-5 text-m3-blue" />
              <p className="mt-4 text-[28px] font-bold tabular-nums tracking-tight text-fg">
                {isLoadingStats ? "—" : (stats?.documentCount ?? 0)}
              </p>
              <p className="text-[13px] text-fg-muted">
                {(stats?.expiringCount ?? 0) > 0
                  ? `${stats?.expiringCount} expiring`
                  : "Documents"}
              </p>
            </Card>
          </Pressable>
          <Pressable
            ariaLabel="Tasks"
            onTap={() => navigate("/tasks")}
            onDoubleTap={() => navigate("/tasks/new")}
            onLongPress={() =>
              setSheet({
                title: "Tasks",
                actions: [
                  { id: "list", label: "Open tasks", onSelect: () => navigate("/tasks") },
                  { id: "new", label: "New task", onSelect: () => navigate("/tasks/new") },
                ],
              })
            }
            className="block"
          >
            <Card className="h-full bg-white/6 p-4 backdrop-blur-xl">
              <ListTodo className="size-5 text-m3-green" />
              <p className="mt-4 text-[28px] font-bold tabular-nums tracking-tight text-fg">
                {taskPct}%
              </p>
              <p className="text-[13px] text-fg-muted">
                {stats?.tasksCompleted ?? 0}/{stats?.tasksTotal ?? 0} done
              </p>
            </Card>
          </Pressable>
          <Pressable
            ariaLabel="Family"
            onTap={() => navigate("/family")}
            onLongPress={() =>
              setSheet({
                title: "Family",
                actions: [
                  { id: "open", label: "Open family", onSelect: () => navigate("/family") },
                  { id: "contacts", label: "Contacts", onSelect: () => navigate("/contacts") },
                ],
              })
            }
            className="block"
          >
            <Card className="h-full bg-white/6 p-4 backdrop-blur-xl">
              <div className="flex -space-x-1.5">
                {members.slice(0, 3).map((m) => (
                  <Avatar
                    key={m.id}
                    name={m.name}
                    email={m.email}
                    src={m.picture}
                    className="size-6 ring-2 ring-surface"
                  />
                ))}
              </div>
              <p className="mt-4 text-[28px] font-bold tabular-nums tracking-tight text-fg">
                {isLoadingStats ? "—" : (stats?.memberCount ?? members.length)}
              </p>
              <p className="text-[13px] text-fg-muted">Family</p>
            </Card>
          </Pressable>
          <Pressable
            ariaLabel="Storage"
            onTap={() => navigate("/vault")}
            onLongPress={() =>
              setSheet({
                title: "Vault",
                message: `${formatBytes(storageUsed)} of 5 GB`,
                actions: [
                  { id: "vault", label: "Open vault", onSelect: () => navigate("/vault") },
                  { id: "docs", label: "Documents", onSelect: () => navigate("/documents") },
                ],
              })
            }
            className="block"
          >
            <Card className="h-full bg-white/6 p-4 backdrop-blur-xl">
              <Lock className="size-5 text-vault-300" />
              <p className="mt-4 text-[28px] font-bold tabular-nums tracking-tight text-fg">
                {formatBytes(storageUsed)}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-vault-400"
                  style={{ width: `${Math.max(storageUsed > 0 ? 4 : 0, storagePct)}%` }}
                />
              </div>
              <p className="mt-1.5 text-[13px] text-fg-muted">Vault storage</p>
            </Card>
          </Pressable>
        </div>

        {/* Tasks — double tap completes, hold for menu */}
        <section className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
              Open tasks
            </h3>
            <button
              type="button"
              onClick={() => navigate("/tasks/new")}
              className="flex min-h-11 items-center gap-1 text-[13px] font-semibold text-vault-300"
            >
              <Plus className="size-3.5" />
              New
            </button>
          </div>
          <Card className="divide-y divide-line overflow-hidden">
            {openPreview.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-fg-subtle">
                Nothing waiting. Double tap a widget to add one.
              </p>
            ) : (
              openPreview.map((t) => (
                <Pressable
                  key={t.id}
                  ariaLabel={`${t.title}. Double tap to complete. Hold for options.`}
                  onTap={() => navigate(`/tasks/${t.id}/edit`)}
                  onDoubleTap={() => toggleTask.mutate(t)}
                  onLongPress={() =>
                    setSheet({
                      title: t.title,
                      actions: [
                        {
                          id: "done",
                          label: "Mark done",
                          onSelect: () => toggleTask.mutate(t),
                        },
                        {
                          id: "edit",
                          label: "Edit",
                          onSelect: () => navigate(`/tasks/${t.id}/edit`),
                        },
                      ],
                    })
                  }
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-3"
                >
                  <Circle className="size-5 shrink-0 text-fg-subtle" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">
                      {t.title}
                    </span>
                    {t.dueDate && (
                      <span className="text-xs text-fg-muted">Due {t.dueDate}</span>
                    )}
                  </span>
                  <CheckCircle2 className="size-4 text-fg-subtle/40" aria-hidden />
                </Pressable>
              ))
            )}
          </Card>
        </section>

        {/* Week strip */}
        <section className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
              This week
            </h3>
            <button
              type="button"
              onClick={() => navigate("/calendar")}
              className="min-h-11 text-[13px] font-semibold text-vault-300"
            >
              Calendar
            </button>
          </div>
          <div className="flex gap-1 overflow-x-auto rounded-full border border-white/15 bg-white/8 p-1 backdrop-blur-xl [scrollbar-width:none]">
            {daysOfWeek.map((day) => {
              const selected =
                day.getFullYear() === selectedDate.getFullYear() &&
                day.getMonth() === selectedDate.getMonth() &&
                day.getDate() === selectedDate.getDate();
              const isToday =
                day.getFullYear() === now.getFullYear() &&
                day.getMonth() === now.getMonth() &&
                day.getDate() === now.getDate();
              const dayLabels = ["S", "M", "T", "W", "T", "F", "S"];
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => {
                    haptic("selection");
                    setSelectedDate(day);
                  }}
                  className={cn(
                    "flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center rounded-full px-2 py-1.5 text-[11px] font-semibold",
                    selected
                      ? "bg-white/20 text-white"
                      : "text-fg-muted active:bg-white/10",
                  )}
                >
                  <span className="opacity-70">
                    {isToday ? "Now" : dayLabels[day.getDay()]}
                  </span>
                  <span className="text-[15px] tabular-nums">{day.getDate()}</span>
                </button>
              );
            })}
          </div>
          {selectedDayEvents.length === 0 ? (
            <p className="px-1 py-3 text-center text-sm text-fg-subtle">
              Free day — hold the quote to share it.
            </p>
          ) : (
            <Card className="divide-y divide-line overflow-hidden">
              {selectedDayEvents.map((ev) => (
                <Pressable
                  key={ev.id}
                  ariaLabel={ev.title}
                  onTap={() => navigate(`/calendar/events/${ev.id}`)}
                  onLongPress={() =>
                    setSheet({
                      title: ev.title,
                      actions: [
                        {
                          id: "open",
                          label: "Open",
                          onSelect: () => navigate(`/calendar/events/${ev.id}`),
                        },
                      ],
                    })
                  }
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-3"
                >
                  <span
                    className={cn(
                      "flex size-10 items-center justify-center rounded-xl",
                      eventTypeColor(ev.type).bg,
                      eventTypeColor(ev.type).text,
                    )}
                  >
                    <CalendarDays className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">
                      {ev.title}
                    </span>
                    <span className="text-xs text-fg-muted">
                      {formatEventTime(ev.startAt, ev.endAt, ev.allDay)}
                    </span>
                  </span>
                </Pressable>
              ))}
            </Card>
          )}
        </section>

        {/* App launcher */}
        <section className="space-y-2">
          <h3 className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
            Apps
          </h3>
          <div className="grid grid-cols-4 gap-3">
            {(
              [
                { to: "/tasks", label: "Tasks", icon: ListTodo, tint: "bg-m3-green-bg text-m3-green" },
                { to: "/contacts", label: "People", icon: Contact, tint: "bg-m3-red-bg text-m3-red" },
                { to: "/vault", label: "Vault", icon: Lock, tint: "bg-m3-cyan-bg text-m3-cyan" },
                { to: "/money", label: "Money", icon: Wallet, tint: "bg-vault-500/15 text-vault-300" },
              ] as const
            ).map((app) => (
              <Pressable
                key={app.to}
                ariaLabel={app.label}
                onTap={() => navigate(app.to)}
                onLongPress={() =>
                  setSheet({
                    title: app.label,
                    actions: [
                      { id: "open", label: `Open ${app.label}`, onSelect: () => navigate(app.to) },
                    ],
                  })
                }
                className="flex flex-col items-center gap-2"
              >
                <span
                  className={cn(
                    "flex size-14 items-center justify-center rounded-[22px] shadow-card",
                    app.tint,
                  )}
                >
                  <app.icon className="size-6" />
                </span>
                <span className="text-[11px] font-medium text-fg-muted">{app.label}</span>
              </Pressable>
            ))}
          </div>
        </section>
      </Page>
      </div>

      <ActionSheet
        open={Boolean(sheet)}
        onClose={() => setSheet(null)}
        title={sheet?.title}
        message={sheet?.message}
        actions={sheet?.actions ?? []}
      />
    </>
  );
}
