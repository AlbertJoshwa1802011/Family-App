import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

/**
 * Liquid-bubble surface — frosted glass card used across Home / Vault / Docs /
 * Money / Family. Replaces the old flat `bg-surface` (white/gray) panels.
 *
 * Do not force `overflow-hidden` here — list cards that need clipped corners
 * opt in; focus rings and decorative blurs must be free to paint outside.
 */
export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("liquid-bubble", className)} />;
}
