import { useEffect, useId } from "react";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Bottom sheet on a liquid-glass panel, with a grab handle and a blurred
 * scrim. Escape and scrim-tap both dismiss.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm"
        aria-label="Dismiss"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "pb-safe lq lq-chrome absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] max-w-md",
          "flex-col rounded-t-bubble-xl px-4 pb-3",
          className,
        )}
      >
        <div className="flex justify-center pt-2.5 pb-1">
          <span
            aria-hidden="true"
            className="h-1 w-10 rounded-full bg-white/25"
          />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <h2 id={titleId} className="flex-1 px-1 text-base font-semibold text-fg">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="lq-press flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-white/8"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
