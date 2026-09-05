import { describe, expect, it } from "vitest";
import { clampPillLeft, indexFromX, pillLeftForIndex } from "../src/lib/liquidNav";

describe("indexFromX", () => {
  it("maps the five WhatsApp-style slots", () => {
    expect(indexFromX(0, 390, 5)).toBe(0);
    expect(indexFromX(77, 390, 5)).toBe(0);
    expect(indexFromX(78, 390, 5)).toBe(1);
    expect(indexFromX(155, 390, 5)).toBe(1);
    expect(indexFromX(156, 390, 5)).toBe(2);
    expect(indexFromX(233, 390, 5)).toBe(2);
    expect(indexFromX(234, 390, 5)).toBe(3);
    expect(indexFromX(311, 390, 5)).toBe(3);
    expect(indexFromX(312, 390, 5)).toBe(4);
    expect(indexFromX(389, 390, 5)).toBe(4);
    expect(indexFromX(-20, 390, 5)).toBe(0);
    expect(indexFromX(900, 390, 5)).toBe(4);
  });

  it("returns 0 for empty or zero-width bars", () => {
    expect(indexFromX(10, 0, 5)).toBe(0);
    expect(indexFromX(10, 390, 0)).toBe(0);
    expect(indexFromX(10, 100, 1)).toBe(0);
  });
});

describe("clampPillLeft", () => {
  it("stays inside the bar", () => {
    expect(clampPillLeft(-10, 390, 70)).toBe(0);
    expect(clampPillLeft(400, 390, 70)).toBe(320);
    expect(clampPillLeft(10, 390, 70)).toBe(10);
  });

  it("clamps to 0 when the pill is wider than the bar", () => {
    expect(clampPillLeft(20, 50, 80)).toBe(0);
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

  it("keeps a single pill inside the inset", () => {
    const one = pillLeftForIndex(0, 1, 200, 4);
    expect(one.left).toBe(4);
    expect(one.width).toBe(192);
  });

  it("returns a zero-width pill when count or width is 0", () => {
    expect(pillLeftForIndex(0, 0, 390, 4)).toEqual({ left: 4, width: 0 });
    expect(pillLeftForIndex(0, 5, 0, 4)).toEqual({ left: 4, width: 0 });
  });
});
