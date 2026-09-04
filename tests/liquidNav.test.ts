import { describe, expect, it } from "vitest";
import { clampPillLeft, indexFromX, pillLeftForIndex } from "../src/lib/liquidNav";

describe("indexFromX", () => {
  it("maps the five WhatsApp-style slots", () => {
    expect(indexFromX(0, 390, 5)).toBe(0);
    expect(indexFromX(77, 390, 5)).toBe(0);
    expect(indexFromX(78, 390, 5)).toBe(1);
    expect(indexFromX(389, 390, 5)).toBe(4);
    expect(indexFromX(-20, 390, 5)).toBe(0);
    expect(indexFromX(900, 390, 5)).toBe(4);
  });
});

describe("clampPillLeft", () => {
  it("stays inside the bar", () => {
    expect(clampPillLeft(-10, 390, 70)).toBe(0);
    expect(clampPillLeft(400, 390, 70)).toBe(320);
  });
});

describe("pillLeftForIndex", () => {
  it("places five equal pills with inset", () => {
    const a = pillLeftForIndex(0, 5, 390, 4);
    const b = pillLeftForIndex(4, 5, 390, 4);
    expect(a.left).toBe(4);
    expect(a.width).toBeCloseTo(390 / 5 - 8);
    expect(b.left + b.width).toBeLessThanOrEqual(390);
  });
});
