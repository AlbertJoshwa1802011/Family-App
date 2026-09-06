import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

/** Primary action bubble. Clears the floating bottom nav. */
export function Fab({
  icon: Icon,
  label,
  className,
  ...props
}: {
  icon: LucideIcon;
  label: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      aria-label={label}
      className={cn(
        "fixed right-5 bottom-28 z-30 flex size-15 items-center justify-center rounded-full",
        "lq lq-raised lq-primary lq-press",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vault-300 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950",
        className,
      )}
    >
      <Icon className="size-6.5" strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}
