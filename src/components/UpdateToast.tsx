import { useEffect, useState } from "react";

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
    <div className="fixed inset-x-0 bottom-4 mx-auto flex w-fit items-center gap-3 rounded-xl border border-white/10 bg-ink-800 px-4 py-3 shadow-lg">
      <span className="text-sm text-slate-200">A new version is available.</span>
      <button
        onClick={() => update()}
        className="rounded-lg bg-vault-600 px-3 py-1 text-sm font-medium text-white hover:bg-vault-500"
      >
        Reload
      </button>
    </div>
  );
}
