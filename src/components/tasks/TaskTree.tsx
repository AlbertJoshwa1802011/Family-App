import { Card } from "../ui/Card";
import { cn } from "../../lib/cn";
import type { TaskNode, TaskRecord } from "../../lib/taskTree";
import { TaskRow } from "./TaskRow";

export function TaskBranch({
  node,
  depth,
  isExpanded,
  onToggleExpand,
  onToggleDone,
  onAddSubtask,
  onCyclePriority,
  pending,
  compact,
  showPriorityFlag,
}: {
  node: TaskNode;
  depth: number;
  isExpanded: (id: string, depth: number, hasChildren: boolean) => boolean;
  onToggleExpand: (id: string) => void;
  onToggleDone: (t: TaskRecord) => void;
  onAddSubtask?: (parent: TaskRecord) => void;
  onCyclePriority?: (t: TaskRecord) => void;
  pending: boolean;
  compact?: boolean;
  showPriorityFlag?: boolean;
}) {
  const hasVisibleChildren = node.children.length > 0;
  const expanded = isExpanded(node.id, depth, hasVisibleChildren);

  return (
    <li className="list-none">
      <TaskRow
        task={node}
        expanded={expanded}
        hasVisibleChildren={hasVisibleChildren}
        onToggleExpand={() => onToggleExpand(node.id)}
        onToggleDone={() => onToggleDone(node)}
        onAddSubtask={onAddSubtask ? () => onAddSubtask(node) : undefined}
        onCyclePriority={
          onCyclePriority && depth === 0 ? () => onCyclePriority(node) : undefined
        }
        pending={pending}
        compact={compact}
        showPriorityFlag={showPriorityFlag && depth === 0}
      />
      {hasVisibleChildren && expanded && (
        <ul
          className={cn(
            "ml-5 border-l-2 border-white/12 pl-2",
            node.status === "done" && "opacity-80",
          )}
        >
          {node.children.map((child) => (
            <TaskBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              isExpanded={isExpanded}
              onToggleExpand={onToggleExpand}
              onToggleDone={onToggleDone}
              onAddSubtask={onAddSubtask}
              pending={pending}
              compact={compact}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TaskTree({
  forest,
  isExpanded,
  onToggleExpand,
  onToggleDone,
  onAddSubtask,
  onCyclePriority,
  pending,
  compact,
  framed = true,
  showPriorityFlag,
}: {
  forest: TaskNode[];
  isExpanded: (id: string, depth: number, hasChildren: boolean) => boolean;
  onToggleExpand: (id: string) => void;
  onToggleDone: (t: TaskRecord) => void;
  onAddSubtask?: (parent: TaskRecord) => void;
  onCyclePriority?: (t: TaskRecord) => void;
  pending: boolean;
  compact?: boolean;
  framed?: boolean;
  showPriorityFlag?: boolean;
}) {
  const list = (
    <ul className={framed ? "px-1 py-1" : undefined}>
      {forest.map((node) => (
        <TaskBranch
          key={node.id}
          node={node}
          depth={0}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
          onToggleDone={onToggleDone}
          onAddSubtask={onAddSubtask}
          onCyclePriority={onCyclePriority}
          pending={pending}
          compact={compact}
          showPriorityFlag={showPriorityFlag}
        />
      ))}
    </ul>
  );

  if (!framed) return list;
  return <Card className="overflow-hidden">{list}</Card>;
}
