import { describe, expect, it } from "vitest";
import {
  bubbleBarWidth,
  clampBubble,
  defaultBubblePosition,
  dragExceeded,
  parseStoredBubble,
  snapBubbleToEdge,
  stepBubbleMotion,
} from "../src/lib/bubbleNav";

describe("clampBubble", () => {
  it("keeps the pill inside the viewport with padding", () => {
    expect(clampBubble(-40, -10, 390, 844, 360, 64, 12)).toEqual({ x: 12, y: 12 });
    expect(clampBubble(400, 900, 390, 844, 360, 64, 12)).toEqual({
      x: 18,
      y: 768,
    });
  });
});

describe("snapBubbleToEdge", () => {
  it("snaps to the left when the centre is on the left half", () => {
    const snapped = snapBubbleToEdge(20, 400, 390, 844, 200, 64, 12);
    expect(snapped.x).toBe(12);
    expect(snapped.y).toBe(400);
  });

  it("snaps to the right when the centre is on the right half", () => {
    const snapped = snapBubbleToEdge(200, 100, 390, 844, 200, 64, 12);
    expect(snapped.x).toBe(390 - 200 - 12);
  });
});

describe("defaultBubblePosition", () => {
  it("sits bottom-centre", () => {
    const pos = defaultBubblePosition(390, 844, 360, 64, 12);
    expect(pos.x).toBe((390 - 360) / 2);
    expect(pos.y).toBe(844 - 64 - 12);
  });
});

describe("snapBubbleToEdge mid-line", () => {
  it("snaps right when the centre is exactly on the midline", () => {
    // width 200, vw 390 → mid 195. x=95 → centre 195.
    const snapped = snapBubbleToEdge(95, 400, 390, 844, 200, 64, 12);
    expect(snapped.x).toBe(390 - 200 - 12);
  });
});

describe("dragExceeded", () => {
  it("stays false under the 8px threshold", () => {
    expect(dragExceeded(5, 5)).toBe(false);
    expect(dragExceeded(7, 0)).toBe(false);
  });

  it("fires once the finger has moved far enough", () => {
    expect(dragExceeded(8, 0)).toBe(true);
    expect(dragExceeded(6, 6)).toBe(true);
  });
});

describe("stepBubbleMotion", () => {
  it("coasts in the velocity direction and slows down", () => {
    const first = stepBubbleMotion(
      { x: 100, y: 200, vx: 20, vy: -10 },
      390,
      844,
      200,
      64,
      12,
    );
    expect(first.settled).toBe(false);
    expect(first.motion.x).toBeGreaterThan(100);
    expect(first.motion.y).toBeLessThan(200);
    expect(Math.hypot(first.motion.vx, first.motion.vy)).toBeLessThan(
      Math.hypot(20, -10),
    );
  });

  it("bounces off the left pad instead of leaving the screen", () => {
    const hit = stepBubbleMotion(
      { x: 12, y: 200, vx: -30, vy: 0 },
      390,
      844,
      200,
      64,
      12,
    );
    expect(hit.motion.x).toBe(12);
    expect(hit.motion.vx).toBeGreaterThan(0);
  });

  it("settles when leftover speed is tiny", () => {
    const done = stepBubbleMotion(
      { x: 40, y: 200, vx: 0.1, vy: 0.1 },
      390,
      844,
      200,
      64,
      12,
    );
    expect(done.settled).toBe(true);
  });
});

describe("bubbleBarWidth", () => {
  it("caps at max-w-md and keeps side padding", () => {
    expect(bubbleBarWidth(390)).toBe(390 - 24);
    expect(bubbleBarWidth(900)).toBe(448);
    expect(bubbleBarWidth(200)).toBe(240);
  });
});

describe("parseStoredBubble", () => {
  it("accepts finite x/y and rejects junk", () => {
    expect(parseStoredBubble('{"x":40,"y":700}')).toEqual({ x: 40, y: 700 });
    expect(parseStoredBubble("nope")).toBeNull();
    expect(parseStoredBubble('{"x":"a","y":1}')).toBeNull();
    expect(parseStoredBubble(null)).toBeNull();
  });
});
