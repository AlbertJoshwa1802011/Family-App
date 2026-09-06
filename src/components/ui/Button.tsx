import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "white";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
}

// Every variant is a bubble: pill radius, specular rim, liquid press.
const variants: Record<Variant, string> = {
  primary: "lq lq-raised lq-primary",
  secondary: "lq text-fg",
  ghost: "text-fg-muted hover:bg-white/8 hover:text-fg",
  danger: "lq lq-danger text-danger",
  white: "lq lq-white text-slate-900",
};

const sizes: Record<Size, string> = {
  sm: "min-h-9 px-3.5 text-xs",
  md: "min-h-11 px-5 text-sm",
  lg: "min-h-13 px-6 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  leadingIcon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading}
      className={cn(
        "relative inline-flex items-center justify-center gap-2 rounded-full font-semibold",
        "lq-press select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vault-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950",
        "disabled:pointer-events-none disabled:opacity-45",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className,
      )}
    >
      {loading ? <Spinner /> : leadingIcon}
      {children}
    </button>
  );
}
