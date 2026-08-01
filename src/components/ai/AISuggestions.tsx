const SUGGESTIONS = [
  "What's expiring soon?",
  "What's coming up this week?",
  "What do I still need to do?",
  "Give me ideas to save money",
];

export function AISuggestions({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {SUGGESTIONS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className="min-h-9 rounded-full border border-line bg-surface px-3.5 text-sm text-fg-muted transition-colors hover:border-vault-500 hover:text-fg active:scale-[0.97]"
        >
          {s}
        </button>
      ))}
    </div>
  );
}
