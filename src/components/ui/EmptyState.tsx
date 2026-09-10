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
    <div className="lq bubble-in flex flex-col items-center justify-center rounded-bubble-lg px-6 py-12 text-center">
      {/* Nested bubbles: a soft halo behind a tinted glass orb. */}
      <div className="relative flex size-18 items-center justify-center">
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-vault-400/20 blur-xl"
        />
        <span className="lq lq-tint lq-raised relative flex size-16 items-center justify-center rounded-full text-vault-300 [--lq-tint:var(--color-vault-400)]">
          <Icon className="size-7" strokeWidth={1.6} aria-hidden="true" />
        </span>
      </div>
      <h3 className="mt-5 text-base font-semibold text-fg">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-fg-muted">
          {description}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
