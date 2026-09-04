/**
 * Pure math for the pinned iOS-style tab bar.
 * The active liquid pill can be dragged horizontally inside the bar;
 * the bar itself never leaves the bottom edge.
 */

/** Map a pointer X (relative to the bar) onto a tab index. */
export function indexFromX(x: number, barWidth: number, count: number): number {
  if (count <= 0 || barWidth <= 0) return 0;
  const i = Math.floor((x / barWidth) * count);
  return Math.min(count - 1, Math.max(0, i));
}

/** Keep a pill's left edge inside the bar. */
export function clampPillLeft(
  left: number,
  barWidth: number,
  pillWidth: number,
): number {
  const max = Math.max(0, barWidth - pillWidth);
  return Math.min(max, Math.max(0, left));
}

export function pillLeftForIndex(
  index: number,
  count: number,
  barWidth: number,
  inset = 4,
): { left: number; width: number } {
  if (count <= 0 || barWidth <= 0) return { left: inset, width: 0 };
  const slot = barWidth / count;
  const width = Math.max(0, slot - inset * 2);
  const left = index * slot + inset;
  return { left, width };
}
