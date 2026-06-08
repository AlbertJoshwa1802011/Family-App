import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, ListTodo, Plus } from "lucide-react";
import { useState } from "react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { Fab } from "../components/ui/Fab";
import { api } from "../lib/api";
import { expiryStatus } from "../lib/expiry";

interface TaskSummary {
  id: string;
  title: string;
  notes?: string | null;
  assignedToName?: string | null;
  dueDate?: string | null;
  status: "open" | "done" | "archived";
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

function TaskRow({
  task,
  onToggle,
  pending,
}: {
  task: TaskSummary;
  onToggle: (t: TaskSummary) => void;
  pending: boolean;
}) {
  const done = task.status === "done";
  const due = expiryStatus(task.dueDate);
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <button
        onClick={() => onToggle(task)}
        disabled={pending}
        aria-label={done ? "Mark task open" : "Mark task done"}
        className="shrink-0 text-fg-subtle transition-colors hover:text-vault-300 disabled:opacity-50"
      >
        {done ? (
          <CheckCircle2 className="size-6 text-success" />
        ) : (
          <Circle className="size-6" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-sm font-medium ${
            done ? "text-fg-subtle line-through" : "text-fg"
          }`}
        >
          {task.title}
        </div>
        {(task.assignedToName || task.dueDate) && (
          <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-muted">
            {task.assignedToName && <span>{task.assignedToName}</span>}
            {task.dueDate && <span>· Due {task.dueDate}</span>}
          </div>
        )}
      </div>
      {!done && due && <Badge tone={due.tone}>{due.label}</Badge>}
    </div>
  );
}

export function Tasks() {
  const qc = useQueryClient();
  const [showDone, setShowDone] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => api<{ tasks: TaskSummary[] }>("/tasks"),
  });

  const toggle = useMutation({
    mutationFn: (t: TaskSummary) =>
      api(`/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: t.status === "done" ? "open" : "done" }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const tasks = data?.tasks ?? [];
  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <>
      <AppBar title="Tasks" back />
      <Page className="space-y-6">
        {isLoading ? (
          <Card className="divide-y divide-line" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <TaskSkeleton key={i} />
            ))}
          </Card>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title="No tasks yet"
            description="Keep family to-dos in one place — renew a passport, book a dentist, pick up prescriptions."
            action={
              <Button leadingIcon={<Plus className="size-4" />}>Add task</Button>
            }
          />
        ) : (
          <>
            <section className="space-y-2">
              <h3 className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
                To do ({open.length})
              </h3>
              {open.length === 0 ? (
                <div className="rounded-2xl border border-line px-4 py-3 text-sm text-fg-subtle">
                  All done. Nice work! 🎉
                </div>
              ) : (
                <Card className="divide-y divide-line overflow-hidden">
                  {open.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      onToggle={toggle.mutate}
                      pending={toggle.isPending}
                    />
                  ))}
                </Card>
              )}
            </section>

            {done.length > 0 && (
              <section className="space-y-2">
                <button
                  onClick={() => setShowDone((s) => !s)}
                  className="px-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase"
                >
                  Completed ({done.length}) {showDone ? "▾" : "▸"}
                </button>
                {showDone && (
                  <Card className="divide-y divide-line overflow-hidden">
                    {done.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        onToggle={toggle.mutate}
                        pending={toggle.isPending}
                      />
                    ))}
                  </Card>
                )}
              </section>
            )}
          </>
        )}
      </Page>
      <Fab icon={Plus} label="Add task" />
    </>
  );
}
