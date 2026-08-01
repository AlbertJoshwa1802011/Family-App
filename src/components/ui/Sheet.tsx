import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

/**
 * Bottom sheet — the module's primary editing surface on mobile.
 *
 * Anchored to the bottom so controls sit under the thumb, capped at 85dvh so
 * the on-screen keyboard can never push the action row out of reach (the body
 * scrolls, the footer stays put), and safe-area padded for gesture bars.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Escape closes; the page behind must not scroll while the sheet is up.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Move focus into the sheet so screen readers and keyboards follow it.
    const firstField = panelRef.current?.querySelector<HTMLElement>(
      "input, select, textarea, button",
    );
    firstField?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="sheet-backdrop absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "sheet-panel relative flex max-h-[85dvh] w-full max-w-md flex-col",
          "rounded-t-3xl border border-line bg-surface shadow-pop",
        )}
      >
        <header className="flex items-start gap-3 border-b border-line px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-base font-semibold text-fg">
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-xs text-fg-muted">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mt-1 -mr-1 flex size-11 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-white/5 active:scale-95"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {children}
        </div>

        {footer && (
          <footer className="pb-safe border-t border-line bg-surface px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
