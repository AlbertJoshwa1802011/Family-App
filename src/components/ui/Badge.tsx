import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "vault";

// Tinted glass pills — the fill is a gradient so each badge reads as a droplet.
const tones: Record<Tone, string> = {
  neutral: "text-fg-muted [--lq-tint:var(--color-fg-subtle)]",
  success: "text-success [--lq-tint:var(--color-success)]",
  warning: "text-warning [--lq-tint:var(--color-warning)]",
  danger: "text-danger [--lq-tint:var(--color-danger)]",
  info: "text-info [--lq-tint:var(--color-info)]",
  vault: "text-vault-300 [--lq-tint:var(--color-vault-400)]",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "lq lq-flat lq-tint inline-flex items-center gap-1 rounded-full px-2.5 py-0.5",
        "[--lq-bg:#080e1acc]",
        "text-xs font-semibold whitespace-nowrap",
        "shadow-[0_2px_8px_-4px_#0009]",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
