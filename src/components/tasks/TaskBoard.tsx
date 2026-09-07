import { Card } from "../ui/Card";
import { cn } from "../../lib/cn";
import {
  PRIORITY_COLUMNS,
  groupForestByPriority,
  priorityLabel,
  type TaskNode,
  type TaskPriority,
  type TaskRecord,
} from "../../lib/taskTree";
import { TaskBranch } from "./TaskTree";

const COLUMN_TINT: Record<TaskPriority, string> = {
  high: "border-l-danger/80",
  medium: "border-l-vault-400/80",
  low: "border-l-white/20",
};

export function TaskBoard({
  forest,
  isExpanded,
  onToggleExpand,
  onToggleDone,
  onAddSubtask,
  onCyclePriority,
  pending,
}: {
  forest: TaskNode[];
  isExpanded: (id: string, depth: number, hasChildren: boolean) => boolean;
  onToggleExpand: (id: string) => void;
  onToggleDone: (t: TaskRecord) => void;
  onAddSubtask: (parent: TaskRecord) => void;
  onCyclePriority: (t: TaskRecord) => void;
  pending: boolean;
}) {
  const cols = groupForestByPriority(forest);

  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {PRIORITY_COLUMNS.map((key) => {
        const items = cols[key];
        return (
          <section
            key={key}
            className="w-[78%] max-w-72 shrink-0 snap-center"
            aria-label={`${priorityLabel(key)} priority`}
          >
            <header
              className={cn(
                "mb-2 flex items-center justify-between border-l-4 px-2 py-1",
                COLUMN_TINT[key],
              )}
            >
              <h4 className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">
                {priorityLabel(key)}
              </h4>
              <span className="text-xs text-fg-muted">{items.length}</span>
            </header>
            {items.length === 0 ? (
              <Card className="px-3 py-6 text-center text-xs text-fg-subtle">
                Nothing {priorityLabel(key).toLowerCase()} priority
              </Card>
            ) : (
              <div className="space-y-2">
                {items.map((node) => (
                  <Card key={node.id} className="overflow-hidden px-1 py-1">
                    <ul>
                      <TaskBranch
                        node={node}
                        depth={0}
                        isExpanded={isExpanded}
                        onToggleExpand={onToggleExpand}
                        onToggleDone={onToggleDone}
                        onAddSubtask={onAddSubtask}
                        onCyclePriority={onCyclePriority}
                        pending={pending}
                        compact
                        showPriorityFlag
                      />
                    </ul>
                  </Card>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
