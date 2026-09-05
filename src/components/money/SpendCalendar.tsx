import { cn } from "../../lib/cn";
import { calendarCells, type DaySpend } from "../../lib/spendClarity";
import { haptic } from "../../lib/haptics";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

const HEAT: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "bg-white/5 text-fg-subtle",
  1: "bg-vault-500/25 text-fg",
  2: "bg-vault-500/45 text-white",
  3: "bg-vault-500/70 text-white",
  4: "bg-vault-400 text-ink-950",
};

export function SpendCalendar({
  monthStart,
  byDay,
  selectedDate,
  onSelect,
}: {
  monthStart: string;
  byDay: DaySpend[];
  selectedDate: string | null;
  onSelect: (date: string | null) => void;
}) {
  const cells = calendarCells(monthStart, byDay);

  return (
    <div role="grid" aria-label="Spending by day">
      <div className="grid grid-cols-7 gap-1 px-0.5">
        {WEEKDAYS.map((d, i) => (
          <div
            key={`${d}-${i}`}
            className="text-center text-[10px] font-medium uppercase tracking-wide text-fg-subtle"
          >
            {d}
          </div>
        ))}
        {cells.map((cell, i) => {
          if (!cell.date) {
            return <div key={`blank-${i}`} className="aspect-square" />;
          }
          const active = selectedDate === cell.date;
          return (
            <button
              key={cell.date}
              type="button"
              role="gridcell"
              aria-pressed={active}
              aria-label={`${cell.date}${cell.count ? `, ${cell.count} expenses` : ""}`}
              onClick={() => {
                haptic("selection");
                onSelect(active ? null : cell.date);
              }}
              className={cn(
                "flex aspect-square items-center justify-center rounded-lg text-[11px] font-medium tabular-nums",
                "transition-colors active:scale-95",
                HEAT[cell.intensity],
                active && "ring-2 ring-white ring-offset-1 ring-offset-ink-950",
              )}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
