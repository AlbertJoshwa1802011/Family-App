import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Flag,
  Plus,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../ui/Badge";
import { cn } from "../../lib/cn";
import {
  MAX_TASK_DEPTH,
  dueStatus,
  priorityLabel,
  type TaskNode,
  type TaskPriority,
} from "../../lib/taskTree";

function priorityTone(p: TaskPriority): string {
  if (p === "high") return "text-danger";
  if (p === "low") return "text-fg-subtle";
  return "text-fg-muted";
}

export function TaskProgress({
  done,
  total,
  compact,
}: {
  done: number;
  total: number;
  compact?: boolean;
}) {
  if (total <= 0) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <div className={cn("flex items-center gap-2", compact ? "mt-0.5" : "mt-1")}>
      <div
        className="h-1 max-w-28 flex-1 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${done} of ${total} subtasks done`}
      >
        <div
          className="h-full rounded-full bg-vault-400 transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] font-medium whitespace-nowrap text-vault-300">
        {done}/{total}
      </span>
    </div>
  );
}

export function TaskRow({
  task,
  expanded,
  hasVisibleChildren,
  onToggleExpand,
  onToggleDone,
  onAddSubtask,
  onCyclePriority,
  pending,
  compact,
  showPriorityFlag,
}: {
  task: TaskNode;
  expanded: boolean;
  hasVisibleChildren: boolean;
  onToggleExpand: () => void;
  onToggleDone: () => void;
  onAddSubtask?: () => void;
  onCyclePriority?: () => void;
  pending: boolean;
  compact?: boolean;
  showPriorityFlag?: boolean;
}) {
  const navigate = useNavigate();
  const done = task.status === "done";
  const archived = task.status === "archived";
  const due = dueStatus(task.dueDate);
  const canAdd =
    Boolean(onAddSubtask) &&
    !done &&
    !archived &&
    task.depth < MAX_TASK_DEPTH;

  return (
    <div
      className={cn(
        "flex items-start gap-0.5 py-1.5 pr-2",
        compact ? "min-h-11" : "min-h-13",
      )}
    >
      {hasVisibleChildren ? (
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse subtasks" : "Expand subtasks"}
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-subtle hover:bg-white/5 hover:text-fg"
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
        disabled={pending || archived}
        aria-label={done ? "Reopen task" : "Mark task complete"}
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center text-fg-subtle transition-colors hover:text-vault-300 disabled:opacity-50"
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
        className="min-w-0 flex-1 py-0.5 text-left"
      >
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "truncate text-sm font-medium",
              done ? "text-fg-subtle line-through" : "text-fg",
            )}
          >
            {task.title}
          </span>
        </div>
        <TaskProgress
          done={task.doneChildCount}
          total={task.childCount}
          compact={compact}
        />
        {(task.assignedToName || (!done && due)) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
            {task.assignedToName && <span>{task.assignedToName}</span>}
          </div>
        )}
      </button>

      <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
        {!done && due && (
          <Badge tone={due.tone === "neutral" ? "neutral" : due.tone}>
            {due.label}
          </Badge>
        )}
        {showPriorityFlag && onCyclePriority && !done && (
          <button
            type="button"
            onClick={onCyclePriority}
            aria-label={`Priority ${priorityLabel(task.priority)}. Tap to change.`}
            className={cn(
              "flex size-8 items-center justify-center rounded-lg hover:bg-white/5",
              priorityTone(task.priority),
            )}
          >
            <Flag className="size-4" />
          </button>
        )}
        {canAdd && (
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
