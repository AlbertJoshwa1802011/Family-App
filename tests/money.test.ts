/**
 * E0 — pure money/split unit + property tests (docs/EXPENSE_TRACKER_SPEC.md §5, §19.1–19.2).
 */
import { describe, expect, it } from "vitest";
import {
  MAX_AMOUNT_MINOR,
  MoneyValidationError,
  splitEqual,
  splitPercentage,
  validateExact,
} from "../worker/lib/money";

/** Lexicographically sorted ids so remainder assignment is predictable. */
const M = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "mA"] as const;

describe("splitEqual — §5.2 worked examples", () => {
  it("₹100 / 3 → [3334, 3333, 3333]", () => {
    const shares = splitEqual(10_000, [M[0], M[1], M[2]]);
    expect(shares.map((s) => s.shareMinor)).toEqual([3334, 3333, 3333]);
    expect(shares.reduce((a, s) => a + s.shareMinor, 0)).toBe(10_000);
  });

  it("₹101 / 3 → [3367, 3367, 3366]", () => {
    const shares = splitEqual(10_100, [M[0], M[1], M[2]]);
    expect(shares.map((s) => s.shareMinor)).toEqual([3367, 3367, 3366]);
    expect(shares.reduce((a, s) => a + s.shareMinor, 0)).toBe(10_100);
  });

  it("₹1 / 3 → [34, 33, 33]", () => {
    const shares = splitEqual(100, [M[0], M[1], M[2]]);
    expect(shares.map((s) => s.shareMinor)).toEqual([34, 33, 33]);
  });

  it("₹10.01 / 3 → [334, 334, 333]", () => {
    const shares = splitEqual(1001, [M[0], M[1], M[2]]);
    expect(shares.map((s) => s.shareMinor)).toEqual([334, 334, 333]);
  });

  it("₹1,000 / 10 → ten × 10000", () => {
    const ids = [...M];
    const shares = splitEqual(100_000, ids);
    expect(shares.every((s) => s.shareMinor === 10_000)).toBe(true);
    expect(shares).toHaveLength(10);
  });

  it("is independent of input order (same set → same per-id shares)", () => {
    const a = splitEqual(10_000, [M[2], M[0], M[1]]);
    const b = splitEqual(10_000, [M[0], M[1], M[2]]);
    const byId = (rows: ReturnType<typeof splitEqual>) =>
      Object.fromEntries(rows.map((r) => [r.memberId, r.shareMinor]));
    expect(byId(a)).toEqual(byId(b));
  });
});

describe("splitPercentage — §5.2 worked examples", () => {
  it("₹1 with 3333/3333/3334 bp → [34, 33, 33]", () => {
    const shares = splitPercentage(100, [
      { memberId: M[0], sharePercentBp: 3333 },
      { memberId: M[1], sharePercentBp: 3333 },
      { memberId: M[2], sharePercentBp: 3334 },
    ]);
    expect(shares.map((s) => s.shareMinor)).toEqual([34, 33, 33]);
    expect(shares.reduce((a, s) => a + s.shareMinor, 0)).toBe(100);
  });

  it("100% to one participant → [10000]", () => {
    const shares = splitPercentage(10_000, [
      { memberId: M[0], sharePercentBp: 10_000 },
    ]);
    expect(shares).toEqual([
      { memberId: M[0], shareMinor: 10_000, sharePercentBp: 10_000 },
    ]);
  });

  it("rejects percentages that do not sum to 10000bp", () => {
    expect(() =>
      splitPercentage(10_000, [
        { memberId: M[0], sharePercentBp: 3300 },
        { memberId: M[1], sharePercentBp: 3300 },
        { memberId: M[2], sharePercentBp: 3300 },
      ]),
    ).toThrow(MoneyValidationError);
  });
});

describe("validateExact", () => {
  it("accepts shares that sum exactly", () => {
    const shares = validateExact(1000, [
      { memberId: M[0], shareMinor: 400 },
      { memberId: M[1], shareMinor: 600 },
    ]);
    expect(shares.map((s) => s.shareMinor)).toEqual([400, 600]);
  });

  it("rejects mismatched sums without auto-correcting", () => {
    expect(() =>
      validateExact(10_000, [
        { memberId: M[0], shareMinor: 5000 },
        { memberId: M[1], shareMinor: 4800 },
      ]),
    ).toThrow(/Shares sum to 9800, expected 10000/);
  });

  it("rejects zero or negative shares", () => {
    expect(() =>
      validateExact(100, [
        { memberId: M[0], shareMinor: 100 },
        { memberId: M[1], shareMinor: 0 },
      ]),
    ).toThrow(MoneyValidationError);
  });
});

describe("adversarial / edge validation", () => {
  it("rejects non-positive totals", () => {
    expect(() => splitEqual(0, [M[0]])).toThrow(MoneyValidationError);
    expect(() => splitEqual(-1, [M[0]])).toThrow(MoneyValidationError);
  });

  it("rejects empty participant lists", () => {
    expect(() => splitEqual(100, [])).toThrow(MoneyValidationError);
  });

  it("rejects duplicate memberIds", () => {
    expect(() => splitEqual(100, [M[0], M[0]])).toThrow(/duplicate/);
  });

  it("rejects when participants outnumber total minor units", () => {
    expect(() => splitEqual(2, [M[0], M[1], M[2]])).toThrow(
      /too many participants/,
    );
  });

  it("rejects amounts at/above MAX_AMOUNT_MINOR", () => {
    expect(() => splitEqual(MAX_AMOUNT_MINOR, [M[0]])).toThrow(
      MoneyValidationError,
    );
  });

  it("single participant equal split is a no-op identity (upstream may still reject shared)", () => {
    expect(splitEqual(500, [M[0]])).toEqual([
      { memberId: M[0], shareMinor: 500 },
    ]);
  });
});

describe("property: Σ shares === total (≥1000 randomized cases)", () => {
  function mulberry32(seed: number) {
    return () => {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("equal splits preserve the sum", () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const n = 1 + Math.floor(rand() * 12); // 1..12
      const total = n + Math.floor(rand() * 1_000_000); // ensure ≥ n so no zero shares
      const ids = Array.from({ length: n }, (_, j) => `p${String(j).padStart(2, "0")}`);
      // shuffle ids
      for (let k = ids.length - 1; k > 0; k--) {
        const j = Math.floor(rand() * (k + 1));
        [ids[k], ids[j]] = [ids[j], ids[k]];
      }
      const shares = splitEqual(total, ids);
      expect(shares.reduce((a, s) => a + s.shareMinor, 0)).toBe(total);
      expect(shares.every((s) => s.shareMinor > 0)).toBe(true);
    }
  });

  it("percentage splits preserve the sum", () => {
    const rand = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const n = 1 + Math.floor(rand() * 8); // 1..8
      const total = Math.max(n, 1 + Math.floor(rand() * 500_000));
      const ids = Array.from({ length: n }, (_, j) => `q${String(j).padStart(2, "0")}`);

      // Random positive weights → normalize to exactly 10000 bp.
      const weights = Array.from({ length: n }, () => 1 + Math.floor(rand() * 1000));
      const wSum = weights.reduce((a, b) => a + b, 0);
      const bps = weights.map((w) => Math.floor((10000 * w) / wSum));
      let bpRem = 10000 - bps.reduce((a, b) => a + b, 0);
      for (let k = 0; bpRem > 0; k++, bpRem--) bps[k % n] += 1;

      // Skip pathological cases where some floor would stay 0 after remainder
      // (participants outnumber total) — those are rejected by design.
      if (n > total) continue;

      try {
        const shares = splitPercentage(
          total,
          ids.map((memberId, idx) => ({
            memberId,
            sharePercentBp: bps[idx],
          })),
        );
        expect(shares.reduce((a, s) => a + s.shareMinor, 0)).toBe(total);
        expect(shares.every((s) => s.shareMinor > 0)).toBe(true);
      } catch (e) {
        if (
          e instanceof MoneyValidationError &&
          e.message.includes("too many participants")
        ) {
          continue;
        }
        throw e;
      }
    }
  });
});
