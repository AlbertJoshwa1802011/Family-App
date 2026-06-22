import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CalendarDays, CalendarHeart, Clock, Contact, FileText, HardDrive, ListTodo, MessageCircle, Plus, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { NotificationBell } from "../components/NotificationBell";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ListItem } from "../components/ui/ListItem";
import { Badge } from "../components/ui/Badge";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import type { EventSummary } from "./Calendar";
import { eventTypeColor, formatEventTime } from "../lib/eventTime";
import {
  countdownLabel,
  daysUntil,
  nextOccurrence,
  occasionTypeMeta,
} from "../lib/occasions";

interface Occasion {
  id: string;
  type: string;
  title: string;
  date: string;
  recurring: boolean;
}

function UpcomingOccasionsWidget() {
  const { families } = useAuth();
  const familyId = families[0]?.id;
  const { data } = useQuery({
    queryKey: ["occasions", familyId],
    queryFn: () => api<{ occasions: Occasion[] }>(`/occasions?familyId=${familyId}`),
    enabled: Boolean(familyId),
  });

  const upcoming = useMemo(() => {
    return (data?.occasions ?? [])
      .map((o) => {
        const next = nextOccurrence(o.date, o.recurring);
        return { ...o, days: daysUntil(next) };
      })
      .filter((o) => o.days >= 0)
      .sort((a, b) => a.days - b.days)
      .slice(0, 3);
  }, [data]);

  if (upcoming.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg-muted">Upcoming occasions</h3>
        <Link
          to="/occasions"
          className="flex items-center gap-1 text-xs text-vault-400 hover:text-vault-300"
        >
          View all
        </Link>
      </div>
      <Card className="divide-y divide-line overflow-hidden">
        {upcoming.map((o) => {
          const meta = occasionTypeMeta(o.type);
          const Icon = meta.icon;
          return (
            <ListItem
              key={o.id}
              to={`/occasions/${o.id}/edit`}
              leading={
                <span className="flex size-9 items-center justify-center rounded-xl bg-vault-500/10 text-vault-300">
                  <Icon className="size-5" />
                </span>
              }
              title={o.title}
              subtitle={meta.label}
              trailing={
                <Badge tone={o.days <= 7 ? "warning" : "neutral"}>
                  {countdownLabel(o.days)}
                </Badge>
              }
            />
          );
        })}
      </Card>
    </section>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <Card className="p-4">
      <div
        className={`flex size-9 items-center justify-center rounded-xl ${accent}`}
      >
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div className="mt-3 text-2xl font-bold tabular-nums text-fg">
        {value}
      </div>
      <div className="mt-0.5 text-xs text-fg-muted">{label}</div>
    </Card>
  );
}

function QuickLink({
  to,
  icon: Icon,
  label,
  accent,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  accent: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 transition-colors hover:bg-white/5 active:scale-[0.98]"
    >
      <span className={`flex size-9 items-center justify-center rounded-xl ${accent}`}>
        <Icon className="size-5" />
      </span>
      <span className="text-sm font-medium text-fg">{label}</span>
    </Link>
  );
}

function UpcomingEventsWidget() {
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const thirtyDays = now + 30 * 24 * 3600;

  const { data } = useQuery({
    queryKey: ["events", "upcoming"],
    queryFn: () =>
      api<{ events: EventSummary[] }>(`/events?from=${now}&to=${thirtyDays}`),
  });

  const upcoming = (data?.events ?? [])
    .filter((e) => e.status === "active")
    .slice(0, 3);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg-muted">Upcoming events</h3>
        <Link
          to="/calendar/events/new"
          className="flex items-center gap-1 text-xs text-vault-400 hover:text-vault-300"
        >
          <Plus className="size-3.5" />
          Add
        </Link>
      </div>
      {upcoming.length === 0 ? (
        <div className="rounded-2xl border border-line px-4 py-3 text-sm text-fg-subtle">
          No events in the next 30 days.{" "}
          <Link to="/calendar" className="text-vault-400 underline">
            View calendar
          </Link>
        </div>
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {upcoming.map((ev) => {
            const colors = eventTypeColor(ev.type);
            return (
              <ListItem
                key={ev.id}
                to={`/calendar/events/${ev.id}`}
                leading={
                  <span
                    className={`flex size-9 items-center justify-center rounded-xl ${colors.bg} ${colors.text}`}
                  >
                    <CalendarDays className="size-5" />
                  </span>
                }
                title={ev.title}
                subtitle={formatEventTime(ev.startAt, ev.endAt, ev.allDay)}
              />
            );
          })}
        </Card>
      )}
    </section>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0] ?? "there";

  return (
    <>
      <AppBar title="Family Vault" trailing={<NotificationBell />} />
      <Page className="space-y-6">
        <div>
          <p className="text-sm text-fg-muted">Welcome back,</p>
          <h2 className="text-xl font-semibold text-fg">{firstName} 👋</h2>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={FileText}
            label="Documents"
            value="—"
            accent="bg-vault-500/15 text-vault-300"
          />
          <StatCard
            icon={Clock}
            label="Expiring soon"
            value="—"
            accent="bg-warning/15 text-warning"
          />
          <StatCard
            icon={Users}
            label="Family members"
            value="—"
            accent="bg-info/15 text-info"
          />
          <StatCard
            icon={HardDrive}
            label="Storage used"
            value="—"
            accent="bg-success/15 text-success"
          />
        </div>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-fg-muted">
            Upcoming expiries
          </h3>
          <EmptyState
            icon={CalendarClock}
            title="Nothing expiring soon"
            description="Documents nearing their expiry date will show up here so you can renew in time."
          />
        </section>

        <UpcomingOccasionsWidget />

        <UpcomingEventsWidget />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-fg-muted">Quick access</h3>
          <div className="grid grid-cols-2 gap-3">
            <QuickLink to="/occasions" icon={CalendarHeart} label="Occasions" accent="bg-vault-500/15 text-vault-300" />
            <QuickLink to="/chat" icon={MessageCircle} label="Family chat" accent="bg-success/15 text-success" />
            <QuickLink to="/tasks" icon={ListTodo} label="Tasks" accent="bg-info/15 text-info" />
            <QuickLink to="/contacts" icon={Contact} label="Contacts" accent="bg-danger/15 text-danger" />
          </div>
        </section>
      </Page>
    </>
  );
}
