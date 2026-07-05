import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { MessageCircle, SendHorizontal, Trash2 } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Avatar } from "../components/ui/Avatar";
import { EmptyState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/cn";

interface ChatMessage {
  id: string;
  userId: string;
  body: string;
  createdAt: number;
  deleted: boolean;
  authorName: string | null;
  authorEmail: string | null;
  authorPicture: string | null;
}

const POLL_MS = 5000;

function formatTime(unixSec: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(unixSec * 1000));
}

function formatDay(unixSec: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(unixSec * 1000));
}

function dayKey(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function Chat() {
  const { user, activeFamily } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMessageId = useRef<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["chat", activeFamily?.id],
    queryFn: () =>
      api<{ messages: ChatMessage[]; hasMore: boolean }>(
        `/chat?familyId=${activeFamily!.id}`,
      ),
    enabled: Boolean(activeFamily),
    // Polling keeps the family in sync without websockets; 5s feels live
    // enough for a family chat and is cheap on the Worker.
    refetchInterval: POLL_MS,
  });

  const messages = data?.messages ?? [];
  const newestId = messages[messages.length - 1]?.id ?? null;

  // Auto-scroll when new messages arrive (or on first load).
  useEffect(() => {
    if (newestId !== lastMessageId.current) {
      lastMessageId.current = newestId;
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [newestId]);

  const send = useMutation({
    mutationFn: (body: string) =>
      api<{ message: ChatMessage }>("/chat", {
        method: "POST",
        body: JSON.stringify({ familyId: activeFamily!.id, body }),
      }),
    onSuccess: () => {
      setDraft("");
      void qc.invalidateQueries({ queryKey: ["chat", activeFamily?.id] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/chat/${id}`, { method: "DELETE" }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["chat", activeFamily?.id] }),
  });

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || send.isPending) return;
    send.mutate(body);
  }

  return (
    <>
      <AppBar title={`${activeFamily?.name ?? "Family"} chat`} />
      {/* Full-height column: scrollable thread + composer, clearing the fixed
          bottom nav (~4.5rem) and the sticky app bar (3.5rem). */}
      <div className="mx-auto flex h-[calc(100dvh-8rem)] max-w-md flex-col px-4">
        <div className="flex-1 space-y-1 overflow-y-auto py-4 pb-2">
          {isLoading ? (
            <div className="space-y-3" aria-busy="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className={cn("h-12 w-3/5 rounded-2xl", i % 2 === 1 && "ml-auto")}
                />
              ))}
            </div>
          ) : messages.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title="Say hi 👋"
              description="This is your family's private space. Messages are only visible to family members."
            />
          ) : (
            messages.map((m, i) => {
              const mine = m.userId === user?.id;
              const prev = messages[i - 1];
              const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
              const sameAuthorAsPrev =
                prev && prev.userId === m.userId && !newDay;

              return (
                <div key={m.id}>
                  {newDay && (
                    <div className="my-3 text-center text-xs text-fg-subtle">
                      {formatDay(m.createdAt)}
                    </div>
                  )}
                  <div
                    className={cn(
                      "group flex items-end gap-2",
                      mine && "flex-row-reverse",
                      sameAuthorAsPrev ? "mt-0.5" : "mt-3",
                    )}
                  >
                    {!mine && (
                      <span className="w-7 shrink-0">
                        {!sameAuthorAsPrev && (
                          <Avatar
                            name={m.authorName}
                            email={m.authorEmail}
                            src={m.authorPicture}
                            className="size-7"
                          />
                        )}
                      </span>
                    )}
                    <div
                      className={cn(
                        "max-w-[75%] rounded-2xl px-3.5 py-2",
                        mine
                          ? "rounded-br-md bg-vault-600 text-white"
                          : "rounded-bl-md border border-line bg-surface text-fg",
                      )}
                    >
                      {!mine && !sameAuthorAsPrev && (
                        <div className="mb-0.5 text-xs font-semibold text-vault-300">
                          {m.authorName ?? m.authorEmail ?? "Member"}
                        </div>
                      )}
                      {m.deleted ? (
                        <p className="text-sm italic opacity-60">
                          Message deleted
                        </p>
                      ) : (
                        <p className="text-sm break-words whitespace-pre-wrap">
                          {m.body}
                        </p>
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
                    {mine && !m.deleted && (
                      <button
                        onClick={() => remove.mutate(m.id)}
                        aria-label="Delete message"
                        className="mb-1 hidden text-fg-subtle group-hover:block hover:text-danger"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={handleSend}
          className="flex items-center gap-2 border-t border-line bg-ink-950 py-3"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message your family…"
            aria-label="Message"
            maxLength={4000}
            className="min-h-11 flex-1 rounded-full border border-line bg-surface px-4 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim() || send.isPending}
            aria-label="Send message"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-vault-600 text-white transition-colors hover:bg-vault-500 disabled:opacity-40"
          >
            <SendHorizontal className="size-5" />
          </button>
        </form>
      </div>
    </>
  );
}
