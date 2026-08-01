import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { RotateCcw, Sparkles } from "lucide-react";
import { AIMessage, AIThinking, type AIMessageData } from "./AIMessage";
import { AISuggestions } from "./AISuggestions";
import { AIInput } from "./AIInput";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";

// Mirrors the server's MAX_HISTORY_MESSAGES (worker/lib/ai/prompts.ts) — sending
// more than the server will accept just wastes a validation round trip.
const MAX_HISTORY = 20;

interface ChatResponse {
  reply: string;
}

/** The conversation itself: message list, suggestions, input, loading/error states. */
export function AIChat({ open }: { open: boolean }) {
  const { activeFamily } = useAuth();
  const [messages, setMessages] = useState<AIMessageData[]>([]);
  const [draft, setDraft] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastFailedMessage = useRef<string | null>(null);

  const send = useMutation({
    mutationFn: async (text: string) => {
      const history = messages.slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content }));
      return api<ChatResponse>("/ai/chat", {
        method: "POST",
        body: JSON.stringify({ familyId: activeFamily!.id, message: text, history }),
      });
    },
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: data.reply }]);
      setErrorText(null);
      lastFailedMessage.current = null;
    },
    onError: (err, text) => {
      lastFailedMessage.current = text;
      setErrorText(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, send.isPending]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || send.isPending || !activeFamily) return;
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: trimmed }]);
    setDraft("");
    setErrorText(null);
    send.mutate(trimmed);
  }

  function retry() {
    if (lastFailedMessage.current) send.mutate(lastFailedMessage.current);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col justify-end gap-5">
            <div className="flex items-start gap-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-vault-500/15 text-vault-300">
                <Sparkles className="size-3.5" aria-hidden="true" />
              </span>
              <div className="max-w-[80%] rounded-2xl rounded-bl-md border border-line bg-surface px-3.5 py-2.5 text-sm text-fg">
                Hi! I'm your family's AI assistant. Ask me about upcoming events, expiring
                documents, or open tasks — or anything else you'd like help with.
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-fg-subtle">Try asking</p>
              <AISuggestions onPick={submit} />
            </div>
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <AIMessage key={m.id} message={m} />
            ))}
            {send.isPending && <AIThinking />}
            {errorText && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-fg">
                <span>{errorText}</span>
                <button
                  type="button"
                  onClick={retry}
                  className="flex shrink-0 items-center gap-1 text-sm font-semibold text-vault-300 hover:text-vault-200"
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Retry
                </button>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>
      <AIInput
        value={draft}
        onChange={setDraft}
        onSend={() => submit(draft)}
        disabled={send.isPending}
        autoFocusKey={open}
      />
    </div>
  );
}
