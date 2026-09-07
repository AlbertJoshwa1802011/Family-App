/**
 * Pure math for the floating bubble tab bar (AssistiveTouch / GitHub-style).
 * The React shell in AppShell.tsx is a thin pointer-event wrapper over this.
 */

export const BUBBLE_NAV_STORAGE_KEY = "fv:bubbleNav";
export const BUBBLE_PAD = 12;
export const BUBBLE_HEIGHT = 64;
export const BUBBLE_DRAG_THRESHOLD = 8;

export interface BubbleBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BubbleMotion {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function clampBubble(
  x: number,
  y: number,
  vw: number,
  vh: number,
  width: number,
  height: number,
  pad: number,
): { x: number; y: number } {
  const minX = pad;
  const minY = pad;
  const maxX = Math.max(pad, vw - width - pad);
  const maxY = Math.max(pad, vh - height - pad);
  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  };
}

/** Snap to the nearer vertical edge, keep Y. GitHub / iOS bubble behaviour. */
export function snapBubbleToEdge(
  x: number,
  y: number,
  vw: number,
  vh: number,
  width: number,
  height: number,
  pad: number,
): { x: number; y: number } {
  const clamped = clampBubble(x, y, vw, vh, width, height, pad);
  const mid = vw / 2;
  const left = pad;
  const right = Math.max(pad, vw - width - pad);
  return {
    x: clamped.x + width / 2 < mid ? left : right,
    y: clamped.y,
  };
}

export function defaultBubblePosition(
  vw: number,
  vh: number,
  width: number,
  height: number,
  pad: number,
): { x: number; y: number } {
  return {
    x: Math.max(pad, (vw - width) / 2),
    y: Math.max(pad, vh - height - pad),
  };
}

/** Phone-width pill: full width minus padding, capped at Tailwind max-w-md. */
export function bubbleBarWidth(vw: number, pad = BUBBLE_PAD): number {
  return Math.min(448, Math.max(240, vw - pad * 2));
}

export function dragExceeded(
  dx: number,
  dy: number,
  threshold = BUBBLE_DRAG_THRESHOLD,
): boolean {
  return dx * dx + dy * dy >= threshold * threshold;
}

/**
 * One animation frame of coasting: integrate velocity, bounce off padded
 * edges, apply friction. When speed drops, the shell snaps to an edge.
 */
export function stepBubbleMotion(
  motion: BubbleMotion,
  vw: number,
  vh: number,
  width: number,
  height: number,
  pad: number,
  friction = 0.92,
  restitution = 0.42,
): { motion: BubbleMotion; settled: boolean } {
  let { x, y, vx, vy } = motion;
  x += vx;
  y += vy;
  vx *= friction;
  vy *= friction;

  const minX = pad;
  const minY = pad;
  const maxX = Math.max(pad, vw - width - pad);
  const maxY = Math.max(pad, vh - height - pad);

  if (x < minX) {
    x = minX;
    vx = Math.abs(vx) * restitution;
  } else if (x > maxX) {
    x = maxX;
    vx = -Math.abs(vx) * restitution;
  }
  if (y < minY) {
    y = minY;
    vy = Math.abs(vy) * restitution;
  } else if (y > maxY) {
    y = maxY;
    vy = -Math.abs(vy) * restitution;
  }

  return {
    motion: { x, y, vx, vy },
    settled: Math.hypot(vx, vy) < 0.45,
  };
}

export function parseStoredBubble(
  raw: string | null,
): { x: number; y: number } | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      return { x: p.x, y: p.y };
    }
  } catch {
    // ignore corrupt storage
  }
  return null;
}
