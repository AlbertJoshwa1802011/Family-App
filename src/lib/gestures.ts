/**
 * Pure, framework-free gesture math. Kept separate from the React hooks
 * (`src/hooks/useGestures.ts`) so the tricky thresholds are unit-testable in plain
 * Node — no jsdom, no fake pointer events. The hooks are a thin pointer-event shell
 * over these functions.
 */

export type SwipeDirection = "left" | "right" | "up" | "down";

export interface SwipeOptions {
  /** Minimum primary-axis travel (px) to count as a swipe. */
  threshold?: number;
  /** Maximum perpendicular drift (px) allowed for a "clean" swipe. */
  restraint?: number;
}

export const DEFAULT_SWIPE: Required<SwipeOptions> = { threshold: 48, restraint: 36 };

/**
 * Resolve a pointer delta into a swipe direction, or `null` if it doesn't qualify
 * (too short, or too diagonal). Horizontal and vertical are mutually exclusive: a
 * gesture must stay within `restraint` on the off-axis to register.
 */
export function swipeDirection(dx: number, dy: number, opts: SwipeOptions = {}): SwipeDirection | null {
  const { threshold, restraint } = { ...DEFAULT_SWIPE, ...opts };
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX >= threshold && absY <= restraint) return dx < 0 ? "left" : "right";
  if (absY >= threshold && absX <= restraint) return dy < 0 ? "up" : "down";
  return null;
}

export interface TapPoint {
  t: number; // timestamp (ms)
  x: number;
  y: number;
}

/**
 * True when `next` follows `prev` closely enough in BOTH time and space to be a
 * double-tap (rather than two unrelated taps). Space check rejects the common
 * false positive of tapping two different list rows quickly.
 */
export function isDoubleTap(
  prev: TapPoint | null,
  next: TapPoint,
  windowMs = 300,
  slopPx = 24,
): boolean {
  if (!prev) return false;
  return (
    next.t - prev.t <= windowMs &&
    Math.abs(next.x - prev.x) <= slopPx &&
    Math.abs(next.y - prev.y) <= slopPx
  );
}

/** Whether a pointer moved beyond the press "slop" — used to cancel a long-press
 *  the moment a drag/scroll begins, so scrolling never triggers a long-press. */
export function exceededSlop(dx: number, dy: number, slopPx = 10): boolean {
  return Math.abs(dx) > slopPx || Math.abs(dy) > slopPx;
}
