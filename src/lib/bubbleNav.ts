/**
 * Pure math for the floating bubble tab bar (AssistiveTouch / GitHub-style).
 * The React shell in AppShell.tsx is a thin pointer-event wrapper over this.
 */

export interface BubbleBox {
  x: number;
  y: number;
  width: number;
  height: number;
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
