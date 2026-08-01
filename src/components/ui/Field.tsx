import { useId, type ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Shared form-control styling. Previously copy-pasted per page (`inputCls` in
 * DocumentForm); lives here now so every new form matches. py-3 keeps the tap
 * target at 44px+ and the 16px-equivalent text size stops iOS Safari zooming on
 * focus.
 */
export const inputClass =
  "w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-base text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none disabled:opacity-50";

/** Labelled form row with optional hint and error text, wired up for a11y. */
export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: { id: string; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-xs font-semibold text-fg-muted"
      >
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children({ id, "aria-describedby": describedBy })}
      {error ? (
        <p id={errorId} className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="mt-1 text-xs text-fg-subtle">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** Horizontal choice chips — used for colours, payment kinds, and filters. */
export function ChipGroup({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      {children}
    </div>
  );
}

export function Chip({
  selected,
  onClick,
  children,
  label,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  /** Accessible name when the visible content is only an emoji or a swatch. */
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-full border px-3.5 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vault-400",
        selected
          ? "border-vault-500/40 bg-vault-500/15 text-vault-300"
          : "border-line text-fg-muted hover:bg-white/5",
        className,
      )}
    >
      {children}
    </button>
  );
}
