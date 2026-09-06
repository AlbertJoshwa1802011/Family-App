import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Selectable glass pill (categories, filters, priorities). Selected chips fill
 * with the primary liquid; the rest stay clear glass.
 */
export function Chip({
  selected = false,
  children,
  className,
  ...props
}: {
  selected?: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      {...props}
      className={cn(
        "lq lq-flat lq-press rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vault-400/70",
        selected ? "lq-primary text-white" : "text-fg-muted hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}
