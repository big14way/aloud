import { describe, expect, it } from "vitest";
import { canonicalNumber, compareFrames, numericTokens, readingIsGrounded } from "./numbers.js";
import { item } from "./test-helpers.js";

describe("canonicalNumber", () => {
  it("treats trailing zeros and thousands separators as the same value", () => {
    expect(canonicalNumber("$12.50")).toBe(canonicalNumber("$12.5"));
    expect(canonicalNumber("1,250.00")).toBe("1250");
  });
  it("keeps currency, so $12 and €12 differ", () => {
    expect(canonicalNumber("$12")).not.toBe(canonicalNumber("€12"));
  });
  it("reduces phone numbers and times to digits", () => {
    expect(canonicalNumber("555-1234")).toBe("5551234");
    expect(canonicalNumber("10:42")).toBe("1042");
  });
  it("does not confuse 12.50 with 1250", () => {
    expect(canonicalNumber("12.50")).not.toBe(canonicalNumber("1250"));
  });
});

describe("numericTokens", () => {
  it("finds every number in a line", () => {
    expect(numericTokens("Total: $12.50 on 12/10/2026")).toEqual(["$12.5", "12102026"]);
  });
  it("returns nothing for plain words", () => {
    expect(numericTokens("Dear Sam")).toEqual([]);
  });
});

describe("compareFrames", () => {
  it("agrees when frame B has the same numbers, even split across lines", () => {
    const a = [item({ kind: "text", content: "Total $12.50" }), item({ kind: "text", content: "Thank you" })];
    const b = [item({ kind: "text", content: "Total" }), item({ kind: "number", content: "$12.5" })];
    expect(compareFrames(a, b)).toEqual({ agreed: [0], disputed: [] });
  });
  it("disputes when the frames read different numbers", () => {
    const a = [item({ kind: "number", content: "$12.50", number_kind: "price" })];
    const b = [item({ kind: "number", content: "$17.50", number_kind: "price" })];
    expect(compareFrames(a, b)).toEqual({ agreed: [], disputed: [0] });
  });
  it("counts repeated numbers, so one 5 in B can't confirm two in A", () => {
    const a = [item({ kind: "text", content: "5 apples" }), item({ kind: "text", content: "5 pears" })];
    const b = [item({ kind: "text", content: "5 apples" })];
    expect(compareFrames(a, b)).toEqual({ agreed: [0], disputed: [1] });
  });
  it("disputes a number item with no digits", () => {
    const a = [item({ kind: "number", content: "twelve", number_kind: "amount" })];
    expect(compareFrames(a, []).disputed).toEqual([0]);
  });
});

describe("readingIsGrounded", () => {
  it("accepts a reading taken from one of the frames", () => {
    expect(readingIsGrounded("$12.50", "Total $12.50", "Total $17.50")).toBe(true);
  });
  it("rejects a reading that neither frame saw", () => {
    expect(readingIsGrounded("$15.00", "Total $12.50", "Total $17.50")).toBe(false);
  });
});
