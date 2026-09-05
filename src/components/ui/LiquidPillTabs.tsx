import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

export interface LiquidPillTab<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
}

/**
 * In-page iOS liquid-glass pill (same frosted capsule + sliding bubble as
 * SectionSubNav / MoneySubNav). Use for filters that are not routes.
 */
export function LiquidPillTabs<T extends string>({
  ariaLabel,
  value,
  onChange,
  items,
}: {
  ariaLabel: string;
  value: T;
  onChange: (id: T) => void;
  items: LiquidPillTab<T>[];
}) {
  const activeIndex = items.findIndex((item) => item.id === value);

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="-mx-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div
        className={cn(
          "relative w-full overflow-hidden",
          "rounded-full border border-white/15 bg-white/10 shadow-lg backdrop-blur-2xl",
        )}
      >
        {activeIndex >= 0 && (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute top-1 bottom-1 rounded-full",
              "bg-white/18 shadow-inner",
              "transition-[left,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "motion-reduce:transition-none",
            )}
            style={{
              left: `calc(${activeIndex} * (100% / ${items.length}) + 4px)`,
              width: `calc(100% / ${items.length} - 8px)`,
            }}
          />
        )}
        <div className="relative z-10 flex w-full">
          {items.map((item) => {
            const Icon = item.icon;
            const selected = item.id === value;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onChange(item.id)}
                className={cn(
                  "flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2.5 text-xs font-medium transition-colors",
                  selected
                    ? "font-semibold text-white"
                    : "text-fg-subtle/90 hover:text-fg-muted",
                )}
              >
                {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
