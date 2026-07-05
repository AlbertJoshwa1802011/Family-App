import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  CalendarDays,
  Clock,
  Contact,
  FileText,
  HardDrive,
  ListTodo,
  Plus,
  Users,
  ChevronRight,
  PlusCircle,
  Lock,
  CircleAlert,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { NotificationBell } from "../components/NotificationBell";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ListItem } from "../components/ui/ListItem";
import { Avatar } from "../components/ui/Avatar";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import type { EventSummary } from "./Calendar";
import { eventTypeColor, formatEventTime } from "../lib/eventTime";

interface FamilyMember {
  id: string;
  userId: string | null;
  memberType: string;
  displayName: string | null;
  role: string;
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function StatCard({
  icon: Icon,
  label,
  value,
  accentClass,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  accentClass: string;
  onClick?: () => void;
}) {
  const content = (
    <Card className="p-5 card-premium flex flex-col h-full cursor-pointer hover:bg-surface-2 transition-all">
      <div className="flex justify-between items-start">
        <div className={`flex size-11 items-center justify-center rounded-2xl ${accentClass}`}>
          <Icon className="size-5.5" />
        </div>
        <ChevronRight className="size-4.5 text-fg-subtle opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className="mt-4 text-3xl font-bold tracking-tight text-white font-sans tabular-nums">
        {value}
      </div>
      <div className="mt-1 text-sm font-medium text-fg-muted">{label}</div>
    </Card>
  );

  return onClick ? (
    <button type="button" onClick={onClick} className="text-left w-full h-full block group focus:outline-none">
      {content}
    </button>
  ) : (
    <div className="h-full">{content}</div>
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
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold tracking-wider text-fg-subtle uppercase">
          Upcoming Schedule
        </h3>
        <Link
          to="/calendar/events/new"
          className="flex items-center gap-1 text-xs font-semibold text-m3-cyan hover:underline"
        >
          <Plus className="size-3.5" />
          Add Event
        </Link>
      </div>
      {upcoming.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface/30 px-5 py-4 text-sm text-fg-subtle">
          No calendar events scheduled.{" "}
          <Link to="/calendar" className="text-m3-cyan hover:underline">
            View calendar
          </Link>
        </div>
      ) : (
        <Card className="divide-y divide-line overflow-hidden card-premium">
          {upcoming.map((ev) => {
            const colors = eventTypeColor(ev.type);
            return (
              <ListItem
                key={ev.id}
                to={`/calendar/events/${ev.id}`}
                leading={
                  <span
                    className={`flex size-10 items-center justify-center rounded-xl ${colors.bg} ${colors.text}`}
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
  const navigate = useNavigate();
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0] ?? "there";

  // Fetch Dashboard aggregate statistics
  const { data: statsData, isLoading: isLoadingStats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => api<DashboardStats>("/families/me/dashboard-stats"),
  });

  // Fetch Family Members for facepile
  const { data: membersData } = useQuery({
    queryKey: ["family-members"],
    queryFn: () => api<{ members: FamilyMember[] }>("/families/me/members"),
  });

  const stats = statsData;
  const members = (membersData?.members ?? []).filter((m) => m.status === "active");

  // Storage calculation: 5 GB quota
  const maxStorage = 5 * 1024 * 1024 * 1024;
  const storageUsed = stats?.storageBytes ?? 0;
  const storagePercentage = Math.max(1, Math.min(100, (storageUsed / maxStorage) * 100));

  // Task calculation
  const totalTasks = stats?.tasksTotal ?? 0;
  const completedTasks = stats?.tasksCompleted ?? 0;
  const openTasks = Math.max(0, totalTasks - completedTasks);
  const taskPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // SVG Circular Gauge variables
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (taskPercentage / 100) * circumference;

  return (
    <>
      <AppBar title="Family Vault" trailing={<NotificationBell />} />
      <Page width="wide" className="space-y-8 pb-12">
        {/* Google-style Dynamic Welcome Banner */}
        <div className="relative overflow-hidden rounded-[32px] border border-line bg-gradient-to-br from-ink-900 via-ink-950 to-ink-900 p-6 md:p-8">
          {/* Dynamic background color blobs */}
          <div className="absolute -right-24 -top-24 size-72 rounded-full bg-m3-cyan/10 blur-[80px] pointer-events-none" />
          <div className="absolute -left-16 -bottom-16 size-60 rounded-full bg-m3-purple/10 blur-[70px] pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold tracking-widest text-m3-cyan uppercase">
                Family Hub
              </p>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white font-sans">
                Welcome back, {firstName} 👋
              </h2>
              <p className="text-sm text-fg-muted max-w-md">
                Securely managing your family vault, documents, calendar schedules, and tasks.
              </p>
            </div>

            {/* Member facepile circle */}
            <div className="flex items-center gap-3.5 bg-white/5 border border-white/[0.06] rounded-2xl p-3 px-4 backdrop-blur-md">
              <div className="flex -space-x-2.5 overflow-hidden">
                {members.slice(0, 4).map((member) => (
                  <Avatar
                    key={member.id}
                    name={member.name}
                    email={member.email}
                    src={member.picture}
                    className="size-8.5 ring-2 ring-ink-950 object-cover"
                  />
                ))}
                {members.length > 4 && (
                  <span className="flex size-8.5 items-center justify-center rounded-full bg-ink-800 text-xs font-bold text-white ring-2 ring-ink-950">
                    +{members.length - 4}
                  </span>
                )}
              </div>
              <div className="h-6 w-px bg-white/10" />
              <button
                type="button"
                onClick={() => navigate("/family")}
                className="flex items-center gap-1.5 text-xs font-semibold text-m3-cyan hover:underline transition-colors focus:outline-none"
              >
                <PlusCircle className="size-4" />
                Manage
              </button>
            </div>
          </div>
        </div>

        {/* Responsive Grid layout */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main Left Columns: Stats and Tasks */}
          <div className="space-y-6 lg:col-span-2">
            {/* Real Stats Grid */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard
                icon={FileText}
                label="Documents"
                value={isLoadingStats ? "—" : stats?.documentCount ?? 0}
                accentClass="bg-m3-blue-bg text-m3-blue"
                onClick={() => navigate("/documents")}
              />
              <StatCard
                icon={Clock}
                label="Expiring soon"
                value={
                  isLoadingStats ? (
                    "—"
                  ) : (stats?.expiringCount ?? 0) > 0 ? (
                    <span className="text-m3-red flex items-center gap-1.5">
                      <CircleAlert className="size-5.5 animate-pulse inline" />
                      {stats?.expiringCount}
                    </span>
                  ) : (
                    "0"
                  )
                }
                accentClass={
                  (stats?.expiringCount ?? 0) > 0
                    ? "bg-m3-red-bg text-m3-red"
                    : "bg-surface-2 text-fg-subtle"
                }
                onClick={() => navigate("/documents")}
              />
              <StatCard
                icon={Users}
                label="Family members"
                value={isLoadingStats ? "—" : stats?.memberCount ?? 0}
                accentClass="bg-m3-purple-bg text-m3-purple"
                onClick={() => navigate("/family")}
              />
              <StatCard
                icon={HardDrive}
                label="Storage used"
                value={isLoadingStats ? "—" : formatBytes(storageUsed)}
                accentClass="bg-m3-cyan-bg text-m3-cyan"
                onClick={() => navigate("/vault")}
              />
            </div>

            {/* Shared Storage progress panel */}
            <Card className="p-5 card-premium space-y-3 relative overflow-hidden bg-gradient-to-br from-surface to-surface-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HardDrive className="size-4.5 text-m3-cyan" />
                  <h4 className="text-sm font-semibold text-fg">Shared Cloud Storage</h4>
                </div>
                <span className="text-xs text-fg-muted">
                  {formatBytes(storageUsed)} of 5.0 GB used
                </span>
              </div>
              <div className="w-full h-2.5 bg-ink-950 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-m3-cyan to-m3-blue rounded-full transition-all duration-500"
                  style={{ width: `${storagePercentage}%` }}
                />
              </div>
              <p className="text-[11px] text-fg-subtle">
                Google drive linked: active document receipts and media files are stored securely.
              </p>
            </Card>

            {/* Circular Task Tracker Widget */}
            <Card className="p-6 card-premium bg-gradient-to-br from-surface to-surface-2 flex flex-col md:flex-row items-center gap-6 justify-between">
              <div className="flex items-center gap-5 flex-1 w-full">
                {/* SVG circular progress ring */}
                <div className="relative flex items-center justify-center size-24 shrink-0">
                  <svg className="size-24 transform -rotate-90">
                    <circle
                      cx="48"
                      cy="48"
                      r={radius}
                      className="text-ink-950"
                      strokeWidth="8"
                      stroke="currentColor"
                      fill="transparent"
                    />
                    <circle
                      cx="48"
                      cy="48"
                      r={radius}
                      className="text-m3-green transition-all duration-500"
                      strokeWidth="8"
                      strokeDasharray={circumference}
                      strokeDashoffset={strokeDashoffset}
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="transparent"
                    />
                  </svg>
                  <span className="absolute text-lg font-bold text-white font-sans">
                    {taskPercentage}%
                  </span>
                </div>

                <div className="space-y-1">
                  <h4 className="text-base font-bold text-fg font-sans">Family Task Tracker</h4>
                  <p className="text-xs text-fg-muted">
                    {isLoadingStats
                      ? "Loading tasks..."
                      : totalTasks > 0
                        ? `${completedTasks} of ${totalTasks} tasks completed by family members`
                        : "No tasks created yet for this week."}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1.5">
                    <span className="flex items-center gap-1 text-xs text-fg-subtle">
                      <span className="size-2 rounded-full bg-m3-green" />
                      {completedTasks} completed
                    </span>
                    <span className="flex items-center gap-1 text-xs text-fg-subtle">
                      <span className="size-2 rounded-full bg-fg-subtle" />
                      {openTasks} pending
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-2.5 w-full md:w-auto">
                <Link
                  to="/tasks"
                  className="flex-1 md:flex-none flex items-center justify-center gap-1.5 rounded-xl border border-line bg-ink-950 px-4 py-2.5 text-xs font-semibold text-fg hover:bg-surface-2 transition-colors active:scale-95 text-center"
                >
                  <ListTodo className="size-3.5 text-m3-green" />
                  View List
                </Link>
                <Link
                  to="/tasks/new"
                  className="flex-1 md:flex-none flex items-center justify-center gap-1.5 rounded-xl bg-m3-green/15 text-m3-green hover:bg-m3-green/20 px-4 py-2.5 text-xs font-bold transition-colors active:scale-95 text-center"
                >
                  <Plus className="size-3.5" />
                  Add Task
                </Link>
              </div>
            </Card>

            {/* Upcoming Expiries warning list */}
            <section className="space-y-4">
              <h3 className="text-xs font-bold tracking-wider text-fg-subtle uppercase">
                Document Expiry Alerts
              </h3>
              <EmptyState
                icon={CalendarClock}
                title="All documents secure"
                description="Any active passports, licenses, or cards nearing expiry in the next 30 days will show here."
              />
            </section>
          </div>

          {/* Right Column: Calendar events and Quick access links */}
          <div className="space-y-6">
            <UpcomingEventsWidget />

            <section className="space-y-4">
              <h3 className="text-xs font-bold tracking-wider text-fg-subtle uppercase">
                Quick Hub Shortcuts
              </h3>
              <div className="grid grid-cols-2 gap-3.5">
                <Link
                  to="/tasks"
                  className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition-all hover:bg-surface-2 hover:border-line-strong active:scale-95 card-premium group"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-m3-green-bg text-m3-green transition-transform group-hover:scale-110">
                    <ListTodo className="size-5" />
                  </span>
                  <span className="text-xs font-bold text-fg">Tasks</span>
                </Link>

                <Link
                  to="/contacts"
                  className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition-all hover:bg-surface-2 hover:border-line-strong active:scale-95 card-premium group"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-m3-red-bg text-m3-red transition-transform group-hover:scale-110">
                    <Contact className="size-5" />
                  </span>
                  <span className="text-xs font-bold text-fg">Contacts</span>
                </Link>

                <Link
                  to="/vault"
                  className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition-all hover:bg-surface-2 hover:border-line-strong active:scale-95 card-premium group"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-m3-cyan-bg text-m3-cyan transition-transform group-hover:scale-110">
                    <Lock className="size-5" />
                  </span>
                  <span className="text-xs font-bold text-fg">Safe Vault</span>
                </Link>

                <Link
                  to="/documents"
                  className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition-all hover:bg-surface-2 hover:border-line-strong active:scale-95 card-premium group"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-m3-blue-bg text-m3-blue transition-transform group-hover:scale-110">
                    <FileText className="size-5" />
                  </span>
                  <span className="text-xs font-bold text-fg">Documents</span>
                </Link>
              </div>
            </section>
          </div>
        </div>
      </Page>
    </>
  );
}
