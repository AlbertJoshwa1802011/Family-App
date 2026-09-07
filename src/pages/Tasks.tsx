import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Flag,
  ListTodo,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { Fab } from "../components/ui/Fab";
import { Chip } from "../components/ui/Chip";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { inputCls } from "../lib/fieldCls";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  ancestorPath,
  applyTaskView,
  attachChildCounts,
  buildForest,
  nextPriority,
  searchTasks,
  sortForest,
  type TaskLayout,
  type TaskRecord,
  type TaskSort,
} from "../lib/taskTree";
import { TaskBoard } from "../components/tasks/TaskBoard";
import { TaskComposer } from "../components/tasks/TaskComposer";
import { TaskTree } from "../components/tasks/TaskTree";
import type { FamilyMember, TasksResponse } from "../components/tasks/types";

export { TaskComposer } from "../components/tasks/TaskComposer";

const VIEW_CHIPS = [
  { id: "todo", label: "To do" },
  { id: "due", label: "Due soon" },
  { id: "recent", label: "Recent" },
  { id: "mine", label: "Mine" },
  { id: "completed", label: "Completed" },
] as const;

type UiTaskView = (typeof VIEW_CHIPS)[number]["id"];

const SORT_CHIPS: { id: TaskSort; label: string }[] = [
  { id: "due", label: "Due" },
  { id: "added_desc", label: "Newest" },
  { id: "added_asc", label: "Oldest" },
  { id: "priority", label: "Priority" },
];

const LAYOUTS: { value: TaskLayout; label: string }[] = [
  { value: "list", label: "List" },
  { value: "board", label: "Board" },
];

const SORT_KEY = "fv.taskSort";
const LAYOUT_KEY = "fv.taskLayout";

function readStored<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const v = sessionStorage.getItem(key);
    if (v && (allowed as readonly string[]).includes(v)) return v as T;
  } catch {
    /* private mode */
  }
  return fallback;
}

function writeStored(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

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

export function Tasks() {
  const qc = useQueryClient();
  const { activeFamily, user } = useAuth();
  const [view, setView] = useState<UiTaskView>("todo");
  const [sort, setSort] = useState<TaskSort>(() =>
    readStored(SORT_KEY, SORT_CHIPS.map((s) => s.id), "due"),
  );
  const [layout, setLayout] = useState<TaskLayout>(() =>
    readStored(LAYOUT_KEY, ["list", "board"] as const, "list"),
  );
  const [search, setSearch] = useState("");
  const [composerParent, setComposerParent] = useState<
    TaskRecord | null | undefined
  >(undefined);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [forcedOpen, setForcedOpen] = useState<Set<string>>(new Set());
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const [todayIso] = useState(() => utcTodayIso());

  const queryKey = ["tasks", activeFamily?.id] as const;

  const { data, isLoading } = useQuery({
    queryKey,
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
    onMutate: async (t) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<TasksResponse>(queryKey);
      const nextStatus = t.status === "done" ? "open" : "done";
      const completedAt = nextStatus === "done" ? Math.floor(Date.now() / 1000) : null;
      qc.setQueryData<TasksResponse>(queryKey, (old) => {
        if (!old) return old;
        return {
          tasks: old.tasks.map((x) =>
            x.id === t.id ? { ...x, status: nextStatus, completedAt } : x,
          ),
        };
      });
      return { prev };
    },
    onError: (_e, _t, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const cyclePriority = useMutation({
    mutationFn: (t: TaskRecord) =>
      api(`/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ priority: nextPriority(t.priority) }),
      }),
    onMutate: async (t) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<TasksResponse>(queryKey);
      const priority = nextPriority(t.priority);
      qc.setQueryData<TasksResponse>(queryKey, (old) => {
        if (!old) return old;
        return {
          tasks: old.tasks.map((x) => (x.id === t.id ? { ...x, priority } : x)),
        };
      });
      return { prev };
    },
    onError: (_e, _t, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const all = useMemo(
    () => attachChildCounts(data?.tasks ?? []),
    [data?.tasks],
  );

  const viewed = useMemo(() => {
    let base = applyTaskView(all, {
      view,
      myMemberId,
      nowSecs: now,
      todayIso,
      includeDoneChildren: view !== "completed",
    });
    if (search.trim()) {
      const hits = searchTasks(base, search);
      const keep = new Set(hits.map((t) => t.id));
      for (const t of hits) {
        for (const a of ancestorPath(all, t.id)) keep.add(a.id);
      }
      base = all.filter((t) => keep.has(t.id));
    }
    return base;
  }, [all, view, myMemberId, now, todayIso, search]);

  const forest = useMemo(
    () => sortForest(buildForest(viewed), sort),
    [viewed, sort],
  );

  function isExpanded(id: string, depth: number, hasChildren: boolean) {
    if (!hasChildren) return false;
    if (search.trim()) return true;
    if (collapsed.has(id)) return false;
    if (forcedOpen.has(id)) return true;
    return depth === 0;
  }

  function toggleExpand(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setForcedOpen((open) => new Set(open).add(id));
        return next;
      }
      // Currently showing (default or forced) → collapse
      next.add(id);
      setForcedOpen((open) => {
        const o = new Set(open);
        o.delete(id);
        return o;
      });
      return next;
    });
  }

  function expandAll() {
    setCollapsed(new Set());
    setForcedOpen(
      new Set(
        viewed.filter((t) => t.childCount > 0).map((t) => t.id),
      ),
    );
  }

  function collapseAll() {
    setForcedOpen(new Set());
    setCollapsed(
      new Set(forest.filter((n) => n.children.length > 0).map((n) => n.id)),
    );
  }

  const anyForced = forcedOpen.size > 0;
  const composerOpen = composerParent !== undefined;
  const empty = viewed.length === 0 && !composerOpen && !search.trim();
  const noSearchHits = viewed.length === 0 && search.trim().length > 0;

  const emptyCopy: Record<UiTaskView, { title: string; description: string }> = {
    todo: {
      title: "All done",
      description: "Nothing left on the list. Add a task when something comes up.",
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

  const pending = toggle.isPending || cyclePriority.isPending;
  const openRootCount = forest.length;

  return (
    <>
      <AppBar
        title="Tasks"
        back
        trailing={
          layout === "list" && forest.length > 0 ? (
            <button
              type="button"
              onClick={() => (anyForced ? collapseAll() : expandAll())}
              className="px-2 text-xs font-medium text-vault-300"
            >
              {anyForced ? "Collapse" : "Expand"}
            </button>
          ) : null
        }
      />
      <Page className="space-y-4">
        <SegmentedControl
          label="Layout"
          options={LAYOUTS}
          value={layout}
          onChange={(v) => {
            setLayout(v);
            writeStored(LAYOUT_KEY, v);
          }}
        />

        <div className="flex flex-wrap gap-2">
          {VIEW_CHIPS.map((chip) => (
            <Chip
              key={chip.id}
              selected={view === chip.id}
              onClick={() => setView(chip.id)}
            >
              {chip.label}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
            Sort
          </span>
          {SORT_CHIPS.map((chip) => (
            <Chip
              key={chip.id}
              selected={sort === chip.id}
              onClick={() => {
                setSort(chip.id);
                writeStored(SORT_KEY, chip.id);
              }}
            >
              {chip.label}
            </Chip>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 z-1 size-4 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks and subtasks…"
            aria-label="Search tasks"
            className={`${inputCls} pr-10 pl-10`}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-3 z-1 -translate-y-1/2 text-fg-subtle hover:text-fg"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {isLoading ? (
          <Card className="divide-y divide-white/8" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <TaskSkeleton key={i} />
            ))}
          </Card>
        ) : empty &&
          view === "todo" &&
          all.filter((t) => t.status !== "archived").length === 0 ? (
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
                : view === "completed"
                  ? CheckCircle2
                  : layout === "board"
                    ? Flag
                    : ListTodo
            }
            title={noSearchHits ? "No matches" : emptyCopy[view].title}
            description={
              noSearchHits
                ? `Nothing in ${VIEW_CHIPS.find((c) => c.id === view)?.label} matches “${search.trim()}”.`
                : emptyCopy[view].description
            }
          />
        ) : layout === "board" ? (
          <section className="space-y-2">
            <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              {VIEW_CHIPS.find((c) => c.id === view)?.label} ({openRootCount})
            </h3>
            <TaskBoard
              forest={forest}
              isExpanded={isExpanded}
              onToggleExpand={toggleExpand}
              onToggleDone={(t) => toggle.mutate(t)}
              onAddSubtask={(parent) => setComposerParent(parent)}
              onCyclePriority={(t) => cyclePriority.mutate(t)}
              pending={pending}
            />
          </section>
        ) : (
          <section className="space-y-2">
            <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              {VIEW_CHIPS.find((c) => c.id === view)?.label} ({openRootCount})
            </h3>
            <TaskTree
              forest={forest}
              isExpanded={isExpanded}
              onToggleExpand={toggleExpand}
              onToggleDone={(t) => toggle.mutate(t)}
              onAddSubtask={(parent) => setComposerParent(parent)}
              pending={pending}
            />
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
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  next.delete(composerParent.id);
                  return next;
                });
                setForcedOpen((prev) => new Set(prev).add(composerParent.id));
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
