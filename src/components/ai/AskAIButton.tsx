import { Sparkles, X } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../../lib/cn";

export const AskAIButton = forwardRef<
  HTMLButtonElement,
  { open: boolean; onClick: () => void }
>(function AskAIButton({ open, onClick }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={open ? "Close Family AI" : "Ask Family AI"}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={cn(
        "fixed bottom-24 left-4 z-40 flex h-12 items-center gap-2 rounded-full pr-4 pl-3.5",
        "bg-vault-600 text-white shadow-[0_10px_30px_-8px_var(--color-vault-600)]",
        "transition-transform duration-150 ease-out active:scale-95",
        "hover:bg-vault-500",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vault-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950",
      )}
    >
      {open ? (
        <X className="size-5" aria-hidden="true" />
      ) : (
        <Sparkles className="size-5" aria-hidden="true" />
      )}
      <span className="text-sm font-semibold">{open ? "Close" : "Ask AI"}</span>
    </button>
  );
});
