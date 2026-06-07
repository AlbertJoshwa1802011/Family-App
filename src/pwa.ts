import { registerSW } from "virtual:pwa-register";

/**
 * Registers the service worker with a "prompt" update strategy.
 * `onNeedRefresh` fires when a new version is waiting — we surface it via a
 * window event so a React toast can offer "Reload".
 */
export function setupPWA() {
  const updateSW = registerSW({
    onNeedRefresh() {
      window.dispatchEvent(
        new CustomEvent("pwa:need-refresh", {
          detail: { update: () => updateSW(true) },
        }),
      );
    },
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent("pwa:offline-ready"));
    },
  });
}
