/**
 * Haptic feedback for the PWA — the small touches that make a web app feel native.
 *
 * Uses the Vibration API and no-ops cleanly where it's absent (notably iOS Safari)
 * or disabled by the user, so callers never have to branch. When the app is later
 * wrapped for iOS/Android (Capacitor), swap the `vibrate` call for the Haptics
 * plugin here — this is the single chokepoint.
 */
export type HapticPattern =
  | "selection" // light: moving across options, toggles
  | "tap" // standard: a committed tap / long-press fire
  | "success" // a save / create succeeded
  | "warning" // a guarded action
  | "error"; // a failure / rejected action

const PATTERNS: Record<HapticPattern, number | number[]> = {
  selection: 8,
  tap: 12,
  success: [10, 40, 10],
  warning: [20, 60, 20],
  error: [40, 80, 40, 80, 40],
};

let enabled = true;

/** Toggle all haptics (wire to a Settings preference). Default on. */
export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

/** Fire a haptic pattern. Safe to call anywhere — feature-detected and guarded. */
export function haptic(pattern: HapticPattern = "tap"): void {
  if (!enabled) return;
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    // vibrate() can throw if invoked outside a user-activation context — ignore.
  }
}
