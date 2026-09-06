import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "../../lib/cn";

interface ListItemProps {
  to?: string;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  showChevron?: boolean;
  className?: string;
}

function Inner({ leading, title, subtitle, trailing, showChevron }: ListItemProps) {
  return (
    <>
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-fg">{title}</div>
        {subtitle && (
          <div className="mt-0.5 truncate text-xs text-fg-muted">{subtitle}</div>
        )}
      </div>
      {trailing}
      {showChevron && (
        <ChevronRight className="size-5 shrink-0 text-fg-subtle" aria-hidden="true" />
      )}
    </>
  );
}

export function ListItem(props: ListItemProps) {
  const base = cn(
    "relative flex min-h-15 items-center gap-3 px-4 py-3",
    props.to &&
      "transition-colors duration-200 hover:bg-white/6 active:bg-white/10",
    props.className,
  );
  if (props.to) {
    return (
      <Link to={props.to} className={base}>
        <Inner {...props} showChevron={props.showChevron ?? true} />
      </Link>
    );
  }
  return (
    <div className={base}>
      <Inner {...props} />
    </div>
  );
}

/**
 * Circular tinted glass slot for a ListItem's `leading` icon — the recurring
 * "little bubble" that fronts every row in the app.
 */
export function ListIcon({
  tone = "vault",
  children,
  className,
}: {
  tone?: "vault" | "info" | "success" | "warning" | "danger" | "neutral";
  children: ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    vault: "text-vault-300 [--lq-tint:var(--color-vault-400)]",
    info: "text-info [--lq-tint:var(--color-info)]",
    success: "text-success [--lq-tint:var(--color-success)]",
    warning: "text-warning [--lq-tint:var(--color-warning)]",
    danger: "text-danger [--lq-tint:var(--color-danger)]",
    neutral: "text-fg-muted [--lq-tint:#ffffff]",
  };
  return (
    <span
      className={cn(
        "lq lq-flat lq-tint flex size-10 shrink-0 items-center justify-center rounded-full",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
