import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { MONEY_ACCENT } from "../../lib/liquidGlass";

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
  accentColor = MONEY_ACCENT,
}: {
  ariaLabel: string;
  value: T;
  onChange: (id: T) => void;
  items: LiquidPillTab<T>[];
  accentColor?: string;
}) {
  const activeIndex = items.findIndex((item) => item.id === value);

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="-mx-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div
        className="liquid-pill-track relative w-full overflow-hidden rounded-full"
        style={accentColor ? { borderColor: `${accentColor}66` } : undefined}
      >
        {activeIndex >= 0 && (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute top-1 bottom-1 rounded-full",
              "transition-[left,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "motion-reduce:transition-none",
            )}
            style={{
              left: `calc(${activeIndex} * (100% / ${items.length}) + 4px)`,
              width: `calc(100% / ${items.length} - 8px)`,
              background: `linear-gradient(180deg, ${accentColor}55, ${accentColor}28)`,
              boxShadow: `0 0 22px ${accentColor}55, inset 0 1px 0 rgba(255,255,255,0.35)`,
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
                    ? "font-semibold"
                    : "text-fg-subtle/90 hover:text-fg-muted",
                )}
                style={selected ? { color: accentColor } : undefined}
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
