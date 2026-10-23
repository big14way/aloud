import { describe, expect, it } from "vitest";
import { cer, containsFact, formatRate, inventedWords, keyFactHits, levenshtein, percentile } from "./metrics.js";

describe("metrics", () => {
  it("computes edit distance and CER", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(cer("Dear Sam", "Dear Sam")).toBe(0);
    expect(cer("Dear Som", "Dear Sam")).toBeCloseTo(1 / 8);
    expect(cer("", "abc")).toBe(1);
  });
  it("matches key facts with alternatives", () => {
    expect(containsFact("A kettle at 12 o'clock.", "kettle|jug")).toBe(true);
    expect(keyFactHits("Total $12.50", ["$12.50", "total", "milk"])).toBe(2);
  });
  it("counts invented words", () => {
    expect(inventedWords("Total $12.50 paid", "TOTAL $12.50")).toEqual({ invented: 1, total: 3 });
  });
  it("takes nearest-rank percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([], 50)).toBeNull();
  });
  it("formats rates with numerator, denominator and the small-set flag", () => {
    expect(formatRate({ num: 3, den: 4 })).toBe("75.0% (3/4), small set");
    expect(formatRate({ num: 30, den: 40 })).toBe("75.0% (30/40)");
    expect(formatRate({ num: 0, den: 0 })).toBe("n/a (0 examples)");
  });
});
