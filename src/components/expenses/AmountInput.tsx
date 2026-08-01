import { useRef } from "react";
import { X } from "lucide-react";
import { currencyMeta } from "../../../shared/money";

/**
 * The amount field — the first thing the user touches and the thing that
 * must feel effortless. A plain, oversized `inputMode="decimal"` text input
 * beats a custom on-screen keypad here: it gets the OS's real numeric
 * keyboard (predictive digits, familiar layout) for free, with none of a
 * hand-rolled keypad's focus/a11y/measurement complexity. `type="text"` (not
 * "number") avoids the well-known number-input footguns — scroll-wheel
 * increments, locale-dependent decimal separators, no thousands separators —
 * this input just filters keystrokes to digits + one dot itself.
 */
export function AmountInput({
  value,
  onChange,
  currency,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  currency: string;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const symbol = currencyMeta(currency).symbol;

  function handleChange(raw: string) {
    // Keep only digits and a single decimal point, at most one.
    let next = raw.replace(/[^0-9.]/g, "");
    const firstDot = next.indexOf(".");
    if (firstDot !== -1) {
      next = next.slice(0, firstDot + 1) + next.slice(firstDot + 1).replace(/\./g, "");
    }
    onChange(next);
  }

  return (
    <div className="flex items-center justify-center gap-1 py-2">
      <span aria-hidden="true" className="text-3xl font-semibold text-fg-subtle">
        {symbol}
      </span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        aria-label={`Amount in ${currency}`}
        placeholder="0"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full max-w-[10ch] min-w-0 border-none bg-transparent text-center text-5xl font-bold text-fg tabular-nums placeholder:text-fg-subtle/40 focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label="Clear amount"
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-fg-subtle hover:bg-white/5"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
