import { describe, expect, it } from "vitest";
import {
  clampBubble,
  defaultBubblePosition,
  snapBubbleToEdge,
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
    const snapped = snapBubbleToEdge(20, 400, 390, 844, 360, 64, 12);
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
