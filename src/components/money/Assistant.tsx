import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownLeft, Sparkles, X } from "lucide-react";
import { Button } from "../ui/Button";
import { useAuth } from "../../context/AuthContext";
import { ApiError } from "../../lib/api";
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
 * Money assistant sheet (no floating trigger).
 *
 * The sparkles control lives in the AppBar (`AssistantButton`) so it never
 * covers primary FABs (Add event / Add task / Add expense) or form CTAs.
 * Overview "Ask AI" and the header button open this sheet via
 * `family-vault:open-assistant`.
 *
 * Hidden entirely unless the server reports a Gemini key is configured.
 * Portalled to <body> so the AppBar's backdrop-filter is not the containing
 * block for the panel.
 */
export function Assistant() {
  const { activeFamilyId } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const statusQ = useQuery({
    queryKey: ["assistant", "status"],
    queryFn: () =>
      api<{ configured: boolean; keyOk?: boolean; message?: string }>("/assistant/status"),
    staleTime: 5 * 60_000,
    retry: false,
  });

  // If the key is present but Gemini rejects it, probe once and surface why.
  const probeQ = useQuery({
    queryKey: ["assistant", "status", "probe"],
    queryFn: () =>
      api<{ configured: boolean; keyOk?: boolean; message?: string }>(
        "/assistant/status?probe=1",
      ),
    enabled: Boolean(statusQ.data?.configured),
    staleTime: 10 * 60_000,
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

  // Overview "Ask AI" CTA (and anything else) can open the sheet this way.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("family-vault:open-assistant", onOpen);
    return () => window.removeEventListener("family-vault:open-assistant", onOpen);
  }, []);

  // Lock background scroll while the sheet is open (iOS Safari otherwise scrolls the app).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Lift the sheet above the software keyboard on mobile browsers.
  useEffect(() => {
    if (!open || typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const sync = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardInset(inset > 40 ? inset : 0);
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      setKeyboardInset(0);
    };
  }, [open]);

  if (!statusQ.data?.configured || !activeFamilyId) return null;
  if (!open) return null;

  const keyWarning =
    probeQ.data?.configured && probeQ.data.keyOk === false
      ? probeQ.data.message ??
        "Gemini rejected this API key. Create a new one at aistudio.google.com/apikey."
      : null;

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;

    setError(null);
    setInput("");
    const history = turns.slice(-10);
    // Placeholder model bubble so tokens can append immediately.
    setTurns((t) => [...t, { role: "user", text: message }, { role: "model", text: "" }]);
    setBusy(true);

    const appendModel = (delta: string) => {
      // Clear "thinking" as soon as any reply text arrives.
      setBusy(false);
      setTurns((t) => {
        if (t.length === 0) return t;
        const next = t.slice();
        const last = next[next.length - 1];
        if (last?.role !== "model") return t;
        next[next.length - 1] = { role: "model", text: last.text + delta };
        return next;
      });
    };

    const finishModel = (reply: string) => {
      setBusy(false);
      setTurns((t) => {
        if (t.length === 0) return t;
        const next = t.slice();
        const last = next[next.length - 1];
        if (last?.role !== "model") return t;
        if (!last.text.trim()) {
          next[next.length - 1] = { role: "model", text: reply || "Done." };
        }
        return next;
      });
    };

    const fail = (msg: string) => {
      setError(msg);
      setBusy(false);
      setTurns((t) => {
        if (t.length === 0) return t;
        const last = t[t.length - 1];
        // Drop the empty placeholder bubble on error.
        if (last?.role === "model" && !last.text.trim()) return t.slice(0, -1);
        return t;
      });
    };

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ familyId: activeFamilyId, message, history }),
      });

      if (!res.ok) {
        let messageText = res.statusText;
        let code: string | undefined;
        try {
          const body = (await res.json()) as { error?: string; message?: string };
          code = body.error;
          messageText = body.message || body.error || messageText;
        } catch {
          // non-JSON
        }
        if (res.status === 501 || code === "not_configured") {
          fail("The assistant isn't set up yet.");
        } else if (messageText && messageText !== code) {
          fail(messageText);
        } else {
          fail("The assistant couldn't answer. Try again.");
        }
        return;
      }

      const ctype = res.headers.get("content-type") ?? "";
      let actions: { name: string }[] = [];

      if (ctype.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let sawToken = false;
        let streamError: string | null = null;

        const handleEvent = (raw: string) => {
          if (!raw) return;
          let ev: {
            type?: string;
            text?: string;
            reply?: string;
            actions?: { name: string }[];
            message?: string;
            error?: string;
          };
          try {
            ev = JSON.parse(raw) as typeof ev;
          } catch {
            return;
          }
          if (ev.type === "token" && typeof ev.text === "string" && ev.text) {
            sawToken = true;
            appendModel(ev.text);
          } else if (ev.type === "done") {
            actions = ev.actions ?? [];
            if (!sawToken) finishModel(ev.reply || "Done.");
            else setBusy(false);
          } else if (ev.type === "error") {
            streamError = ev.message || "The assistant couldn't answer. Try again.";
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            for (const line of chunk.split("\n")) {
              if (line.startsWith("data:")) handleEvent(line.slice(5).trim());
            }
          }
        }
        if (buffer.trim()) {
          for (const line of buffer.split("\n")) {
            if (line.startsWith("data:")) handleEvent(line.slice(5).trim());
          }
        }

        if (streamError) {
          fail(streamError);
          return;
        }
        setBusy(false);
      } else {
        // JSON fallback (non-stream clients / older workers).
        const body = (await res.json()) as {
          reply?: string;
          actions?: { name: string }[];
        };
        actions = body.actions ?? [];
        finishModel(body.reply || "Done.");
      }

      // Refresh lists behind the sheet without holding the thinking state.
      if (actions.some((a) => a.name.startsWith("add_"))) {
        void qc.invalidateQueries({ queryKey: ["expenses"] });
        void qc.invalidateQueries({ queryKey: ["finance"] });
        void qc.invalidateQueries({ queryKey: ["wishlist"] });
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 501) {
        fail("The assistant isn't set up yet.");
      } else if (e instanceof ApiError && e.message && e.message !== e.code) {
        fail(e.message);
      } else {
        fail("The assistant couldn't answer. Try again.");
      }
    }
  }

  return createPortal(
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
              style={keyboardInset ? { bottom: keyboardInset } : undefined}
              className={cn(
                // Edge-to-edge bottom sheet — do NOT use .liquid-bubble here: that
                // recipe forces 28px radius on all corners and leaves a gap above
                // the home indicator on phones.
                "fixed inset-x-0 bottom-0 z-50 flex max-h-[min(85vh,100dvh)] flex-col",
                "rounded-t-3xl border border-b-0 border-line bg-ink-950/95 shadow-pop",
                "backdrop-blur-2xl",
                "animate-[slideUp_220ms_cubic-bezier(0.22,1,0.36,1)]",
                "md:inset-x-auto md:right-4 md:bottom-4 md:w-96 md:max-h-[85vh] md:rounded-3xl md:border",
              )}
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
                <Sparkles className="size-4 text-m3-purple" aria-hidden="true" />
                <h2 className="flex-1 text-sm font-semibold text-fg">Money assistant</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex size-11 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-white/5"
                >
                  <X className="size-5" />
                </button>
              </div>

              <div ref={scrollRef} className="min-h-40 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
                {turns.length === 0 && (
                  <div className="space-y-3">
                    <p className="text-sm text-fg-muted">
                      Tell me what you spent and I'll record it, or ask how you're doing this month.
                    </p>
                    {keyWarning && (
                      <p role="alert" className="rounded-2xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                        {keyWarning}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => send(s)}
                          disabled={Boolean(keyWarning)}
                          className="rounded-full border border-line px-3 py-2 text-xs text-fg-muted transition-colors hover:bg-white/5 disabled:opacity-40"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {turns.map((t, i) =>
                  t.role === "model" && !t.text ? null : (
                    <div
                      key={i}
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm",
                        t.role === "user"
                          ? "ml-auto bg-vault-600/25 text-fg"
                          : "bg-ink-900/80 text-fg-muted",
                      )}
                    >
                      {t.text}
                    </div>
                  ),
                )}

                {busy &&
                  !(
                    turns.length > 0 &&
                    turns[turns.length - 1]?.role === "model" &&
                    turns[turns.length - 1]!.text.length > 0
                  ) && (
                  <div className="max-w-[85%] rounded-2xl bg-ink-900/80 px-3.5 py-2.5">
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
                className={cn(
                  "flex shrink-0 items-center gap-2 border-t border-line px-4 pt-3",
                  // Keep the composer clear of the home indicator when the keyboard is closed.
                  keyboardInset > 0
                    ? "pb-3"
                    : "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
                )}
              >
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="I spent 70 on noodles…"
                  aria-label="Message the assistant"
                  // text-base (≥16px) avoids iOS focus-zoom; liquid-field keeps the glass look.
                  className="liquid-field min-h-11 flex-1 rounded-2xl px-3.5 py-2.5 text-base text-fg placeholder:text-fg-subtle focus:outline-none"
                />
                <Button type="submit" loading={busy} aria-label="Send" className="size-11 shrink-0">
                  <CornerDownLeft className="size-4" />
                </Button>
              </form>
            </div>
          </>,
          document.body,
  );
}
