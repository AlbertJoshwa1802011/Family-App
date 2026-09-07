import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

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
        "liquid-bubble liquid-raised liquid-primary liquid-press",
        "fixed right-4 bottom-24 z-30 flex size-14 items-center justify-center rounded-full md:bottom-6",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vault-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950",
        className,
      )}
    >
      <Icon className="relative z-10 size-6" aria-hidden="true" />
    </button>
  );
}
