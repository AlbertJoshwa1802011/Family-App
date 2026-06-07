import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/** Listens for the PWA "new version available" event and offers a reload. */
export function UpdateToast() {
  const [update, setUpdate] = useState<(() => void) | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ update: () => void }>).detail;
      setUpdate(() => detail.update);
    };
    window.addEventListener("pwa:need-refresh", handler);
    return () => window.removeEventListener("pwa:need-refresh", handler);
  }, []);

  if (!update) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-24 z-40 mx-auto flex w-[calc(100%-2rem)] max-w-sm items-center gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3 shadow-pop"
    >
      <RefreshCw className="size-5 shrink-0 text-vault-300" aria-hidden="true" />
      <span className="flex-1 text-sm text-fg">A new version is available.</span>
      <button
        onClick={() => update()}
        className="min-h-9 rounded-lg bg-vault-600 px-3 text-sm font-medium text-white transition-transform active:scale-95"
      >
        Reload
      </button>
    </div>
  );
}
