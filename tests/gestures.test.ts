/**
 * Unit tests for the pure gesture math (src/lib/gestures.ts). The React hooks are a
 * thin pointer-event shell over these, so getting the thresholds right here is what
 * makes the native-feel gestures reliable. No DOM needed.
 */
import { describe, expect, it } from "vitest";
import { exceededSlop, isDoubleTap, swipeDirection } from "../src/lib/gestures";

describe("swipeDirection", () => {
  it("detects horizontal swipes past threshold with little vertical drift", () => {
    expect(swipeDirection(-60, 5)).toBe("left");
    expect(swipeDirection(60, -5)).toBe("right");
  });

  it("detects vertical swipes", () => {
    expect(swipeDirection(5, -60)).toBe("up");
    expect(swipeDirection(-5, 60)).toBe("down");
  });

  it("rejects short travel (below threshold)", () => {
    expect(swipeDirection(20, 0)).toBeNull();
    expect(swipeDirection(0, 20)).toBeNull();
  });

  it("rejects diagonal gestures (off-axis drift exceeds restraint)", () => {
    expect(swipeDirection(60, 60)).toBeNull();
  });

  it("honors custom threshold/restraint", () => {
    expect(swipeDirection(30, 0, { threshold: 24, restraint: 10 })).toBe("right");
    expect(swipeDirection(30, 15, { threshold: 24, restraint: 10 })).toBeNull();
  });
});

describe("isDoubleTap", () => {
  it("is false with no previous tap", () => {
    expect(isDoubleTap(null, { t: 100, x: 0, y: 0 })).toBe(false);
  });

  it("is true for two quick taps in the same spot", () => {
    expect(isDoubleTap({ t: 0, x: 10, y: 10 }, { t: 200, x: 12, y: 8 })).toBe(true);
  });

  it("is false when too slow", () => {
    expect(isDoubleTap({ t: 0, x: 10, y: 10 }, { t: 400, x: 10, y: 10 })).toBe(false);
  });

  it("is false when too far apart (different rows)", () => {
    expect(isDoubleTap({ t: 0, x: 10, y: 10 }, { t: 100, x: 10, y: 80 })).toBe(false);
  });
});

describe("exceededSlop", () => {
  it("is false within slop (a steady press)", () => {
    expect(exceededSlop(4, -4)).toBe(false);
  });
  it("is true once the pointer drags (a scroll)", () => {
    expect(exceededSlop(12, 0)).toBe(true);
    expect(exceededSlop(0, -15)).toBe(true);
  });
});
