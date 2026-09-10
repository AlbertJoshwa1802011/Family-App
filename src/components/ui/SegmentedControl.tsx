import { cn } from "../../lib/cn";

/**
 * iOS-style segmented control. A single liquid pill slides between segments
 * rather than each segment toggling its own background — that continuity is
 * what makes the switch read as one blob of liquid moving.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  label?: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "lq lq-field relative flex rounded-full p-1",
        className,
      )}
    >
      {/* the sliding liquid pill */}
      <span
        aria-hidden="true"
        className="lq lq-primary absolute inset-y-1 rounded-full transition-[left] duration-500 ease-[var(--ease-liquid)]"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          left: `calc(0.25rem + (100% - 0.5rem) * ${index} / ${options.length})`,
        }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative z-1 min-h-9 flex-1 rounded-full px-3 text-xs font-semibold",
            "transition-colors duration-300",
            o.value === value ? "text-white" : "text-fg-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
