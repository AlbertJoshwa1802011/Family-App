import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "glass" | "flat" | "raised";

const variants: Record<Variant, string> = {
  /** Default liquid bubble — translucent, blurred, specular rim. */
  glass: "lq",
  /** Same look, no backdrop-filter. Use inside long scrolling lists. */
  flat: "lq lq-flat",
  /** Lifted bubble for hero/primary surfaces. */
  raised: "lq lq-raised",
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  /** Adds the press/hover liquid response. For tappable cards. */
  interactive?: boolean;
  /** Tint the glass with a CSS color (any format `color-mix` accepts). */
  tint?: string;
}

export function Card({
  className,
  variant = "glass",
  interactive = false,
  tint,
  style,
  ...props
}: CardProps) {
  return (
    <div
      {...props}
      style={tint ? { ...style, ["--lq-tint" as string]: tint } : style}
      className={cn(
        "rounded-bubble",
        variants[variant],
        tint && "lq-tint",
        interactive && "lq-press cursor-pointer",
        className,
      )}
    />
  );
}
