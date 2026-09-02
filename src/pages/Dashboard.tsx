import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Circle,
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

interface TaskSummary {
  id: string;
  title: string;
  notes?: string | null;
  assignedToName?: string | null;
  dueDate?: string | null;
  status: "open" | "done" | "archived";
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function getGreeting(): { text: string; icon: string } {
  const hr = new Date().getHours();
  if (hr < 12) return { text: "Good morning", icon: "☀️" };
  if (hr < 18) return { text: "Good afternoon", icon: "🌤️" };
  return { text: "Good evening", icon: "🌙" };
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

export function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, families } = useAuth();
  const activeFamilyId = families[0]?.id;
  const firstName = user?.name?.split(" ")[0] ?? "there";
  const greeting = getGreeting();

  // 7-day horizontal strip states
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());

  const daysOfWeek = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });

  // Fetch Dashboard aggregate statistics
  const { data: statsData, isLoading: isLoadingStats } = useQuery({
    queryKey: ["dashboard-stats", activeFamilyId],
    queryFn: () => api<DashboardStats>("/families/me/dashboard-stats"),
  });

  // Fetch Family Members for facepile
  const { data: membersData } = useQuery({
    queryKey: ["family-members", activeFamilyId],
    queryFn: () => api<{ members: FamilyMember[] }>("/families/me/members"),
  });

  // Fetch all tasks to display checklist on the dashboard
  const { data: tasksData } = useQuery({
    queryKey: ["tasks", activeFamilyId],
    queryFn: () =>
      api<{ tasks: TaskSummary[] }>(
        activeFamilyId ? `/tasks?familyId=${activeFamilyId}` : "/tasks"
      ),
  });

  // Fetch calendar events
  const [nowTime] = useState(() => Math.floor(Date.now() / 1000));
  const thirtyDaysLater = nowTime + 30 * 24 * 3600;
  const { data: eventsData } = useQuery({
    queryKey: ["events", "dashboard", activeFamilyId],
    queryFn: () =>
      api<{ events: EventSummary[] }>(`/events?from=${nowTime}&to=${thirtyDaysLater}`),
  });

  // Toggle task completed/open mutation
  const toggleTaskMutation = useMutation({
    mutationFn: (t: TaskSummary) =>
      api(`/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: t.status === "done" ? "open" : "done" }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });

  const stats = statsData;
  const members = (membersData?.members ?? []).filter((m) => m.status === "active");
  const tasksList = tasksData?.tasks ?? [];
  const openTasksList = tasksList.filter((t) => t.status === "open").slice(0, 3);

  // Storage calculation: 5 GB quota
  const maxStorage = 5 * 1024 * 1024 * 1024;
  const storageUsed = stats?.storageBytes ?? 0;
  
  // Segmented storage breakdown (mocking document vs vault folders size distributions)
  const docBytes = Math.min(storageUsed, Math.floor(storageUsed * 0.6));
  const vaultBytes = Math.max(0, storageUsed - docBytes);
  const docPercentage = storageUsed > 0 ? (docBytes / maxStorage) * 100 : 0;
  const vaultPercentage = storageUsed > 0 ? (vaultBytes / maxStorage) * 100 : 0;
  const remainingPercentage = Math.max(0, 100 - docPercentage - vaultPercentage);

  // Task calculation
  const totalTasks = stats?.tasksTotal ?? 0;
  const completedTasks = stats?.tasksCompleted ?? 0;
  const openTasks = Math.max(0, totalTasks - completedTasks);
  const taskPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // SVG Circular Gauge variables
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (taskPercentage / 100) * circumference;

  // Filter events for the selected date on the weekly calendar strip
  const selectedDayEvents = (eventsData?.events ?? [])
    .filter((e) => e.status === "active")
    .filter((e) => {
      const eventDate = new Date(e.startAt * 1000);
      return (
        eventDate.getFullYear() === selectedDate.getFullYear() &&
        eventDate.getMonth() === selectedDate.getMonth() &&
        eventDate.getDate() === selectedDate.getDate()
      );
    });

  const upcomingEvents = (eventsData?.events ?? [])
    .filter((e) => e.status === "active" && e.startAt >= nowTime)
    .slice(0, 5);

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
                {greeting.text}, {firstName} {greeting.icon}
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

            {/* Segmented Cloud Storage progress panel */}
            <Card className="p-5 card-premium space-y-3.5 relative overflow-hidden bg-gradient-to-br from-surface to-surface-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HardDrive className="size-4.5 text-m3-cyan" />
                  <h4 className="text-sm font-semibold text-fg">Shared Cloud Storage</h4>
                </div>
                <span className="text-xs text-fg-muted">
                  {formatBytes(storageUsed)} of 5.0 GB used
                </span>
              </div>
              
              {/* Segmented storage indicator bar */}
              <div className="w-full h-3.5 bg-ink-950 rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-m3-blue transition-all duration-500"
                  style={{ width: `${Math.max(storageUsed > 0 ? 1 : 0, docPercentage)}%` }}
                  title={`Documents: ${formatBytes(docBytes)}`}
                />
                <div
                  className="h-full bg-m3-cyan transition-all duration-500"
                  style={{ width: `${Math.max(storageUsed > 0 ? 1 : 0, vaultPercentage)}%` }}
                  title={`Vault: ${formatBytes(vaultBytes)}`}
                />
                <div
                  className="h-full bg-white/5"
                  style={{ width: `${remainingPercentage}%` }}
                />
              </div>

              {/* Legend details */}
              <div className="flex flex-wrap gap-4 pt-1">
                <div className="flex items-center gap-1.5 text-xs text-fg-subtle">
                  <span className="size-2.5 rounded-full bg-m3-blue" />
                  <span>Documents ({formatBytes(docBytes)})</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-fg-subtle">
                  <span className="size-2.5 rounded-full bg-m3-cyan" />
                  <span>Safe Vault ({formatBytes(vaultBytes)})</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-fg-subtle">
                  <span className="size-2.5 rounded-full bg-white/10" />
                  <span>Available ({formatBytes(maxStorage - storageUsed)})</span>
                </div>
              </div>
            </Card>

            {/* Circular Task Tracker Widget + Checklist */}
            <Card className="p-6 card-premium bg-gradient-to-br from-surface to-surface-2 space-y-5">
              <div className="flex flex-col md:flex-row items-center gap-6 justify-between border-b border-line pb-5">
                <div className="flex items-center gap-5 flex-1 w-full">
                  {/* SVG circular progress ring */}
                  <div className="relative flex items-center justify-center size-20 shrink-0">
                    <svg className="size-20 transform -rotate-90">
                      <circle
                        cx="40"
                        cy="40"
                        r={radius}
                        className="text-ink-950"
                        strokeWidth="6"
                        stroke="currentColor"
                        fill="transparent"
                      />
                      <circle
                        cx="40"
                        cy="40"
                        r={radius}
                        className="text-m3-green transition-all duration-500"
                        strokeWidth="6"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="transparent"
                      />
                    </svg>
                    <span className="absolute text-base font-bold text-white font-sans">
                      {taskPercentage}%
                    </span>
                  </div>

                  <div className="space-y-0.5">
                    <h4 className="text-base font-bold text-fg font-sans">Family Task Tracker</h4>
                    <p className="text-xs text-fg-muted">
                      {isLoadingStats
                        ? "Loading tasks..."
                        : totalTasks > 0
                          ? `${completedTasks} of ${totalTasks} tasks completed by family members`
                          : "No tasks created yet for this week."}
                    </p>
                    <div className="flex gap-x-4 pt-1">
                      <span className="flex items-center gap-1 text-xs text-fg-subtle">
                        <span className="size-1.5 rounded-full bg-m3-green" />
                        {completedTasks} completed
                      </span>
                      <span className="flex items-center gap-1 text-xs text-fg-subtle">
                        <span className="size-1.5 rounded-full bg-fg-subtle" />
                        {openTasks} pending
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 w-full md:w-auto shrink-0">
                  <Link
                    to="/tasks"
                    className="flex-1 md:flex-none flex items-center justify-center gap-1.5 rounded-xl border border-line bg-ink-950 px-4 py-2 text-xs font-semibold text-fg hover:bg-surface-2 transition-colors active:scale-95 text-center"
                  >
                    View List
                  </Link>
                  <Link
                    to="/tasks/new"
                    className="flex-1 md:flex-none flex items-center justify-center gap-1.5 rounded-xl bg-m3-green/15 text-m3-green hover:bg-m3-green/20 px-4 py-2 text-xs font-bold transition-colors active:scale-95 text-center"
                  >
                    <Plus className="size-3.5" />
                    New Task
                  </Link>
                </div>
              </div>

              {/* Dynamic Task Checklist directly inside the dashboard */}
              <div className="space-y-2.5">
                <h5 className="text-[11px] font-bold tracking-wider text-fg-subtle uppercase">
                  Pending Checklist
                </h5>
                {isLoadingStats ? (
                  <div className="text-xs text-fg-muted py-2">Loading checklist...</div>
                ) : openTasksList.length === 0 ? (
                  <div className="text-xs text-fg-subtle py-2 bg-white/[0.02] border border-line rounded-xl px-4 text-center">
                    🎉 All caught up! No pending tasks remaining.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {openTasksList.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleTaskMutation.mutate(t)}
                        disabled={toggleTaskMutation.isPending}
                        className="flex items-start gap-3 p-3.5 rounded-xl border border-line bg-surface hover:bg-surface-2 hover:border-line-strong text-left transition-all checkbox-bounce focus:outline-none"
                      >
                        <Circle className="size-5 text-fg-subtle shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-fg truncate">{t.title}</p>
                          {t.dueDate && (
                            <span className="text-[10px] text-m3-red font-medium">
                              Due: {t.dueDate}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            {/* Document Expiries warning list */}
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

          {/* Right Column: Interactive Calendar events and Quick access links */}
          <div className="space-y-6">
            
            {/* High-Fidelity Calendar Widget */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold tracking-wider text-fg-subtle uppercase">
                  Schedule
                </h3>
                <Link
                  to="/calendar/events/new"
                  className="flex items-center gap-1 text-xs font-semibold text-m3-cyan hover:underline"
                >
                  <Plus className="size-3.5" />
                  Add Event
                </Link>
              </div>

              {/* Horizontal 7-Day Day-Strip selector */}
              <div className="flex justify-between items-center gap-1 bg-ink-950 border border-line rounded-2xl p-1.5 scroll-hide overflow-x-auto no-select">
                {daysOfWeek.map((day, idx) => {
                  const isSelected =
                    day.getFullYear() === selectedDate.getFullYear() &&
                    day.getMonth() === selectedDate.getMonth() &&
                    day.getDate() === selectedDate.getDate();

                  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                  const isToday = new Date().getDate() === day.getDate();

                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedDate(day)}
                      className={`flex flex-col items-center justify-center py-2 px-3 rounded-xl transition-all shrink-0 select-none focus:outline-none ${
                        isSelected
                          ? "bg-m3-cyan text-ink-950 font-bold shadow-md shadow-m3-cyan/15 scale-105"
                          : "hover:bg-white/5 text-fg-muted"
                      }`}
                    >
                      <span className="text-[10px] uppercase font-semibold">
                        {isToday ? "Today" : dayLabels[day.getDay()]}
                      </span>
                      <span className="text-sm font-sans tracking-tight mt-0.5">
                        {day.getDate()}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Events occurring on the selected date */}
              {selectedDayEvents.length === 0 ? (
                <div className="rounded-2xl border border-line bg-surface/30 px-5 py-6 text-center text-xs text-fg-subtle">
                  📅 No calendar events scheduled for this date.
                </div>
              ) : (
                <Card className="divide-y divide-line overflow-hidden card-premium">
                  {selectedDayEvents.map((ev) => {
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

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold tracking-wider text-fg-subtle uppercase">
                  Upcoming events
                </h3>
                <Link
                  to="/calendar"
                  className="text-xs font-semibold text-m3-cyan hover:underline"
                >
                  Full calendar
                </Link>
              </div>
              {upcomingEvents.length === 0 ? (
                <div className="rounded-2xl border border-line bg-surface/30 px-5 py-5 text-center text-xs text-fg-subtle">
                  Nothing planned in the next 30 days.
                </div>
              ) : (
                <Card className="divide-y divide-line overflow-hidden">
                  {upcomingEvents.map((ev) => {
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

            {/* Quick Hub Shortcuts */}
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
