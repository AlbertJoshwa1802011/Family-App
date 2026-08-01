import { Sparkles } from "lucide-react";
import { cn } from "../../lib/cn";
import { renderAIContent } from "../../lib/aiMarkdown";

export interface AIMessageData {
  id: string;
  role: "user" | "assistant";
  content: string;
}

function AIAvatar() {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-vault-500/15 text-vault-300">
      <Sparkles className="size-3.5" aria-hidden="true" />
    </span>
  );
}

export function AIMessage({ message }: { message: AIMessageData }) {
  const mine = message.role === "user";

  return (
    <div className={cn("flex items-end gap-2", mine && "flex-row-reverse")}>
      {!mine && (
        <span className="w-7 shrink-0">
          <AIAvatar />
        </span>
      )}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
          mine
            ? "rounded-br-md bg-vault-600 text-white"
            : "rounded-bl-md border border-line bg-surface text-fg",
        )}
      >
        {mine ? (
          <p className="break-words whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="space-y-1 break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            {renderAIContent(message.content)}
          </div>
        )}
      </div>
    </div>
  );
}

export function AIThinking() {
  return (
    <div className="flex items-end gap-2">
      <span className="w-7 shrink-0">
        <AIAvatar />
      </span>
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-line bg-surface px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-bounce rounded-full bg-fg-subtle"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
