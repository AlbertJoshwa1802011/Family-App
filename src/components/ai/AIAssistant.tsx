import { useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { AskAIButton } from "./AskAIButton";
import { AIChat } from "./AIChat";
import { cn } from "../../lib/cn";

/**
 * Self-contained "Ask AI" widget: floating trigger + panel. Mount once
 * (Layout.tsx) — it manages its own open state so every screen gets the same
 * entry point without prop drilling.
 *
 * The panel stays mounted at all times (never unmounted) so the conversation
 * survives closing/reopening within a session, and so open/close can animate
 * both ways. `inert` takes it out of the tab order and off-limits to pointer
 * events while closed — the modern, dependency-free way to hide an
 * always-mounted panel from assistive tech (React 19 supports it as a prop).
 */
export function AIAssistant() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <AskAIButton ref={triggerRef} open={open} onClick={() => setOpen((v) => !v)} />

      {/* Click-outside catcher: dims the screen on mobile (where the panel is
          full-height and there's nothing else to click), invisible on desktop
          (where the panel floats over the still-usable page). */}
      <div
        aria-hidden="true"
        inert={!open}
        onClick={close}
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 md:bg-transparent",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Family AI Assistant"
        inert={!open}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] flex-col rounded-t-3xl border-t border-line bg-ink-950 shadow-pop",
          "transition-[transform,opacity] duration-300 ease-out",
          "md:inset-x-auto md:top-auto md:right-6 md:bottom-24 md:h-[34rem] md:w-96 md:origin-bottom-right md:rounded-2xl md:border md:shadow-pop",
          open
            ? "translate-y-0 opacity-100 md:scale-100"
            : "pointer-events-none translate-y-8 opacity-0 md:scale-95",
        )}
      >
        <div className="pt-safe flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-vault-500/15 text-vault-300">
              <Sparkles className="size-4" aria-hidden="true" />
            </span>
            <h2 className="text-base font-semibold text-fg">Family AI</h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close Family AI"
            className="flex size-9 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-white/5 active:scale-95"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <AIChat open={open} />
        </div>
      </div>
    </>
  );
}
