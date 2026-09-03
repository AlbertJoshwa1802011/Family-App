import { useEffect, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { haptic } from "../../lib/haptics";

export interface ActionSheetItem {
  id: string;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * iOS-style action sheet — the native long-press destination.
 * Bottom sheet on a phone, compact card on larger screens. Cancel is always last.
 */
export function ActionSheet({
  open,
  onClose,
  title,
  message,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  message?: ReactNode;
  actions: ActionSheetItem[];
}) {
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
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center px-3 pb-safe"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : "Actions"}
    >
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
      />
      <div className="relative mb-3 w-full max-w-sm space-y-2">
        <div
          className={cn(
            "overflow-hidden rounded-[22px] border border-white/15",
            "bg-white/12 shadow-pop backdrop-blur-2xl",
          )}
        >
          {(title || message) && (
            <div className="border-b border-white/10 px-4 py-3 text-center">
              {title && (
                <p className="text-[13px] font-semibold text-fg">{title}</p>
              )}
              {message && (
                <p className="mt-0.5 text-[11px] leading-snug text-fg-muted">{message}</p>
              )}
            </div>
          )}
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={a.disabled}
              onClick={() => {
                haptic(a.destructive ? "warning" : "selection");
                onClose();
                a.onSelect();
              }}
              className={cn(
                "flex min-h-12 w-full items-center justify-center border-b border-white/10 px-4 text-[17px] last:border-b-0",
                "transition-colors active:bg-white/10 disabled:opacity-40",
                a.destructive ? "font-semibold text-danger" : "text-vault-300",
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            haptic("tap");
            onClose();
          }}
          className={cn(
            "flex min-h-12 w-full items-center justify-center rounded-[22px]",
            "border border-white/15 bg-white/16 text-[17px] font-semibold text-fg",
            "shadow-pop backdrop-blur-2xl active:bg-white/10",
          )}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
