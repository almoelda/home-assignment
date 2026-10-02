import { describe, expect, it } from "vitest";
import { compareRatioDescending, isWithinMaxCpm } from "./money.js";

describe("compareRatioDescending", () => {
  it("returns negative when a's ratio is greater", () => {
    expect(compareRatioDescending(100, 10, 50, 10)).toBeLessThan(0); // 10 vs 5
  });

  it("returns positive when a's ratio is smaller", () => {
    expect(compareRatioDescending(50, 10, 100, 10)).toBeGreaterThan(0); // 5 vs 10
  });

  it("returns zero for equal ratios expressed with different numbers", () => {
    expect(compareRatioDescending(1, 2, 50, 100)).toBe(0); // 0.5 vs 0.5
  });

  it("gets the comparison right at a scale where float64 multiplication would round incorrectly", () => {
    const aNumerator = 100_000_000;
    const aDenominator = 99_999_999;
    const bNumerator = 100_000_001;
    const bDenominator = 100_000_000;

    // Demonstrates the precision loss a naive `Number` multiplication hits at this scale —
    // this is exactly why IMPLEMENTATION_PLAN.md §2 mandates BigInt for ratio comparisons.
    const naiveCrossA = aNumerator * bDenominator;
    const naiveCrossB = bNumerator * aDenominator;
    expect(naiveCrossA).toBe(naiveCrossB); // float64 cannot tell these apart

    // The true cross products differ by 1 (10_000_000_000_000_000 vs 9_999_999_999_999_999),
    // so a's ratio is genuinely (very slightly) larger — BigInt gets this right.
    expect(compareRatioDescending(aNumerator, aDenominator, bNumerator, bDenominator)).toBe(-1);
  });
});

describe("isWithinMaxCpm", () => {
  it("accepts an amount exactly at the computed ceiling", () => {
    // views=333, maxCpm=200 -> ceiling is amount*1000 <= 66_600 -> amount <= 66
    expect(isWithinMaxCpm(66, 333, 200)).toBe(true);
  });

  it("rejects one cent above the ceiling", () => {
    expect(isWithinMaxCpm(67, 333, 200)).toBe(false);
  });

  it("holds at large values where plain number multiplication would overflow safe-integer range", () => {
    // views and maxCpm both ~100M: product is ~10^16, beyond Number.MAX_SAFE_INTEGER.
    const views = 100_000_000;
    const maxCpmCents = 100_000_000;
    const exactCeilingCents = (views * maxCpmCents) / 1000; // 10_000_000_000_000 — safe to
    // compute in the test with plain division since it divides evenly; isWithinMaxCpm itself
    // never performs this division, which is the point.
    expect(isWithinMaxCpm(exactCeilingCents, views, maxCpmCents)).toBe(true);
    expect(isWithinMaxCpm(exactCeilingCents + 1, views, maxCpmCents)).toBe(false);
  });
});
