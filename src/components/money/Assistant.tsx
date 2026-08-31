import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownLeft, Sparkles, X } from "lucide-react";
import { Button } from "../ui/Button";
import { useAuth } from "../../context/AuthContext";
import { api, ApiError } from "../../lib/api";
import { cn } from "../../lib/cn";

interface Turn {
  role: "user" | "model";
  text: string;
}

const SUGGESTIONS = [
  "I spent 70 on noodles",
  "How much can I spend today?",
  "What are my commitments?",
];

/**
 * Floating assistant.
 *
 * Hidden entirely unless the server reports a Gemini key is configured, so the
 * UI never advertises something that will fail.
 *
 * Portalled to <body> for the same reason the account menu is: the AppBar's
 * backdrop-filter would otherwise become the containing block for the panel.
 */
export function Assistant() {
  const { activeFamilyId } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const statusQ = useQuery({
    queryKey: ["assistant", "status"],
    queryFn: () => api<{ configured: boolean }>("/assistant/status"),
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Keep the newest turn in view as the conversation grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!statusQ.data?.configured || !activeFamilyId) return null;

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;

    setError(null);
    setInput("");
    const history = turns.slice(-10);
    setTurns((t) => [...t, { role: "user", text: message }]);
    setBusy(true);

    try {
      const res = await api<{ reply: string; actions: { name: string }[] }>("/assistant/chat", {
        method: "POST",
        body: JSON.stringify({ familyId: activeFamilyId, message, history }),
      });
      setTurns((t) => [...t, { role: "model", text: res.reply || "Done." }]);

      // Any tool that writes should refresh what's on screen behind the sheet.
      if (res.actions.some((a) => a.name.startsWith("add_"))) {
        await qc.invalidateQueries({ queryKey: ["expenses"] });
        await qc.invalidateQueries({ queryKey: ["finance"] });
        await qc.invalidateQueries({ queryKey: ["wishlist"] });
      }
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 501
          ? "The assistant isn't set up yet."
          : "The assistant couldn't answer. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask the money assistant"
        className={cn(
          "pb-safe fixed right-4 bottom-20 z-30 flex size-12 items-center justify-center rounded-full",
          "bg-m3-purple text-white shadow-[0_6px_24px_-8px_var(--color-m3-purple)]",
          "transition-transform active:scale-95 md:bottom-6",
        )}
      >
        <Sparkles className="size-5" aria-hidden="true" />
      </button>

      {open &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Close assistant"
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Money assistant"
              className={cn(
                "pb-safe fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-3xl",
                "border border-line bg-surface shadow-pop",
                "animate-[slideUp_220ms_cubic-bezier(0.22,1,0.36,1)]",
                "md:inset-x-auto md:right-4 md:bottom-4 md:w-96 md:rounded-3xl",
              )}
            >
              <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                <Sparkles className="size-4 text-m3-purple" aria-hidden="true" />
                <h2 className="flex-1 text-sm font-semibold text-fg">Money assistant</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex size-9 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-white/5"
                >
                  <X className="size-5" />
                </button>
              </div>

              <div ref={scrollRef} className="min-h-40 flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {turns.length === 0 && (
                  <div className="space-y-3">
                    <p className="text-sm text-fg-muted">
                      Tell me what you spent and I'll record it, or ask how you're doing this month.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => send(s)}
                          className="rounded-full border border-line px-3 py-1.5 text-xs text-fg-muted transition-colors hover:bg-white/5"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {turns.map((t, i) => (
                  <div
                    key={i}
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm",
                      t.role === "user"
                        ? "ml-auto bg-vault-600/25 text-fg"
                        : "bg-ink-950/60 text-fg-muted",
                    )}
                  >
                    {t.text}
                  </div>
                ))}

                {busy && (
                  <div className="max-w-[85%] rounded-2xl bg-ink-950/60 px-3.5 py-2.5">
                    <span className="flex gap-1" aria-label="Thinking">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="size-1.5 animate-pulse rounded-full bg-fg-subtle"
                          style={{ animationDelay: `${i * 150}ms` }}
                        />
                      ))}
                    </span>
                  </div>
                )}

                {error && (
                  <p role="alert" className="text-xs text-danger">
                    {error}
                  </p>
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
                className="flex items-center gap-2 border-t border-line px-4 py-3"
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="I spent 70 on noodles…"
                  aria-label="Message the assistant"
                  className="flex-1 rounded-xl border border-line bg-ink-950 px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
                />
                <Button type="submit" loading={busy} aria-label="Send">
                  <CornerDownLeft className="size-4" />
                </Button>
              </form>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
