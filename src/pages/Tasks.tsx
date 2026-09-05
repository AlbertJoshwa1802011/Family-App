import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Circle,
  ListTodo,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  Bell,
  Link2,
  Calendar,
  Clock,
  User,
  Sparkles,
  ListChecks,
} from "lucide-react";
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { Button } from "../components/ui/Button";
import { Fab } from "../components/ui/Fab";
import { LiquidPillTabs } from "../components/ui/LiquidPillTabs";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  applyTaskView,
  attachChildCounts,
  buildForest,
  dueStatus,
  formatTaskPath,
  ancestorPath,
  isTreeView,
  type TaskRecord,
  type TaskView,
} from "../lib/taskTree";

/* ── Types ───────────────────────────────────────────────────────────────────── */

interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

interface TaskSummary {
  id: string;
  title: string;
  notes?: string | null;
  assignedToMemberId?: string | null;
  assignedToName?: string | null;
  dueDate?: string | null;
  status: "open" | "done" | "archived";
  priority?: "low" | "medium" | "high";
  parentTaskId?: string | null;
  referredTaskId?: string | null;
  subtasksJson?: string | null;
  subtasks?: Subtask[];
  reminderDate?: string | null;
  remindMemberId?: string | null;
  createdBy?: string | null;
  createdAt?: number;
  completedAt?: number | null;
  childCount?: number;
  doneChildCount?: number;
}

type FilterMode = "todo" | "priority" | "due" | "recent" | "mine" | "completed";

/* ── Helpers ─────────────────────────────────────────────────────────────────── */

function parseSubtasks(json?: string | null): Subtask[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as Subtask[];
  } catch {
    return [];
  }
}

function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const FILTER_LABELS: Record<FilterMode, string> = {
  todo: "To do",
  priority: "Priority",
  due: "Due",
  recent: "Recent",
  mine: "Mine",
  completed: "Done",
};

/* ── Summary Bar ─────────────────────────────────────────────────────────────── */

function TaskSummaryBar({ open, done, total }: { open: number; done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const r = 28;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;

  return (
    <div className="card-premium p-5 mb-5">
      <div className="flex items-center gap-5">
        {/* Progress Ring */}
        <div className="relative shrink-0">
          <svg width="72" height="72" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r={r} fill="none" stroke="var(--color-line-strong)" strokeWidth="5" />
            <circle
              cx="36"
              cy="36"
              r={r}
              fill="none"
              stroke="var(--color-vault-400)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              style={{ transform: "rotate(-90deg)", transformOrigin: "center", transition: "stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)" }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-bold text-fg">{pct}%</span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1 space-y-2">
          <h3 className="text-sm font-semibold text-fg">Task Progress</h3>
          <div className="flex gap-4">
            <div className="flex items-center gap-1.5">
              <div className="size-2.5 rounded-full bg-m3-blue" />
              <span className="text-xs text-fg-muted">{open} open</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="size-2.5 rounded-full bg-vault-400" />
              <span className="text-xs text-fg-muted">{done} done</span>
            </div>
          </div>
          {/* Micro-bar */}
          <div className="h-1.5 rounded-full bg-line overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-vault-500 to-vault-300 transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Search Bar ──────────────────────────────────────────────────────────────── */

function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative mb-4">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-fg-subtle pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search tasks…"
        className="w-full rounded-2xl bg-surface-2 border border-line pl-10 pr-4 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none transition-colors"
      />
    </div>
  );
}

/* ── Filter Chips ────────────────────────────────────────────────────────────── */

function FilterChips({
  active,
  onChange,
}: {
  active: FilterMode;
  onChange: (m: FilterMode) => void;
}) {
  const chips: { id: FilterMode; label: string; icon: typeof ListChecks }[] = [
    { id: "todo", label: "To do", icon: ListChecks },
    { id: "priority", label: "Priority", icon: Sparkles },
    { id: "due", label: "Due", icon: Clock },
    { id: "recent", label: "Recent", icon: Calendar },
    { id: "mine", label: "Mine", icon: User },
    { id: "completed", label: "Done", icon: CheckCircle2 },
  ];

  return (
    <div className="mb-5">
      <LiquidPillTabs
        ariaLabel="Task filters"
        value={active}
        onChange={onChange}
        items={chips}
      />
    </div>
  );
}

/* ── Task Row ────────────────────────────────────────────────────────────────── */

function TaskRow({
  task,
  allTasks,
  onToggle,
  pending,
  onEdit,
  expanded = false,
  hasVisibleChildren = false,
  onToggleExpand,
  path,
  todayIso,
}: {
  task: TaskSummary;
  allTasks: TaskSummary[];
  onToggle: (t: TaskSummary) => void;
  pending: boolean;
  onEdit: (id: string) => void;
  expanded?: boolean;
  hasVisibleChildren?: boolean;
  onToggleExpand?: () => void;
  path?: string;
  todayIso: string;
}) {
  const isDone = task.status === "done";
  const due = dueStatus(task.dueDate, todayIso);
  const subtasks =
    task.subtasks && Array.isArray(task.subtasks)
      ? task.subtasks
      : parseSubtasks(task.subtasksJson);
  const subtasksDone = subtasks.filter((s) => s.done).length;
  const hasSubtasks = subtasks.length > 0;
  const referredTask = task.referredTaskId
    ? allTasks.find((t) => t.id === task.referredTaskId)
    : null;
  const hasReminder = Boolean(task.reminderDate);

  return (
    <div
      className="group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.03] cursor-pointer"
      onClick={() => onEdit(task.id)}
    >
      {hasVisibleChildren ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand?.();
          }}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse subtasks" : "Expand subtasks"}
          className="shrink-0 mt-0.5 flex size-7 items-center justify-center rounded-lg text-fg-subtle hover:bg-white/5"
        >
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </button>
      ) : (
        <span className="size-7 shrink-0" aria-hidden="true" />
      )}
      {/* Checkbox */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle(task);
        }}
        disabled={pending}
        aria-label={isDone ? "Mark task open" : "Mark task done"}
        className="shrink-0 mt-0.5 transition-all duration-200 checkbox-bounce disabled:opacity-50"
      >
        {isDone ? (
          <CheckCircle2 className="size-[22px] text-vault-400" />
        ) : (
          <Circle className="size-[22px] text-fg-subtle group-hover:text-vault-300 transition-colors" />
        )}
      </button>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div
          className={`text-sm font-medium leading-snug transition-colors ${
            isDone ? "text-fg-subtle line-through" : "text-fg"
          }`}
        >
          {task.title}
        </div>

        {/* Meta row */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* Due date chip */}
          {due && !isDone && (
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                due.tone === "danger"
                  ? "bg-m3-red-bg text-m3-red"
                  : due.tone === "warning"
                    ? "bg-m3-yellow-bg text-m3-yellow"
                    : "bg-surface-2 text-fg-muted"
              }`}
            >
              <Calendar className="size-3" />
              {due.label}
            </span>
          )}

          {/* Assignee chip */}
          {task.assignedToName && (
            <span className="inline-flex items-center gap-1 text-[11px] text-fg-muted">
              <User className="size-3" />
              {task.assignedToName}
            </span>
          )}

          {path && (
            <span className="inline-flex items-center gap-1 text-[11px] text-fg-subtle truncate max-w-[180px]">
              {path}
            </span>
          )}
          {referredTask && (
            <span className="inline-flex items-center gap-1 text-[11px] text-m3-purple">
              <Link2 className="size-3" />
              <span className="truncate max-w-[120px]">{referredTask.title}</span>
            </span>
          )}

          {/* Reminder indicator */}
          {hasReminder && (
            <span className="inline-flex items-center gap-1 text-[11px] text-m3-cyan">
              <Bell className="size-3" />
              {formatDate(task.reminderDate!)}
            </span>
          )}
        </div>

        {/* Nested-task progress */}
        {(task.childCount ?? 0) > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] font-medium text-vault-300">
              {task.doneChildCount ?? 0}/{task.childCount} nested
            </span>
          </div>
        )}

        {/* JSON checklist progress */}
        {hasSubtasks && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-line overflow-hidden max-w-[140px]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-m3-blue to-m3-purple transition-all duration-500"
                style={{ width: `${subtasks.length > 0 ? (subtasksDone / subtasks.length) * 100 : 0}%` }}
              />
            </div>
            <span className="text-[11px] text-fg-muted font-medium">
              {subtasksDone}/{subtasks.length}
            </span>
          </div>
        )}
      </div>

      {/* Priority/Due badge for desktop */}
      {!isDone && due && (due.tone === "danger" || due.tone === "warning") && (
        <div className="hidden sm:block shrink-0 mt-0.5">
          <Badge tone={due.tone}>{due.label}</Badge>
        </div>
      )}

      <ChevronRight className="shrink-0 size-4 text-fg-subtle mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}

/* ── Skeleton Loader ─────────────────────────────────────────────────────────── */

function TaskSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <Skeleton className="size-[22px] rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
      </div>
    </div>
  );
}

/* ── Empty State ─────────────────────────────────────────────────────────────── */

function TasksEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="flex items-center justify-center size-20 rounded-3xl bg-vault-500/10 mb-5">
        <Sparkles className="size-9 text-vault-400" />
      </div>
      <h3 className="text-lg font-semibold text-fg mb-2">All clear!</h3>
      <p className="text-sm text-fg-muted max-w-xs mb-6">
        Stay on top of family to-dos — renew passports, schedule appointments, or manage shared shopping lists.
      </p>
      <Button
        leadingIcon={<Plus className="size-4" />}
        onClick={onAdd}
        variant="primary"
      >
        Create your first task
      </Button>
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────────────── */

export function Tasks() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { families, user, activeFamilyId } = useAuth();
  const familyId = activeFamilyId ?? families[0]?.id;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("todo");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const [todayIso] = useState(() => {
    const n = new Date();
    return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}-${String(n.getUTCDate()).padStart(2, "0")}`;
  });

  const { data, isLoading } = useQuery({
    queryKey: ["tasks", familyId],
    queryFn: () =>
      api<{ tasks: TaskSummary[] }>(
        familyId ? `/tasks?familyId=${familyId}` : "/tasks",
      ),
  });

  const { data: membersData } = useQuery({
    queryKey: ["family-members", familyId],
    queryFn: () => api<{ members: { id: string; userId: string | null }[] }>(
      familyId ? `/families/${familyId}/members` : "/families/me/members",
    ),
    enabled: Boolean(familyId),
  });
  const myMemberId =
    membersData?.members.find((m) => m.userId === user?.id)?.id ?? null;

  const toggle = useMutation({
    mutationFn: (t: TaskSummary) =>
      api(`/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: t.status === "done" ? "open" : "done" }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const allTasks = useMemo(() => data?.tasks ?? [], [data]);

  const records: TaskRecord[] = useMemo(
    () =>
      attachChildCounts(
        allTasks.map((t) => ({
          id: t.id,
          title: t.title,
          notes: t.notes,
          assignedToMemberId: t.assignedToMemberId,
          assignedToName: t.assignedToName,
          dueDate: t.dueDate,
          status: t.status,
          priority: t.priority ?? "medium",
          parentTaskId: t.parentTaskId ?? null,
          createdAt: t.createdAt ?? 0,
          updatedAt: t.createdAt ?? 0,
          completedAt: t.completedAt ?? null,
          childCount: t.childCount ?? 0,
          doneChildCount: t.doneChildCount ?? 0,
        })),
      ),
    [allTasks],
  );

  const viewed = useMemo(() => {
    const base = applyTaskView(records, {
      view: filter as TaskView,
      myMemberId,
      nowSecs: now,
      todayIso,
    });
    if (!search.trim()) return base;
    const q = search.toLowerCase();
    return base.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.notes ?? "").toLowerCase().includes(q),
    );
  }, [records, filter, myMemberId, now, todayIso, search]);

  const byId = useMemo(
    () => new Map(allTasks.map((t) => [t.id, t])),
    [allTasks],
  );
  const forest = useMemo(() => buildForest(viewed), [viewed]);
  const tree = isTreeView(filter as TaskView);

  const totalAll = allTasks.length;
  const doneAll = allTasks.filter((t) => t.status === "done").length;
  const openAll = allTasks.filter((t) => t.status === "open").length;

  const rows = useMemo(() => {
    if (!tree) {
      return viewed.map((v) => byId.get(v.id)).filter(Boolean) as TaskSummary[];
    }
    const list: TaskSummary[] = [];
    const walk = (nodes: typeof forest) => {
      for (const n of nodes) {
        const raw = byId.get(n.id);
        if (raw) {
          list.push({
            ...raw,
            childCount: n.childCount,
            doneChildCount: n.doneChildCount,
            parentTaskId: n.parentTaskId,
          });
        }
        if (!collapsed.has(n.id) && n.children.length) walk(n.children);
      }
    };
    walk(forest);
    return list;
  }, [tree, viewed, byId, forest, collapsed]);

  return (
    <>
      <AppBar title="Tasks" back />
      <Page className="pb-24">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 rounded-3xl" />
            <Skeleton className="h-10 rounded-2xl" />
            <div className="card-premium divide-y divide-line overflow-hidden">
              {Array.from({ length: 4 }).map((_, i) => (
                <TaskSkeleton key={i} />
              ))}
            </div>
          </div>
        ) : allTasks.filter((t) => t.status !== "archived").length === 0 ? (
          <TasksEmptyState onAdd={() => navigate("/tasks/new")} />
        ) : (
          <>
            <TaskSummaryBar open={openAll} done={doneAll} total={totalAll} />
            <SearchBar value={search} onChange={setSearch} />
            <FilterChips active={filter} onChange={setFilter} />

            <section className="space-y-2 mb-5">
              <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase flex items-center gap-1.5">
                <ListTodo className="size-3.5" />
                {FILTER_LABELS[filter]} ({viewed.length})
              </h3>
              {rows.length === 0 ? (
                <div className="card-premium px-5 py-4 text-center">
                  <p className="text-sm text-fg-muted">
                    {filter === "todo"
                      ? "All tasks completed! 🎉"
                      : "No tasks match this filter."}
                  </p>
                </div>
              ) : (
                <div className="card-premium divide-y divide-line overflow-hidden">
                  {rows.map((t) => {
                    const depth = tree ? ancestorPath(viewed, t.id).length : 0;
                    const hasKids = viewed.some((v) => v.parentTaskId === t.id);
                    return (
                      <div
                        key={t.id}
                        className={depth > 0 ? "border-l border-vault-500/25" : undefined}
                        style={{ paddingLeft: Math.min(depth, 6) * 14 }}
                      >
                        <TaskRow
                          task={t}
                          allTasks={allTasks}
                          onToggle={toggle.mutate}
                          pending={toggle.isPending}
                          onEdit={(id) => navigate(`/tasks/${id}/edit`)}
                          expanded={!collapsed.has(t.id)}
                          hasVisibleChildren={hasKids}
                          todayIso={todayIso}
                          onToggleExpand={() =>
                            setCollapsed((prev) => {
                              const next = new Set(prev);
                              if (next.has(t.id)) next.delete(t.id);
                              else next.add(t.id);
                              return next;
                            })
                          }
                          path={
                            !tree
                              ? formatTaskPath(ancestorPath(records, t.id))
                              : undefined
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </Page>
      <Fab icon={Plus} label="Add task" onClick={() => navigate("/tasks/new")} />
    </>
  );
}

