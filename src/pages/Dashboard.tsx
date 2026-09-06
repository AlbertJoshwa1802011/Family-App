import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  CalendarDays,
  ChevronRight,
  Clock,
  Contact,
  FileText,
  ListTodo,
  Plus,
  Sparkles,
  Users,
  Wallet,
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
import { ListItem, ListIcon } from "../components/ui/ListItem";
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

type Tone = "vault" | "warning" | "info" | "success" | "danger";

const toneVar: Record<Tone, string> = {
  vault: "var(--color-vault-400)",
  warning: "var(--color-warning)",
  info: "var(--color-info)",
  success: "var(--color-success)",
  danger: "var(--color-danger)",
};

const toneText: Record<Tone, string> = {
  vault: "text-vault-300",
  warning: "text-warning",
  info: "text-info",
  success: "text-success",
  danger: "text-danger",
};

/** Section heading shared by every block on the dashboard. */
function SectionTitle({
  children,
  action,
}: {
  children: string;
  action?: { to: string; label: string; icon?: LucideIcon };
}) {
  const Icon = action?.icon;
  return (
    <div className="flex items-center justify-between px-1">
      <h3 className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase">
        {children}
      </h3>
      {action && (
        <Link
          to={action.to}
          className="lq lq-flat lq-press flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-vault-300"
        >
          {Icon && <Icon className="size-3.5" aria-hidden="true" />}
          {action.label}
        </Link>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
  to,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: Tone;
  to: string;
}) {
  return (
    <Link to={to} className="block">
      <Card
        interactive
        tint={toneVar[tone]}
        className="relative overflow-hidden p-4"
      >
        {/* the colour that the glass above it refracts */}
        <span
          aria-hidden="true"
          className="absolute -top-9 -right-7 size-24 rounded-full opacity-25 blur-2xl"
          style={{ background: toneVar[tone] }}
        />
        <div
          className={`lq lq-flat lq-tint relative flex size-10 items-center justify-center rounded-full ${toneText[tone]}`}
          style={{ ["--lq-tint" as string]: toneVar[tone] }}
        >
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="relative mt-3 text-[28px] leading-none font-bold tabular-nums text-white">
          {value}
        </div>
        <div className="relative mt-1.5 text-xs font-medium text-fg-muted">
          {label}
        </div>
      </Card>
    </Link>
  );
}

/** Circular quick-access bubble with the label beneath it. */
function QuickBubble({
  icon: Icon,
  label,
  to,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  to: string;
  tone: Tone;
}) {
  return (
    <Link
      to={to}
      className="group flex w-15 shrink-0 flex-col items-center gap-2 text-center"
    >
      <span className="relative flex size-14 items-center justify-center">
        <span
          aria-hidden="true"
          className="absolute inset-1 rounded-full opacity-35 blur-lg transition-opacity duration-300 group-active:opacity-60"
          style={{ background: toneVar[tone] }}
        />
        <span
          className={`lq lq-tint lq-raised lq-press relative flex size-14 items-center justify-center rounded-full ${toneText[tone]}`}
          style={{ ["--lq-tint" as string]: toneVar[tone] }}
        >
          <Icon className="size-6" strokeWidth={1.9} aria-hidden="true" />
        </span>
      </span>
      <span className="text-[10px] font-semibold text-fg-muted">{label}</span>
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
      <SectionTitle action={{ to: "/calendar/events/new", label: "Add", icon: Plus }}>
        Upcoming events
      </SectionTitle>
      {upcoming.length === 0 ? (
        <Card className="px-4 py-3.5 text-sm text-fg-subtle">
          No events in the next 30 days.{" "}
          <Link to="/calendar" className="font-semibold text-vault-300">
            View calendar
          </Link>
        </Card>
      ) : (
        <Card className="divide-y divide-white/8 overflow-hidden">
          {upcoming.map((ev) => {
            const colors = eventTypeColor(ev.type);
            return (
              <ListItem
                key={ev.id}
                to={`/calendar/events/${ev.id}`}
                leading={
                  <span
                    className={`lq lq-flat lq-tint flex size-10 shrink-0 items-center justify-center rounded-full ${colors.text}`}
                    style={{ ["--lq-tint" as string]: colors.tint }}
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
      <AppBar
        title={activeFamily?.name ?? "Family Vault"}
        trailing={<NotificationBell />}
      />
      <Page className="space-y-7">
        <div className="bubble-in px-1 pt-1">
          <p className="text-sm font-medium text-fg-muted">Welcome back,</p>
          <h2 className="mt-0.5 text-[28px] leading-tight font-bold tracking-tight text-white">
            {firstName} 👋
          </h2>
        </div>

        {/* Assistant CTA — the brightest bubble on the page, with a slow
            specular sweep so it reads as lit glass rather than a flat tile. */}
        <Link to="/assistant" className="block">
          <Card
            interactive
            variant="raised"
            tint="var(--color-vault-400)"
            className="bubble-in relative flex items-center gap-3.5 overflow-hidden p-4"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-linear-to-r from-transparent via-white/12 to-transparent [animation:lq-sweep_5.5s_var(--ease-out)_infinite]"
            />
            <span className="lq lq-tint lq-raised relative flex size-11 shrink-0 items-center justify-center rounded-full text-vault-200 [--lq-tint:var(--color-vault-300)]">
              <Sparkles className="size-5.5" aria-hidden="true" />
            </span>
            <span className="relative min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-white">
                Ask the assistant
              </span>
              <span className="mt-0.5 block truncate text-xs text-fg-muted">
                “Add 100 for snacks” · stats · reminders
              </span>
            </span>
            <ChevronRight
              className="relative size-5 shrink-0 text-vault-300"
              aria-hidden="true"
            />
          </Card>
        </Link>

        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={FileText}
            label="Documents"
            value={docsData ? String(docs.length) : "—"}
            tone="vault"
            to="/documents"
          />
          <StatCard
            icon={Clock}
            label="Expiring soon"
            value={docsData ? String(expiring.length) : "—"}
            tone="warning"
            to="/documents"
          />
          <StatCard
            icon={Users}
            label="Family members"
            value={membersData ? String(memberCount) : "—"}
            tone="info"
            to="/family"
          />
          <StatCard
            icon={ListTodo}
            label="Open tasks"
            value={tasksData ? String(tasksData.tasks.length) : "—"}
            tone="success"
            to="/tasks"
          />
        </div>

        <section className="space-y-3">
          <SectionTitle>Quick access</SectionTitle>
          {/* Bubbles in a scrollable row — edge-bleeding so it's obviously
              swipeable on a phone. */}
          <div className="-mx-4 flex justify-between gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <QuickBubble icon={CalendarDays} label="Calendar" to="/calendar" tone="vault" />
            <QuickBubble icon={ListTodo} label="Tasks" to="/tasks" tone="info" />
            <QuickBubble icon={Contact} label="Contacts" to="/contacts" tone="danger" />
            <QuickBubble icon={Wallet} label="Expenses" to="/expenses" tone="warning" />
            <QuickBubble icon={Sparkles} label="Assistant" to="/assistant" tone="success" />
          </div>
        </section>

        <section className="space-y-3">
          <SectionTitle action={{ to: "/documents", label: "All" }}>
            Upcoming expiries
          </SectionTitle>
          {expiring.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Nothing expiring soon"
              description="Documents nearing their expiry date will show up here so you can renew in time."
            />
          ) : (
            <Card className="divide-y divide-white/8 overflow-hidden">
              {expiring.slice(0, 5).map((doc) => {
                const status = expiryStatus(doc.expiryDate);
                return (
                  <ListItem
                    key={doc.id}
                    to={`/documents/${doc.id}`}
                    leading={
                      <ListIcon tone="warning">
                        <Clock className="size-5" />
                      </ListIcon>
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
      </Page>
    </>
  );
}
