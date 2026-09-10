import { donutSlices, DONUT_CIRCUMFERENCE, type CategorySpend } from "../../lib/spendClarity";
import { formatMoney } from "../../lib/money";
import { cn } from "../../lib/cn";
import { haptic } from "../../lib/haptics";

export function CategoryDonut({
  rows,
  totalMinor,
  currency,
  selectedKey,
  onSelect,
}: {
  rows: CategorySpend[];
  totalMinor: number;
  currency: string;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  const slices = donutSlices(rows, totalMinor);
  if (slices.length === 0) return null;

  return (
    <div className="flex items-center gap-4">
      <svg
        viewBox="0 0 88 88"
        className="size-24 shrink-0 -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="44"
          cy="44"
          r="36"
          fill="none"
          stroke="currentColor"
          className="text-white/8"
          strokeWidth="10"
        />
        {slices.map((s) => (
          <circle
            key={s.key}
            cx="44"
            cy="44"
            r="36"
            fill="none"
            stroke={s.color}
            strokeWidth={selectedKey === null || selectedKey === s.key ? 10 : 7}
            strokeDasharray={`${s.dash} ${DONUT_CIRCUMFERENCE}`}
            strokeDashoffset={s.offset}
            strokeLinecap="butt"
            className="transition-[stroke-width] duration-200"
            opacity={selectedKey && selectedKey !== s.key ? 0.35 : 1}
          />
        ))}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.slice(0, 5).map((s) => {
          const active = selectedKey === s.key;
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => {
                  haptic("selection");
                  onSelect(active ? null : s.key);
                }}
                className={cn(
                  "flex w-full min-h-9 items-center gap-2 rounded-lg px-1.5 text-left",
                  "hover:bg-white/5 active:scale-[0.99]",
                  active && "bg-white/8",
                )}
                aria-pressed={active}
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-xs text-fg">{s.name}</span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-fg">
                  {(s.share * 100).toFixed(0)}%
                </span>
              </button>
            </li>
          );
        })}
        {slices.length > 5 && (
          <li className="px-1.5 text-[11px] text-fg-subtle">
            +{slices.length - 5} more · {formatMoney(totalMinor, currency)}
          </li>
        )}
      </ul>
    </div>
  );
}
