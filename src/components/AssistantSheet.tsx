import { useEffect } from "react";
import { X } from "lucide-react";
import { AssistantThread } from "./AssistantThread";
import { useAssistantUi } from "../context/AssistantUiContext";

export function AssistantSheet() {
  const { open, setOpen } = useAssistantUi();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        className="absolute inset-0 bg-black/55"
        aria-label="Dismiss assistant overlay"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-sheet-title"
        className="pb-safe absolute inset-x-0 bottom-0 mx-auto flex h-[min(78dvh,640px)] max-w-md flex-col rounded-t-3xl border border-line bg-ink-950 px-4 shadow-[0_-12px_40px_-12px_black]"
      >
        <div className="flex items-center gap-2 py-2">
          <h2
            id="assistant-sheet-title"
            className="flex-1 px-1 text-base font-semibold text-fg"
          >
            Assistant
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close assistant"
            className="flex size-11 items-center justify-center rounded-full text-fg-muted hover:bg-white/5"
          >
            <X className="size-5" />
          </button>
        </div>
        <AssistantThread compact onNavigate={() => setOpen(false)} />
      </div>
    </div>
  );
}
