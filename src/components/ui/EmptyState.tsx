import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="liquid-bubble liquid-raised flex flex-col items-center justify-center border-dashed px-6 py-12 text-center">
      <div className="liquid-bubble flex size-14 items-center justify-center rounded-2xl text-vault-300 [--lq-bg:#14b8a626]">
        <Icon className="relative z-10 size-7" aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-fg">{title}</h3>
      {description && (
        <p className="mt-1 max-w-xs text-sm text-fg-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
