import { cn } from "../../lib/cn";
import { CURATED_EMOJI } from "../../lib/expenseEmoji";

export function EmojiPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (emoji: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Category icon"
      className="grid max-h-44 grid-cols-8 gap-1 overflow-y-auto rounded-xl border border-line bg-ink-950 p-2"
    >
      {CURATED_EMOJI.map(({ emoji, name }) => (
        <button
          key={emoji}
          type="button"
          role="radio"
          aria-checked={value === emoji}
          aria-label={name}
          title={name}
          onClick={() => onChange(emoji)}
          className={cn(
            "flex size-10 items-center justify-center rounded-lg text-xl transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vault-400",
            value === emoji
              ? "bg-vault-500/20 ring-1 ring-vault-500/40"
              : "hover:bg-white/5",
          )}
        >
          <span aria-hidden="true">{emoji}</span>
        </button>
      ))}
    </div>
  );
}
