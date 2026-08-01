import { SendHorizontal } from "lucide-react";
import { forwardRef, useEffect, useRef } from "react";

const MAX_LENGTH = 2000;

export const AIInput = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (value: string) => void;
    onSend: () => void;
    disabled?: boolean;
    autoFocusKey?: boolean;
  }
>(function AIInput({ value, onChange, onSend, disabled, autoFocusKey }, ref) {
  const innerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocusKey) innerRef.current?.focus();
  }, [autoFocusKey]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSend();
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() && !disabled) onSend();
      }}
      className="flex items-end gap-2 border-t border-line bg-ink-950 p-3"
    >
      <textarea
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_LENGTH))}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything…"
        aria-label="Message the AI Assistant"
        rows={1}
        maxLength={MAX_LENGTH}
        disabled={disabled}
        className="max-h-[120px] min-h-11 flex-1 resize-none rounded-2xl border border-line bg-surface px-4 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-vault-500 focus:outline-none disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={!value.trim() || disabled}
        aria-label="Send message"
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-vault-600 text-white transition-colors hover:bg-vault-500 disabled:opacity-40"
      >
        <SendHorizontal className="size-5" aria-hidden="true" />
      </button>
    </form>
  );
});
