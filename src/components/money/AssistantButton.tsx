import { Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";

/** Opens the money assistant sheet from the AppBar — never a floating FAB. */
export function AssistantButton() {
  const { activeFamilyId } = useAuth();

  const statusQ = useQuery({
    queryKey: ["assistant", "status"],
    queryFn: () =>
      api<{ configured: boolean; keyOk?: boolean; message?: string }>("/assistant/status"),
    staleTime: 5 * 60_000,
    retry: false,
    enabled: Boolean(activeFamilyId),
  });

  if (!activeFamilyId || !statusQ.data?.configured) return null;

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("family-vault:open-assistant"))}
      aria-label="Ask the money assistant"
      className={cn(
        "liquid-press flex size-11 shrink-0 items-center justify-center rounded-full",
        "text-vault-300 hover:bg-vault-400/15 hover:text-vault-200",
      )}
    >
      <Sparkles className="size-5" aria-hidden="true" />
    </button>
  );
}
