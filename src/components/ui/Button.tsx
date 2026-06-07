import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "white";
type Size = "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-vault-600 text-white hover:bg-vault-500 active:bg-vault-700 shadow-[0_6px_20px_-8px_var(--color-vault-600)]",
  secondary:
    "bg-surface-2 text-fg border border-line hover:border-line-strong",
  ghost: "text-fg-muted hover:bg-white/5 hover:text-fg",
  danger: "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/20",
  white: "bg-white text-slate-800 hover:bg-slate-100",
};

const sizes: Record<Size, string> = {
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-12 px-5 text-base",
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
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-[transform,background-color,border-color] duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vault-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950",
        "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
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
