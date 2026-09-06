import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SendHorizontal, Sparkles } from "lucide-react";
import { EmptyState } from "./ui/EmptyState";
import { Skeleton } from "./ui/Skeleton";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/cn";

export interface AssistantAction {
  tool: string;
  summary: string;
  id?: string;
  href?: string;
}

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  body: string;
  createdAt: number;
  actions: AssistantAction[] | null;
}

const SUGGESTIONS = [
  "What's on my plate this week?",
  "Add 100 for outside snacks",
  "Any tasks due soon?",
  "How much have we spent this month?",
];

function formatTime(unixSec: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(unixSec * 1000));
}

export function AssistantThread({
  compact = false,
  onNavigate,
}: {
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const { activeFamily } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastId = useRef<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["assistant", activeFamily?.id],
    queryFn: () =>
      api<{ messages: AssistantMessage[]; configured: boolean }>(
        `/assistant?familyId=${activeFamily!.id}`,
      ),
    enabled: Boolean(activeFamily),
  });

  const messages = data?.messages ?? [];
  const configured = data?.configured ?? true;
  const newestId = messages[messages.length - 1]?.id ?? null;

  useEffect(() => {
    if (newestId !== lastId.current) {
      lastId.current = newestId;
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [newestId]);

  const send = useMutation({
    mutationFn: (message: string) =>
      api<{ reply: string; actions: AssistantAction[]; message: AssistantMessage }>(
        "/assistant",
        {
          method: "POST",
          body: JSON.stringify({ familyId: activeFamily!.id, message }),
        },
      ),
    onSuccess: () => {
      setDraft("");
      void qc.invalidateQueries({ queryKey: ["assistant", activeFamily?.id] });
      void qc.invalidateQueries({ queryKey: ["expenses"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["events"] });
      void qc.invalidateQueries({ queryKey: ["contacts"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || send.isPending) return;
    send.mutate(body);
  }

  const sendError =
    send.error instanceof ApiError ? send.error.message : send.error?.message;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto py-3">
        {isLoading ? (
          <div className="space-y-3 px-1" aria-busy="true">
            {Array.from({ length: compact ? 3 : 4 }).map((_, i) => (
              <Skeleton
                key={i}
                className={cn("h-12 w-3/5 rounded-2xl", i % 2 === 0 && "ml-auto")}
              />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="Ask me anything"
            description={
              configured
                ? "I already know your family — documents, tasks, events, and spending. Try “add 100 for snacks” or “what’s expiring?”"
                : "The assistant needs a Gemini API key on the server before it can chat (Anthropic works as a fallback). You can still browse the rest of the app."
            }
          />
        ) : (
          messages.map((m) => {
            const mine = m.role === "user";
            return (
              <div
                key={m.id}
                className={cn("mt-3 flex", mine && "flex-row-reverse")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-bubble px-3.5 py-2",
                    mine
                      ? "lq lq-primary rounded-br-md"
                      : "lq lq-flat rounded-bl-md text-fg",
                  )}
                >
                  <p className="text-sm break-words whitespace-pre-wrap">{m.body}</p>
                  {m.actions && m.actions.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {m.actions.map((a, i) => (
                        <ActionChip
                          key={`${a.tool}-${i}`}
                          action={a}
                          mine={mine}
                          onNavigate={onNavigate}
                        />
                      ))}
                    </div>
                  )}
                  <div
                    className={cn(
                      "mt-0.5 text-right text-[10px]",
                      mine ? "text-white/60" : "text-fg-subtle",
                    )}
                  >
                    {formatTime(m.createdAt)}
                  </div>
                </div>
              </div>
            );
          })
        )}
        {send.isPending && (
          <div className="mt-3 flex">
            <div className="lq lq-flat rounded-bubble rounded-bl-md px-3.5 py-2 text-sm text-fg-muted">
              Thinking…
            </div>
          </div>
        )}
        {sendError && (
          <p className="mt-2 text-center text-xs text-danger">{sendError}</p>
        )}
        <div ref={bottomRef} />
      </div>

      {configured && messages.length === 0 && (
        <div className="flex flex-wrap gap-2 pb-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send.mutate(s)}
              disabled={send.isPending}
              className="lq lq-flat lq-press rounded-full px-3.5 py-1.5 text-xs font-medium text-fg-muted hover:text-fg"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={handleSend}
        className="flex items-center gap-2 pt-3"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={configured ? "Ask or tell me what to do…" : "Assistant isn’t configured"}
          aria-label="Message the assistant"
          maxLength={2000}
          disabled={!configured}
          className="lq lq-field min-h-11 flex-1 rounded-full px-4 text-sm text-fg placeholder:text-fg-subtle focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!configured || !draft.trim() || send.isPending}
          aria-label="Send"
          className="lq lq-raised lq-primary lq-press flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
        >
          <SendHorizontal className="size-5" />
        </button>
      </form>
    </div>
  );
}

function ActionChip({
  action,
  mine,
  onNavigate,
}: {
  action: AssistantAction;
  mine: boolean;
  onNavigate?: () => void;
}) {
  const className = cn(
    "block rounded-full px-2.5 py-1 text-xs font-semibold",
    mine
      ? "bg-white/20 text-white"
      : "lq lq-flat lq-tint text-vault-300 [--lq-tint:var(--color-vault-400)]",
  );
  if (action.href) {
    return (
      <Link to={action.href} className={className} onClick={onNavigate}>
        {action.summary}
      </Link>
    );
  }
  return <div className={className}>{action.summary}</div>;
}
