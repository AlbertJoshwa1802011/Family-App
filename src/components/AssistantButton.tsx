import { Sparkles } from "lucide-react";
import { useLocation } from "react-router-dom";
import { cn } from "../lib/cn";
import { useAssistantUi } from "../context/AssistantUiContext";
import { useAuth } from "../context/AuthContext";

/** Header sparkles control — opens the assistant sheet on every screen. */
export function AssistantButton() {
  const { pathname } = useLocation();
  const { activeFamily } = useAuth();
  const { open, toggle } = useAssistantUi();

  if (!activeFamily || pathname === "/assistant") return null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Ask the assistant"
      aria-pressed={open}
      className={cn(
        "lq-press flex size-10 shrink-0 items-center justify-center rounded-full",
        open
          ? "lq lq-tint text-vault-200 [--lq-tint:var(--color-vault-400)]"
          : "text-vault-300 hover:bg-vault-400/15",
      )}
    >
      <Sparkles className="size-5" aria-hidden="true" />
    </button>
  );
}
