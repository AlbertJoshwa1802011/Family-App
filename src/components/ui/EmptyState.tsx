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
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-vault-500/10 text-vault-300">
        <Icon className="size-7" aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-fg">{title}</h3>
      {description && (
        <p className="mt-1 max-w-xs text-sm text-fg-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
