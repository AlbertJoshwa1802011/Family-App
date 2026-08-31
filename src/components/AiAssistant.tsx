import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, Sparkles, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../lib/api";
import { cn } from "../lib/cn";
import { Button } from "./ui/Button";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatResponse {
  reply: string;
  toolCalls?: { name: string; args: Record<string, unknown> }[];
}

/**
 * Floating AI chat for expense coaching / quick logging.
 * Mount on Expenses (or AppShell). Uses POST /ai/chat.
 */
export function AiAssistant({ className }: { className?: string }) {
  const { activeFamilyId } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const send = useMutation({
    mutationFn: async (message: string) => {
      if (!activeFamilyId) throw new Error("No family selected.");
      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      return api<ChatResponse>("/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          familyId: activeFamilyId,
          message,
          history,
        }),
      });
    },
    onMutate: (message) => {
      setMessages((prev) => [...prev, { role: "user", content: message }]);
      setInput("");
    },
    onSuccess: async (res) => {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.reply },
      ]);
      const tools = res.toolCalls ?? [];
      if (
        tools.some((t) =>
          ["add_expense", "add_wishlist_item", "get_expense_summary"].includes(
            t.name,
          ),
        )
      ) {
        await qc.invalidateQueries({ queryKey: ["expenses"] });
      }
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({
          top: listRef.current.scrollHeight,
          behavior: "smooth",
        });
      });
    },
    onError: (_err, message) => {
      // Roll back optimistic user bubble on failure.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "user" && last.content === message) {
          return prev.slice(0, -1);
        }
        return prev;
      });
      setInput(message);
    },
  });

  if (!activeFamilyId) return null;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || send.isPending) return;
    send.mutate(text);
  }

  const errorMessage =
    send.error instanceof ApiError && send.error.message === "ai_unavailable"
      ? "Add GEMINI_API_KEY to enable AI"
      : send.error instanceof Error
        ? send.error.message
        : null;

  return (
    <>
      <button
        type="button"
        aria-label="Open AI assistant"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed right-4 bottom-40 z-30 flex size-12 items-center justify-center rounded-full",
          "border border-line bg-surface-2 text-vault-300 shadow-pop",
          "transition-transform duration-150 ease-out active:scale-90",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vault-400",
          className,
        )}
      >
        <Sparkles className="size-5" aria-hidden="true" />
      </button>

      {open &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <div
              role="dialog"
              aria-label="AI assistant"
              className={cn(
                "pb-safe fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col",
                "rounded-t-3xl border border-line bg-surface shadow-pop",
                "animate-[slideUp_220ms_cubic-bezier(0.22,1,0.36,1)]",
                "md:inset-x-auto md:right-4 md:bottom-4 md:w-[380px] md:rounded-2xl",
              )}
            >
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-vault-300" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-fg">AI assistant</h2>
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setOpen(false)}
                  className="flex size-9 items-center justify-center rounded-full text-fg-muted hover:bg-white/5"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div
                ref={listRef}
                className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
              >
                {messages.length === 0 && (
                  <p className="text-sm text-fg-muted">
                    Ask about your budget, log a quick expense, or get spend tips.
                  </p>
                )}
                {messages.map((m, i) => (
                  <div
                    key={`${m.role}-${i}`}
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                      m.role === "user"
                        ? "ml-auto bg-vault-600 text-white"
                        : "bg-ink-950 text-fg border border-line",
                    )}
                  >
                    {m.content}
                  </div>
                ))}
                {send.isPending && (
                  <p className="text-xs text-fg-subtle">Thinking…</p>
                )}
                {errorMessage && (
                  <p role="alert" className="text-sm text-danger">
                    {errorMessage}
                  </p>
                )}
              </div>

              <form
                onSubmit={onSubmit}
                className="flex gap-2 border-t border-line px-3 py-3"
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Message…"
                  disabled={send.isPending}
                  className="min-w-0 flex-1 rounded-xl border border-line bg-ink-950 px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
                />
                <Button
                  type="submit"
                  disabled={!input.trim()}
                  loading={send.isPending}
                  aria-label="Send"
                  className="!min-h-11 !px-3"
                >
                  <Send className="size-4" aria-hidden="true" />
                </Button>
              </form>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
