/**
 * Native-feel gesture hooks: long-press, double-tap, swipe. Pointer-event based so
 * one code path covers touch, pen, and mouse. Each hook returns a props object you
 * spread onto the target element:
 *
 *   const lp = useLongPress(() => openActions());
 *   <ListItem {...lp} />
 *
 * The gesture math lives in `src/lib/gestures.ts` (pure + tested); these hooks only
 * wire pointer events and haptics to it.
 */
import { useCallback, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { exceededSlop, isDoubleTap, swipeDirection } from "../lib/gestures";
import type { SwipeDirection, SwipeOptions } from "../lib/gestures";
import { haptic } from "../lib/haptics";

// ── useLongPress ──────────────────────────────────────────────────────────────

export interface LongPressOptions {
  /** Hold duration before firing (ms). */
  delayMs?: number;
  /** Fire a haptic when the press registers. Default true. */
  haptics?: boolean;
}

/**
 * Fires `onLongPress` after a sustained press, cancelling the moment the pointer
 * moves past the slop threshold (i.e. the user is scrolling) or releases early.
 * Suppresses the iOS text-callout / desktop context menu so the gesture owns the
 * interaction, the way a native long-press does.
 */
export function useLongPress(
  onLongPress: (e: ReactPointerEvent) => void,
  { delayMs = 500, haptics = true }: LongPressOptions = {},
) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return; // primary only
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        if (haptics) haptic("tap");
        onLongPress(e);
        timer.current = null;
      }, delayMs);
    },
    [onLongPress, delayMs, haptics],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!origin.current || timer.current === null) return;
      if (exceededSlop(e.clientX - origin.current.x, e.clientY - origin.current.y)) cancel();
    },
    [cancel],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: ReactMouseEvent) => e.preventDefault(),
  };
}

// ── useDoubleTap ────────────────────────────────────────────────────────────────

export interface DoubleTapOptions {
  windowMs?: number;
  haptics?: boolean;
}

/** Fires `onDoubleTap` on two quick taps in the same spot. Resets after firing so a
 *  triple-tap doesn't double-fire. Single taps pass through untouched. */
export function useDoubleTap(
  onDoubleTap: (e: ReactPointerEvent) => void,
  { windowMs = 300, haptics = true }: DoubleTapOptions = {},
) {
  const last = useRef<{ t: number; x: number; y: number } | null>(null);

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      const next = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      if (isDoubleTap(last.current, next, windowMs)) {
        if (haptics) haptic("selection");
        onDoubleTap(e);
        last.current = null;
      } else {
        last.current = next;
      }
    },
    [onDoubleTap, windowMs, haptics],
  );

  return { onPointerUp };
}

// ── useSwipe ────────────────────────────────────────────────────────────────────

export interface UseSwipeOptions extends SwipeOptions {
  onSwipe?: (dir: SwipeDirection, e: ReactPointerEvent) => void;
  onSwipeLeft?: (e: ReactPointerEvent) => void;
  onSwipeRight?: (e: ReactPointerEvent) => void;
  onSwipeUp?: (e: ReactPointerEvent) => void;
  onSwipeDown?: (e: ReactPointerEvent) => void;
  haptics?: boolean;
}

/** Detects a directional swipe on release. For list-row reveal actions, swipe-back,
 *  and dismiss gestures. (Interactive rubber-band drag is a Phase 2 enhancement.) */
export function useSwipe(opts: UseSwipeOptions = {}) {
  const origin = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    origin.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      if (!origin.current) return;
      const dir = swipeDirection(e.clientX - origin.current.x, e.clientY - origin.current.y, opts);
      origin.current = null;
      if (!dir) return;
      if (opts.haptics !== false) haptic("selection");
      opts.onSwipe?.(dir, e);
      const handlers = {
        left: opts.onSwipeLeft,
        right: opts.onSwipeRight,
        up: opts.onSwipeUp,
        down: opts.onSwipeDown,
      };
      handlers[dir]?.(e);
    },
    [opts],
  );

  return { onPointerDown, onPointerUp, onPointerCancel: () => (origin.current = null) };
}

// ── useCardGestures (tap / double-tap / long-press on one target) ─────────────

export interface CardGestureHandlers {
  onTap?: () => void;
  onDoubleTap?: () => void;
  onLongPress?: () => void;
}

/**
 * One pointer path for Home widgets — the native triad:
 * tap → open, double-tap → primary action, long-press → action sheet.
 * Long-press cancels the pending tap so iOS-style menus don't also navigate.
 */
export function useCardGestures(
  { onTap, onDoubleTap, onLongPress }: CardGestureHandlers,
  { delayMs = 480, windowMs = 280 }: { delayMs?: number; windowMs?: number } = {},
) {
  const origin = useRef<{ x: number; y: number } | null>(null);
  const longTimer = useRef<number | null>(null);
  const tapTimer = useRef<number | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const longFired = useRef(false);

  const clearLong = useCallback(() => {
    if (longTimer.current !== null) {
      clearTimeout(longTimer.current);
      longTimer.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      origin.current = { x: e.clientX, y: e.clientY };
      longFired.current = false;
      if (!onLongPress) return;
      longTimer.current = window.setTimeout(() => {
        longFired.current = true;
        if (tapTimer.current !== null) {
          clearTimeout(tapTimer.current);
          tapTimer.current = null;
        }
        haptic("tap");
        onLongPress();
        longTimer.current = null;
      }, delayMs);
    },
    [onLongPress, delayMs],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!origin.current) return;
      if (exceededSlop(e.clientX - origin.current.x, e.clientY - origin.current.y)) {
        clearLong();
        origin.current = null;
      }
    },
    [clearLong],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      clearLong();
      if (longFired.current) {
        origin.current = null;
        return;
      }
      const next = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      if (onDoubleTap && isDoubleTap(lastTap.current, next, windowMs)) {
        if (tapTimer.current !== null) {
          clearTimeout(tapTimer.current);
          tapTimer.current = null;
        }
        lastTap.current = null;
        haptic("selection");
        onDoubleTap();
        origin.current = null;
        return;
      }
      lastTap.current = next;
      if (onTap) {
        if (tapTimer.current !== null) clearTimeout(tapTimer.current);
        tapTimer.current = window.setTimeout(() => {
          tapTimer.current = null;
          onTap();
        }, onDoubleTap ? windowMs : 0);
      }
      origin.current = null;
    },
    [clearLong, onDoubleTap, onTap, windowMs],
  );

  const cancel = useCallback(() => {
    clearLong();
    origin.current = null;
  }, [clearLong]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: ReactMouseEvent) => e.preventDefault(),
    style: { touchAction: "manipulation" as const, WebkitTouchCallout: "none" as const },
  };
}
