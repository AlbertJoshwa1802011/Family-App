/**
 * Bubble nav catalog — 200 widths × 5 heights = 1000 clamp + 1000 snap cases.
 */
import { describe, expect, it } from "vitest";
import { clampBubble, defaultBubblePosition, snapBubbleToEdge } from "../../src/lib/bubbleNav";

const WIDTH = 200;
const HEIGHT = 64;
const PAD = 12;
const VHS = [568, 844, 1024, 1366, 1600] as const;

const VIEW_CASES = Array.from({ length: 200 }, (_, i) => {
  const vw = 280 + i;
  return VHS.map((vh) => ({ vw, vh }));
}).flat();

describe("catalog: bubble nav ≥1000", () => {
  it(`records ${VIEW_CASES.length} viewport combinations`, () => {
    expect(VIEW_CASES.length).toBeGreaterThanOrEqual(1000);
  });

  it.each(VIEW_CASES)("clamp stays padded inside vw=$vw vh=$vh", ({ vw, vh }) => {
    const maxX = Math.max(PAD, vw - WIDTH - PAD);
    const maxY = Math.max(PAD, vh - HEIGHT - PAD);
    for (const [x, y] of [
      [-40, -10],
      [vw + 40, vh + 40],
      [vw / 2, vh / 2],
      [0, 0],
    ] as const) {
      const r = clampBubble(x, y, vw, vh, WIDTH, HEIGHT, PAD);
      expect(r.x).toBeGreaterThanOrEqual(PAD);
      expect(r.y).toBeGreaterThanOrEqual(PAD);
      expect(r.x).toBeLessThanOrEqual(maxX);
      expect(r.y).toBeLessThanOrEqual(maxY);
    }
  });

  it.each(VIEW_CASES)("snap is left or right edge vw=$vw vh=$vh", ({ vw, vh }) => {
    const left = PAD;
    const right = Math.max(PAD, vw - WIDTH - PAD);
    const midLeft = snapBubbleToEdge(0, 100, vw, vh, WIDTH, HEIGHT, PAD);
    const midRight = snapBubbleToEdge(vw, 100, vw, vh, WIDTH, HEIGHT, PAD);
    expect([left, right]).toContain(midLeft.x);
    expect([left, right]).toContain(midRight.x);
    const def = defaultBubblePosition(vw, vh, WIDTH, HEIGHT, PAD);
    expect(def.x).toBeGreaterThanOrEqual(PAD);
    expect(def.y).toBeGreaterThanOrEqual(PAD);
  });
});
