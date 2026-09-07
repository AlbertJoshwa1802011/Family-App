import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { inputCls } from "../../lib/fieldCls";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { priorityLabel, type TaskPriority, type TaskRecord } from "../../lib/taskTree";
import type { FamilyMember } from "./types";

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
            className={inputCls}
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
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
              Assign to
            </label>
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className={inputCls}
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
                  "lq lq-flat lq-press min-h-10 flex-1 rounded-full text-sm font-semibold",
                  priority === p
                    ? p === "high"
                      ? "lq-danger text-danger"
                      : "lq-primary text-white"
                    : "text-fg-muted",
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
