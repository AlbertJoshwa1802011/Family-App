import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CheckCircle2,
  ChevronRight,
  Circle,
  Flag,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Skeleton } from "../components/ui/Skeleton";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/cn";
import {
  MAX_TASK_DEPTH,
  attachChildCounts,
  buildForest,
  descendantIds,
  dueStatus,
  flattenForest,
  priorityLabel,
  type TaskPriority,
  type TaskRecord,
} from "../lib/taskTree";
import { TaskComposer } from "./Tasks";

interface FamilyMember {
  id: string;
  userId: string | null;
  displayName: string | null;
  name: string | null;
}

interface TaskDetailResponse {
  task: TaskRecord;
  ancestors: TaskRecord[];
  children: TaskRecord[];
  depth: number;
}

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeFamily } = useAuth();
  const [adding, setAdding] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["tasks", id],
    queryFn: () => api<TaskDetailResponse>(`/tasks/${id}`),
    enabled: Boolean(id),
  });

  const { data: listData } = useQuery({
    queryKey: ["tasks", activeFamily?.id],
    queryFn: () =>
      api<{ tasks: TaskRecord[] }>(`/tasks?familyId=${activeFamily!.id}`),
    enabled: Boolean(activeFamily),
  });

  const { data: membersData } = useQuery({
    queryKey: ["family-members", activeFamily?.id],
    queryFn: () =>
      api<{ members: FamilyMember[] }>(`/families/${activeFamily!.id}/members`),
    enabled: Boolean(activeFamily),
  });

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      navigate("/tasks", { replace: true });
    },
  });

  const all = useMemo(
    () => attachChildCounts(listData?.tasks ?? []),
    [listData?.tasks],
  );

  if (isLoading) {
    return (
      <>
        <AppBar title="Task" back />
        <Page className="space-y-4">
          <Card className="space-y-3 p-4">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </Card>
        </Page>
      </>
    );
  }

  const task = data?.task;
  if (!task) return null;

  const ancestors = data.ancestors;
  const subtreeIds = new Set([task.id, ...descendantIds(all, task.id)]);
  const subtree = all.filter((t) => subtreeIds.has(t.id));
  const forest = buildForest(subtree);
  const rootNode = forest.find((n) => n.id === task.id);
  const nested = rootNode
    ? flattenForest(rootNode.children)
    : (data.children ?? []).map((c) => ({ ...c, children: [], depth: 1 }));
  const due = dueStatus(task.dueDate);
  const done = task.status === "done";
  const archived = task.status === "archived";
  const descendantCount = descendantIds(all, task.id).length;
  const canNest = (data.depth ?? 0) < MAX_TASK_DEPTH && !done && !archived;
  const progress =
    task.childCount > 0 ? `${task.doneChildCount} of ${task.childCount} subtasks done` : null;

  return (
    <>
      <AppBar title={done ? "Completed" : "Task"} back />
      <Page className="space-y-4">
        {ancestors.length > 0 && (
          <nav aria-label="Parent tasks" className="flex flex-wrap items-center gap-1 text-xs text-fg-muted">
            {ancestors.map((a, i) => (
              <span key={a.id} className="inline-flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3 text-fg-subtle" />}
                <Link to={`/tasks/${a.id}`} className="truncate text-vault-300 hover:underline">
                  {a.title}
                </Link>
              </span>
            ))}
          </nav>
        )}

        <Card className="space-y-4 p-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() =>
                patch.mutate({ status: done ? "open" : "done" })
              }
              disabled={patch.isPending || archived}
              aria-label={done ? "Reopen task" : "Mark task complete"}
              className="mt-0.5 shrink-0 text-fg-subtle hover:text-vault-300 disabled:opacity-50"
            >
              {done || archived ? (
                <CheckCircle2 className="size-7 text-success" />
              ) : (
                <Circle className="size-7" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <h2
                className={cn(
                  "text-base font-semibold leading-snug",
                  done ? "text-fg-subtle line-through" : "text-fg",
                )}
              >
                {task.title}
              </h2>
              {progress && (
                <p className="mt-1 text-xs font-medium text-vault-300">{progress}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={task.priority === "high" ? "danger" : "neutral"}>
                  <Flag className="size-3" />
                  {priorityLabel(task.priority)}
                </Badge>
                {due && !done && (
                  <Badge tone={due.tone === "neutral" ? "neutral" : due.tone}>
                    {due.label}
                  </Badge>
                )}
                {task.assignedToName && (
                  <Badge tone="info">{task.assignedToName}</Badge>
                )}
                {archived && <Badge tone="neutral">Archived</Badge>}
              </div>
            </div>
          </div>

          {task.notes && (
            <p className="text-sm leading-relaxed text-fg-muted whitespace-pre-wrap">
              {task.notes}
            </p>
          )}

          <TaskEditFields
            key={task.id + String(task.updatedAt)}
            task={task}
            members={membersData?.members ?? []}
            saving={patch.isPending}
            onSave={(body) => patch.mutate(body)}
          />
        </Card>

        <section className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              Subtasks ({task.childCount})
            </h3>
          </div>
          {nested.length === 0 && !adding ? (
            <p className="rounded-2xl border border-line px-4 py-3 text-sm text-fg-subtle">
              No subtasks yet. Break this into smaller steps so it stays clear even
              when the family list gets long.
            </p>
          ) : (
            <Card className="divide-y divide-line overflow-hidden">
              {nested.map((n) => (
                <Link
                  key={n.id}
                  to={`/tasks/${n.id}`}
                  className="flex min-h-12 items-center gap-2 py-2 pr-3 hover:bg-white/5"
                  style={{ paddingLeft: 12 + Math.min(Math.max(n.depth - 1, 0), 6) * 14 }}
                >
                  {n.status === "done" ? (
                    <CheckCircle2 className="size-5 shrink-0 text-success" />
                  ) : (
                    <Circle className="size-5 shrink-0 text-fg-subtle" />
                  )}
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      n.status === "done" ? "text-fg-subtle line-through" : "text-fg",
                    )}
                  >
                    {n.title}
                  </span>
                  {n.childCount > 0 && (
                    <span className="text-xs text-vault-300">
                      {n.doneChildCount}/{n.childCount}
                    </span>
                  )}
                </Link>
              ))}
            </Card>
          )}
          {canNest && activeFamily && (
            adding ? (
              <TaskComposer
                familyId={activeFamily.id}
                parent={task}
                members={membersData?.members ?? []}
                onClose={() => setAdding(false)}
              />
            ) : (
              <Button
                variant="secondary"
                fullWidth
                onClick={() => setAdding(true)}
              >
                Add subtask
              </Button>
            )
          )}
        </section>

        <section className="space-y-2 pt-2">
          {!archived && (
            <Button
              variant={done ? "secondary" : "primary"}
              fullWidth
              loading={patch.isPending}
              leadingIcon={
                done ? <Circle className="size-4" /> : <CheckCircle2 className="size-4" />
              }
              onClick={() => patch.mutate({ status: done ? "open" : "done" })}
            >
              {done ? "Reopen" : "Mark complete"}
            </Button>
          )}
          {done && !archived && (
            <Button
              variant="ghost"
              fullWidth
              loading={patch.isPending}
              leadingIcon={<Archive className="size-4" />}
              onClick={() => patch.mutate({ status: "archived" })}
            >
              Archive (hide from completed)
            </Button>
          )}
          <Button
            variant="danger"
            fullWidth
            loading={remove.isPending}
            leadingIcon={<Trash2 className="size-4" />}
            onClick={() => {
              const extra =
                descendantCount > 0
                  ? ` This will also remove ${descendantCount} subtask${descendantCount === 1 ? "" : "s"}.`
                  : "";
              if (confirm(`Delete this task?${extra} This cannot be undone.`)) {
                remove.mutate();
              }
            }}
          >
            Delete task
          </Button>
        </section>
        <p className="px-1 text-[11px] text-fg-subtle">
          Completed tasks leave the To-do list. Reopen them from Completed, or
          archive to hide them there too.
        </p>
      </Page>
    </>
  );
}

function TaskEditFields({
  task,
  members,
  saving,
  onSave,
}: {
  task: TaskRecord;
  members: FamilyMember[];
  saving: boolean;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [assignee, setAssignee] = useState(task.assignedToMemberId ?? "");

  const dirty =
    title.trim() !== task.title ||
    notes !== (task.notes ?? "") ||
    dueDate !== (task.dueDate ?? "") ||
    priority !== task.priority ||
    assignee !== (task.assignedToMemberId ?? "");

  return (
    <form
      className="space-y-3 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onSave({
          title: title.trim(),
          notes: notes.trim() ? notes.trim() : null,
          dueDate: dueDate || undefined,
          priority,
          assignedToMemberId: assignee || null,
        });
      }}
    >
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg focus:border-vault-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
          Notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-sm text-fg focus:border-vault-500 focus:outline-none"
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
      {dirty && (
        <Button type="submit" variant="secondary" loading={saving} fullWidth>
          Save changes
        </Button>
      )}
    </form>
  );
}
