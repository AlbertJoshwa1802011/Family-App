import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Flag,
  ListTodo,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { Fab } from "../components/ui/Fab";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/cn";
import {
  ancestorPath,
  applyTaskView,
  attachChildCounts,
  buildForest,
  dueStatus,
  formatTaskPath,
  isTreeView,
  priorityLabel,
  searchTasks,
  type TaskNode,
  type TaskPriority,
  type TaskRecord,
  type TaskView,
} from "../lib/taskTree";

interface TasksResponse {
  tasks: TaskRecord[];
}

interface FamilyMember {
  id: string;
  userId: string | null;
  displayName: string | null;
  name: string | null;
}

const VIEW_CHIPS: { id: TaskView; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "priority", label: "Priority" },
  { id: "due", label: "Due soon" },
  { id: "recent", label: "Recent" },
  { id: "mine", label: "Mine" },
  { id: "completed", label: "Completed" },
];

function utcTodayIso(): string {
  const n = new Date();
  const y = n.getUTCFullYear();
  const m = String(n.getUTCMonth() + 1).padStart(2, "0");
  const d = String(n.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function TaskSkeleton() {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <Skeleton className="size-6 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

function PriorityDot({ priority }: { priority: TaskPriority }) {
  if (priority === "medium") return null;
  return (
    <span
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        priority === "high" ? "bg-danger" : "bg-fg-subtle",
      )}
      title={priorityLabel(priority)}
    />
  );
}

function TaskRow({
  task,
  depth,
  path,
  expanded,
  hasVisibleChildren,
  onToggleExpand,
  onToggleDone,
  onAddSubtask,
  pending,
  showPath,
}: {
  task: TaskRecord;
  depth: number;
  path?: string;
  expanded: boolean;
  hasVisibleChildren: boolean;
  onToggleExpand: () => void;
  onToggleDone: () => void;
  onAddSubtask: () => void;
  pending: boolean;
  showPath: boolean;
}) {
  const navigate = useNavigate();
  const done = task.status === "done";
  const due = dueStatus(task.dueDate);
  const indent = Math.min(depth, 6) * 14;
  const progress =
    task.childCount > 0 ? `${task.doneChildCount}/${task.childCount}` : null;

  return (
    <div
      className="flex min-h-14 items-center gap-1.5 py-2 pr-3"
      style={{ paddingLeft: 10 + indent }}
    >
      {hasVisibleChildren ? (
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse subtasks" : "Expand subtasks"}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-subtle hover:bg-white/5 hover:text-fg"
        >
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </button>
      ) : (
        <span className="size-8 shrink-0" aria-hidden="true" />
      )}

      <button
        type="button"
        onClick={onToggleDone}
        disabled={pending || task.status === "archived"}
        aria-label={
          done ? "Reopen task" : "Mark task complete"
        }
        className="flex size-8 shrink-0 items-center justify-center text-fg-subtle transition-colors hover:text-vault-300 disabled:opacity-50"
      >
        {done ? (
          <CheckCircle2 className="size-6 text-success" />
        ) : (
          <Circle className="size-6" />
        )}
      </button>

      <button
        type="button"
        onClick={() => navigate(`/tasks/${task.id}`)}
        className="min-w-0 flex-1 py-1 text-left"
      >
        <div className="flex items-center gap-1.5">
          <PriorityDot priority={task.priority} />
          <span
            className={cn(
              "truncate text-sm font-medium",
              done ? "text-fg-subtle line-through" : "text-fg",
            )}
          >
            {task.title}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
          {showPath && path && <span className="truncate">{path}</span>}
          {task.assignedToName && <span>{task.assignedToName}</span>}
          {progress && (
            <span className="font-medium text-vault-300">{progress} done</span>
          )}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        {!done && due && (
          <Badge tone={due.tone === "neutral" ? "neutral" : due.tone}>
            {due.label}
          </Badge>
        )}
        {task.priority === "high" && !done && (
          <span className="sr-only">High priority</span>
        )}
        {!done && (
          <button
            type="button"
            onClick={onAddSubtask}
            aria-label="Add subtask"
            className="flex size-8 items-center justify-center rounded-lg text-fg-subtle hover:bg-white/5 hover:text-fg"
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function TreeList({
  forest,
  expanded,
  onToggleExpand,
  onToggleDone,
  onAddSubtask,
  pending,
  allTasks,
}: {
  forest: TaskNode[];
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  onToggleDone: (t: TaskRecord) => void;
  onAddSubtask: (parent: TaskRecord) => void;
  pending: boolean;
  allTasks: TaskRecord[];
}) {
  const rows: { node: TaskNode; path: string }[] = [];
  function walk(nodes: TaskNode[]) {
    for (const n of nodes) {
      rows.push({
        node: n,
        path: formatTaskPath(ancestorPath(allTasks, n.id)),
      });
      if (expanded.has(n.id) && n.children.length) walk(n.children);
    }
  }
  walk(forest);

  return (
    <Card className="divide-y divide-line overflow-hidden">
      {rows.map(({ node }) => (
        <TaskRow
          key={node.id}
          task={node}
          depth={node.depth}
          expanded={expanded.has(node.id)}
          hasVisibleChildren={node.children.length > 0}
          onToggleExpand={() => onToggleExpand(node.id)}
          onToggleDone={() => onToggleDone(node)}
          onAddSubtask={() => onAddSubtask(node)}
          pending={pending}
          showPath={false}
        />
      ))}
    </Card>
  );
}

export function Tasks() {
  const qc = useQueryClient();
  const { activeFamily, user } = useAuth();
  const [view, setView] = useState<TaskView>("todo");
  const [search, setSearch] = useState("");
  const [composerParent, setComposerParent] = useState<TaskRecord | null | undefined>(
    undefined,
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const [todayIso] = useState(() => utcTodayIso());

  const { data, isLoading } = useQuery({
    queryKey: ["tasks", activeFamily?.id],
    queryFn: () =>
      api<TasksResponse>(`/tasks?familyId=${activeFamily!.id}`),
    enabled: Boolean(activeFamily),
  });

  const { data: membersData } = useQuery({
    queryKey: ["family-members", activeFamily?.id],
    queryFn: () =>
      api<{ members: FamilyMember[] }>(`/families/${activeFamily!.id}/members`),
    enabled: Boolean(activeFamily),
  });

  const myMemberId =
    membersData?.members.find((m) => m.userId === user?.id)?.id ?? null;

  const toggle = useMutation({
    mutationFn: (t: TaskRecord) =>
      api(`/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: t.status === "done" ? "open" : "done",
        }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const all = useMemo(
    () => attachChildCounts(data?.tasks ?? []),
    [data?.tasks],
  );

  const viewed = useMemo(() => {
    const base = applyTaskView(all, {
      view,
      myMemberId,
      nowSecs: now,
      todayIso,
    });
    if (!search.trim()) return base;
    const hits = searchTasks(base, search);
    const keep = new Set(hits.map((t) => t.id));
    for (const t of hits) {
      for (const a of ancestorPath(all, t.id)) keep.add(a.id);
    }
    return all.filter((t) => keep.has(t.id));
  }, [all, view, myMemberId, now, todayIso, search]);

  const forest = useMemo(() => buildForest(viewed), [viewed]);

  const tree = isTreeView(view);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setExpanded(new Set(viewed.filter((t) => t.childCount > 0).map((t) => t.id)));
  }

  const composerOpen = composerParent !== undefined;
  const empty = viewed.length === 0 && !composerOpen && !search.trim();
  const noSearchHits = viewed.length === 0 && search.trim().length > 0;

  const emptyCopy: Record<TaskView, { title: string; description: string }> = {
    todo: {
      title: "All done",
      description: "Nothing left on the list. Add a task when something comes up.",
    },
    priority: {
      title: "No open tasks",
      description: "High-priority work will show up here, strongest first.",
    },
    due: {
      title: "Nothing due soon",
      description: "Overdue tasks and anything due in the next two weeks land here.",
    },
    recent: {
      title: "Nothing new",
      description: "Tasks added in the last 14 days will show up here.",
    },
    mine: {
      title: "Nothing assigned to you",
      description: "When someone assigns you a task, it will appear in this list.",
    },
    completed: {
      title: "No completed tasks",
      description: "Finished work is filed here so the To-do list stays clean.",
    },
  };

  return (
    <>
      <AppBar
        title="Tasks"
        back
        trailing={
          tree && viewed.length > 0 ? (
            <button
              type="button"
              onClick={() =>
                expanded.size > 0 ? setExpanded(new Set()) : expandAll()
              }
              className="px-2 text-xs font-medium text-vault-300"
            >
              {expanded.size > 0 ? "Collapse" : "Expand"}
            </button>
          ) : null
        }
      />
      <Page className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {VIEW_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setView(chip.id)}
              aria-pressed={view === chip.id}
              className={cn(
                "min-h-9 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
                view === chip.id
                  ? "border-vault-500/40 bg-vault-500/15 text-vault-300"
                  : "border-line bg-surface text-fg-muted hover:text-fg",
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks and subtasks…"
            aria-label="Search tasks"
            className="w-full rounded-xl border border-line bg-surface py-3 pr-10 pl-10 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-3 -translate-y-1/2 text-fg-subtle hover:text-fg"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {isLoading ? (
          <Card className="divide-y divide-line" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <TaskSkeleton key={i} />
            ))}
          </Card>
        ) : empty && view === "todo" && all.filter((t) => t.status !== "archived").length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title="No tasks yet"
            description="Keep family to-dos in one place — nest subtasks under bigger jobs so a long list stays readable."
            action={
              <Button
                leadingIcon={<Plus className="size-4" />}
                onClick={() => setComposerParent(null)}
              >
                Add task
              </Button>
            }
          />
        ) : empty || noSearchHits ? (
          <EmptyState
            icon={
              view === "due"
                ? AlertTriangle
                : view === "priority"
                  ? Flag
                  : view === "completed"
                    ? CheckCircle2
                    : ListTodo
            }
            title={noSearchHits ? "No matches" : emptyCopy[view].title}
            description={
              noSearchHits
                ? `Nothing in ${VIEW_CHIPS.find((c) => c.id === view)?.label} matches “${search.trim()}”.`
                : emptyCopy[view].description
            }
          />
        ) : tree ? (
          <section className="space-y-2">
            <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              {VIEW_CHIPS.find((c) => c.id === view)?.label} ({viewed.length})
            </h3>
            <TreeList
              forest={forest}
              expanded={search.trim() ? new Set(viewed.map((t) => t.id)) : expanded}
              onToggleExpand={toggleExpand}
              onToggleDone={(t) => toggle.mutate(t)}
              onAddSubtask={(parent) => setComposerParent(parent)}
              pending={toggle.isPending}
              allTasks={all}
            />
          </section>
        ) : (
          <section className="space-y-2">
            <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              {VIEW_CHIPS.find((c) => c.id === view)?.label} ({viewed.length})
            </h3>
            {view === "priority" ? (
              <PrioritySections
                tasks={viewed}
                allTasks={all}
                onToggleDone={(t) => toggle.mutate(t)}
                onAddSubtask={(parent) => setComposerParent(parent)}
                pending={toggle.isPending}
              />
            ) : (
              <Card className="divide-y divide-line overflow-hidden">
                {viewed.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    depth={0}
                    path={formatTaskPath(ancestorPath(all, t.id))}
                    expanded={false}
                    hasVisibleChildren={false}
                    onToggleExpand={() => undefined}
                    onToggleDone={() => toggle.mutate(t)}
                    onAddSubtask={() => setComposerParent(t)}
                    pending={toggle.isPending}
                    showPath
                  />
                ))}
              </Card>
            )}
          </section>
        )}

        {composerOpen && activeFamily && (
          <TaskComposer
            familyId={activeFamily.id}
            parent={composerParent}
            members={membersData?.members ?? []}
            onClose={() => setComposerParent(undefined)}
            onCreated={() => {
              if (composerParent) {
                setExpanded((prev) => new Set(prev).add(composerParent.id));
              }
            }}
          />
        )}
      </Page>
      <Fab
        icon={Plus}
        label="Add task"
        onClick={() => setComposerParent(null)}
      />
    </>
  );
}

function PrioritySections({
  tasks,
  allTasks,
  onToggleDone,
  onAddSubtask,
  pending,
}: {
  tasks: TaskRecord[];
  allTasks: TaskRecord[];
  onToggleDone: (t: TaskRecord) => void;
  onAddSubtask: (t: TaskRecord) => void;
  pending: boolean;
}) {
  const groups: { key: TaskPriority; label: string }[] = [
    { key: "high", label: "High" },
    { key: "medium", label: "Medium" },
    { key: "low", label: "Low" },
  ];
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const items = tasks.filter((t) => t.priority === g.key);
        if (items.length === 0) return null;
        return (
          <section key={g.key} className="space-y-2">
            <h4 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              {g.label} ({items.length})
            </h4>
            <Card className="divide-y divide-line overflow-hidden">
              {items.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  depth={0}
                  path={formatTaskPath(ancestorPath(allTasks, t.id))}
                  expanded={false}
                  hasVisibleChildren={false}
                  onToggleExpand={() => undefined}
                  onToggleDone={() => onToggleDone(t)}
                  onAddSubtask={() => onAddSubtask(t)}
                  pending={pending}
                  showPath
                />
              ))}
            </Card>
          </section>
        );
      })}
    </div>
  );
}

export function TaskComposer({
  familyId,
  parent,
  members,
  onClose,
  onCreated,
}: {
  familyId: string;
  parent: TaskRecord | null;
  members: FamilyMember[];
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TaskPriority>(
    parent?.priority ?? "medium",
  );
  const [assignee, setAssignee] = useState("");
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api<{ task: TaskRecord }>("/tasks", {
        method: "POST",
        body: JSON.stringify({
          familyId,
          title: title.trim(),
          dueDate: dueDate || undefined,
          priority,
          assignedToMemberId: assignee || undefined,
          parentTaskId: parent?.id,
        }),
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      onCreated?.(res.task.id);
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("What needs doing?");
      return;
    }
    setError("");
    create.mutate();
  }

  return (
    <form onSubmit={submit} noValidate className="mt-2">
      <Card className="space-y-3 p-4">
        {parent && (
          <p className="text-xs text-fg-muted">
            Subtask of <span className="font-medium text-fg">{parent.title}</span>
          </p>
        )}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
            {parent ? "New subtask" : "New task"}{" "}
            <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={parent ? "e.g. Scan the photo page" : "e.g. Renew car insurance"}
            autoFocus
            className="w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
              Due date
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-xl border border-line bg-ink-950 px-3 py-3 text-sm text-fg focus:border-vault-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
              Assign to
            </label>
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="w-full rounded-xl border border-line bg-ink-950 px-3 py-3 text-sm text-fg focus:border-vault-500 focus:outline-none"
            >
              <option value="">Anyone</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName || m.name || "Member"}
                </option>
              ))}
            </select>
          </div>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold text-fg-muted">
            Priority
          </legend>
          <div className="flex gap-2">
            {(["low", "medium", "high"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                aria-pressed={priority === p}
                className={cn(
                  "min-h-9 flex-1 rounded-xl border text-sm font-medium",
                  priority === p
                    ? p === "high"
                      ? "border-danger/40 bg-danger/15 text-danger"
                      : "border-vault-500/40 bg-vault-500/15 text-vault-300"
                    : "border-line text-fg-muted",
                )}
              >
                {priorityLabel(p)}
              </button>
            ))}
          </div>
        </fieldset>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={create.isPending} className="flex-1">
            {parent ? "Add subtask" : "Add task"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </Card>
    </form>
  );
}
