import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** Optional footer actions pinned to the bottom of the sheet. */
  footer?: ReactNode;
  className?: string;
}

/**
 * Accessible dialog. Renders as a bottom sheet on mobile and a centered card on
 * larger screens. Closes on backdrop click or Escape. Body scroll is locked while open.
 */
export function Modal({ open, onClose, title, children, footer, className }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]"
      />

      {/* Panel */}
      <div
        className={cn(
          "pb-safe relative w-full max-w-lg rounded-t-3xl border border-line bg-surface shadow-pop",
          "animate-[slideUp_220ms_cubic-bezier(0.22,1,0.36,1)]",
          "sm:rounded-3xl sm:animate-[fadeIn_150ms_ease-out]",
          className,
        )}
      >
        {/* Grab handle (mobile) */}
        <div className="flex justify-center pt-3 sm:hidden">
          <span className="h-1 w-10 rounded-full bg-line-strong" />
        </div>

        {title !== undefined && (
          <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-2">
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-9 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-white/5 active:scale-95"
            >
              <X className="size-5" />
            </button>
          </div>
        )}

        <div className="max-h-[70vh] overflow-y-auto px-5 py-3">{children}</div>

        {footer && (
          <div className="flex gap-2 border-t border-line px-5 py-4">{footer}</div>
        )}
      </div>
    </div>
  );
}
