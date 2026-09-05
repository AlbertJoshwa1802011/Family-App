import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  CalendarDays,
  Clock,
  Contact,
  FileText,
  ListTodo,
  Plus,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { NotificationBell } from "../components/NotificationBell";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { ListItem } from "../components/ui/ListItem";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import type { EventSummary } from "./Calendar";
import { eventTypeColor, formatEventTime } from "../lib/eventTime";
import { expiryStatus } from "../lib/expiry";

interface DocumentSummary {
  id: string;
  title: string;
  category: string;
  expiryDate?: string | null;
}

interface MemberSummary {
  id: string;
  status: string;
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
  to,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  accent: string;
  to: string;
}) {
  return (
    <Link to={to}>
      <Card className="p-4 transition-colors hover:bg-white/5">
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
    </Link>
  );
}

/** Days until an ISO yyyy-mm-dd date, compared at UTC midnight (see lib/expiry). */
function daysUntil(dateStr: string, nowMs: number): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const today = new Date(nowMs);
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - todayUtc) / 86_400_000);
}

function UpcomingEventsWidget({ familyId }: { familyId: string }) {
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const thirtyDays = now + 30 * 24 * 3600;

  const { data } = useQuery({
    queryKey: ["events", familyId, "upcoming"],
    queryFn: () =>
      api<{ events: EventSummary[] }>(
        `/events?familyId=${familyId}&from=${now}&to=${thirtyDays}`,
      ),
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
  const { user, activeFamily } = useAuth();
  const firstName = user?.name?.split(" ")[0] ?? "there";
  const [nowMs] = useState(() => Date.now());

  const { data: docsData } = useQuery({
    queryKey: ["documents", activeFamily?.id],
    queryFn: () =>
      api<{ documents: DocumentSummary[] }>(
        `/documents?familyId=${activeFamily!.id}`,
      ),
    enabled: Boolean(activeFamily),
  });

  const { data: membersData } = useQuery({
    queryKey: ["family-members", activeFamily?.id],
    queryFn: () =>
      api<{ members: MemberSummary[] }>(
        `/families/${activeFamily!.id}/members`,
      ),
    enabled: Boolean(activeFamily),
  });

  const { data: tasksData } = useQuery({
    queryKey: ["tasks", activeFamily?.id, "todo"],
    queryFn: () =>
      api<{ tasks: { id: string }[] }>(
        `/tasks?familyId=${activeFamily!.id}&view=todo`,
      ),
    enabled: Boolean(activeFamily),
  });

  const docs = docsData?.documents ?? [];
  const expiring = docs
    .filter((d) => d.expiryDate && daysUntil(d.expiryDate, nowMs) <= 30)
    .sort((x, y) => (x.expiryDate! < y.expiryDate! ? -1 : 1));
  const memberCount =
    membersData?.members.filter((m) => m.status === "active").length ?? 0;

  return (
    <>
      <AppBar title={activeFamily?.name ?? "Family Vault"} trailing={<NotificationBell />} />
      <Page className="space-y-6">
        <div>
          <p className="text-sm text-fg-muted">Welcome back,</p>
          <h2 className="text-xl font-semibold text-white">{firstName} 👋</h2>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={FileText}
            label="Documents"
            value={docsData ? String(docs.length) : "—"}
            accent="bg-vault-500/15 text-vault-300"
            to="/documents"
          />
          <StatCard
            icon={Clock}
            label="Expiring soon"
            value={docsData ? String(expiring.length) : "—"}
            accent="bg-warning/15 text-warning"
            to="/documents"
          />
          <StatCard
            icon={Users}
            label="Family members"
            value={membersData ? String(memberCount) : "—"}
            accent="bg-info/15 text-info"
            to="/family"
          />
          <StatCard
            icon={ListTodo}
            label="Open tasks"
            value={tasksData ? String(tasksData.tasks.length) : "—"}
            accent="bg-success/15 text-success"
            to="/tasks"
          />
        </div>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-fg-muted">
            Upcoming expiries
          </h3>
          {expiring.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Nothing expiring soon"
              description="Documents nearing their expiry date will show up here so you can renew in time."
            />
          ) : (
            <Card className="divide-y divide-line overflow-hidden">
              {expiring.slice(0, 5).map((doc) => {
                const status = expiryStatus(doc.expiryDate);
                return (
                  <ListItem
                    key={doc.id}
                    to={`/documents/${doc.id}`}
                    leading={
                      <span className="flex size-9 items-center justify-center rounded-xl bg-warning/15 text-warning">
                        <Clock className="size-5" />
                      </span>
                    }
                    title={doc.title}
                    subtitle={doc.category}
                    trailing={
                      status ? <Badge tone={status.tone}>{status.label}</Badge> : null
                    }
                  />
                );
              })}
            </Card>
          )}
        </section>

        {activeFamily && <UpcomingEventsWidget familyId={activeFamily.id} />}

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-fg-muted">Quick access</h3>
          <div className="grid grid-cols-2 gap-3">
            <Link
              to="/calendar"
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 transition-colors hover:bg-white/5"
            >
              <span className="flex size-9 items-center justify-center rounded-xl bg-vault-500/15 text-vault-300">
                <CalendarDays className="size-5" />
              </span>
              <span className="text-sm font-medium text-fg">Calendar</span>
            </Link>
            <Link
              to="/tasks"
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 transition-colors hover:bg-white/5"
            >
              <span className="flex size-9 items-center justify-center rounded-xl bg-info/15 text-info">
                <ListTodo className="size-5" />
              </span>
              <span className="text-sm font-medium text-fg">Tasks</span>
            </Link>
            <Link
              to="/contacts"
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 transition-colors hover:bg-white/5"
            >
              <span className="flex size-9 items-center justify-center rounded-xl bg-danger/15 text-danger">
                <Contact className="size-5" />
              </span>
              <span className="text-sm font-medium text-fg">Contacts</span>
            </Link>
          </div>
        </section>
      </Page>
    </>
  );
}
