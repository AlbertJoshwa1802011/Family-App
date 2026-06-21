import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CalendarDays, Clock, Contact, FileText, HardDrive, ListTodo, Plus, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { NotificationBell } from "../components/NotificationBell";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ListItem } from "../components/ui/ListItem";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import type { EventSummary } from "./Calendar";
import { eventTypeColor, formatEventTime } from "../lib/eventTime";

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
      <div className="mt-3 text-2xl font-bold tabular-nums text-white">
        {value}
      </div>
      <div className="mt-0.5 text-xs text-fg-muted">{label}</div>
    </Card>
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
      <Page width="wide" className="space-y-8">
        {/* Welcome header banner */}
        <div className="relative overflow-hidden rounded-3xl border border-line bg-gradient-to-r from-vault-950 via-ink-900 to-ink-950 p-6 md:p-8">
          <div className="absolute -right-16 -top-16 size-48 rounded-full bg-vault-500/10 blur-3xl" />
          <div className="relative z-10 space-y-1">
            <p className="text-xs font-semibold tracking-wider text-vault-400 uppercase">Family Command Center</p>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">Welcome back, {firstName} 👋</h2>
            <p className="text-sm text-fg-muted max-w-md">Manage your family secrets, calendars, documents, and coordinates securely in one unified hub.</p>
          </div>
        </div>

        {/* Responsive Grid layout for desktop vs mobile */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main left column: stats & expiries */}
          <div className="space-y-6 lg:col-span-2">
            {/* Stats section */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
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

            {/* Expiries section */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold tracking-wide text-fg-muted uppercase">
                Upcoming expiries
              </h3>
              <EmptyState
                icon={CalendarClock}
                title="Nothing expiring soon"
                description="Documents nearing their expiry date will show up here so you can renew in time."
              />
            </section>
          </div>

          {/* Right column: events & quick access */}
          <div className="space-y-6">
            <UpcomingEventsWidget />

            <section className="space-y-3">
              <h3 className="text-sm font-semibold tracking-wide text-fg-muted uppercase">Quick access</h3>
              <div className="grid grid-cols-2 gap-3">
                <Link
                  to="/tasks"
                  className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 transition-all hover:bg-white/5 active:scale-95"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-info/15 text-info">
                    <ListTodo className="size-5" />
                  </span>
                  <span className="text-sm font-semibold text-fg">Tasks</span>
                </Link>
                <Link
                  to="/contacts"
                  className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 transition-all hover:bg-white/5 active:scale-95"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-danger/15 text-danger">
                    <Contact className="size-5" />
                  </span>
                  <span className="text-sm font-semibold text-fg">Contacts</span>
                </Link>
              </div>
            </section>
          </div>
        </div>
      </Page>
    </>
  );
}
