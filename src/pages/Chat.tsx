import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Avatar } from "../components/ui/Avatar";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../lib/cn";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface Message {
  id: string;
  userId: string;
  body: string;
  createdAt: number;
  authorName?: string | null;
  authorPicture?: string | null;
}

function dayLabel(epochSecs: number): string {
  const d = new Date(epochSecs * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (same(d, today)) return "Today";
  if (same(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function timeLabel(epochSecs: number): string {
  return new Date(epochSecs * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function Chat() {
  const { families, user } = useAuth();
  const familyId = families[0]?.id;
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["messages", familyId],
    queryFn: () => api<{ messages: Message[] }>(`/messages?familyId=${familyId}`),
    enabled: Boolean(familyId),
    // Near-real-time: poll while the thread is open.
    refetchInterval: 4000,
  });
  const messages = data?.messages ?? [];

  const send = useMutation({
    mutationFn: (body: string) =>
      api<{ message: Message }>("/messages", {
        method: "POST",
        body: JSON.stringify({ familyId, body }),
      }),
    onSuccess: (res) => {
      qc.setQueryData<{ messages: Message[] }>(["messages", familyId], (cur) => {
        const list = cur?.messages ?? [];
        if (list.some((m) => m.id === res.message.id)) return cur;
        return { messages: [...list, res.message] };
      });
      setText("");
    },
  });

  // Keep pinned to the latest message.
  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // Focus-friendly: scroll on mount once loaded.
  useEffect(() => {
    if (!isLoading) bottomRef.current?.scrollIntoView();
  }, [isLoading]);

  function submit() {
    const body = text.trim();
    if (!body || send.isPending) return;
    send.mutate(body);
  }

  let lastDay = "";

  return (
    <div className="flex h-dvh flex-col">
      <AppBar title="Family chat" back />

      <div
        ref={scrollRef}
        className="flex-1 space-y-1 overflow-y-auto px-3 py-4"
      >
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-fg-muted">
            <Spinner />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-vault-500/10 text-vault-300">
              <MessageCircle className="size-7" />
            </span>
            <h2 className="mt-4 font-semibold text-fg">Say hello 👋</h2>
            <p className="mt-1 text-sm text-fg-muted">
              This is your family's private chat. Messages stay between you.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.userId === user?.id;
            const day = dayLabel(m.createdAt);
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <div key={m.id}>
                {showDay && (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full bg-surface-2 px-3 py-1 text-[11px] font-medium text-fg-subtle">
                      {day}
                    </span>
                  </div>
                )}
                <div
                  className={cn(
                    "flex items-end gap-2",
                    mine ? "justify-end" : "justify-start",
                  )}
                >
                  {!mine && (
                    <Avatar
                      name={m.authorName}
                      src={m.authorPicture}
                      className="size-7 shrink-0"
                    />
                  )}
                  <div
                    className={cn(
                      "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm",
                      mine
                        ? "rounded-br-md bg-vault-600 text-white"
                        : "rounded-bl-md bg-surface-2 text-fg",
                    )}
                  >
                    {!mine && (
                      <div className="mb-0.5 text-xs font-semibold text-vault-300">
                        {m.authorName ?? "Someone"}
                      </div>
                    )}
                    <div className="break-words whitespace-pre-wrap">{m.body}</div>
                    <div
                      className={cn(
                        "mt-0.5 text-right text-[10px]",
                        mine ? "text-white/70" : "text-fg-subtle",
                      )}
                    >
                      {timeLabel(m.createdAt)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="pb-safe border-t border-line bg-ink-950/90 backdrop-blur-lg">
        <div className="mx-auto flex max-w-md items-end gap-2 px-3 py-2.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Message…"
            className="max-h-28 flex-1 resize-none rounded-2xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-vault-500/60"
          />
          <button
            onClick={submit}
            disabled={!text.trim() || send.isPending}
            aria-label="Send message"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-vault-600 text-white transition-transform active:scale-90 disabled:opacity-40"
          >
            <Send className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
