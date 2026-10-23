import { describe, expect, it } from "vitest";
import { extractFirstJsonObject, parseJsonObject, stripThinking } from "./json.js";

describe("model JSON parsing", () => {
  it("drops think blocks and code fences", () => {
    expect(parseJsonObject('<think>hmm {"no":1}</think>\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });
  it("handles a stray closing think tag", () => {
    expect(stripThinking("reasoning here</think>{\"a\":2}")).toBe('{"a":2}');
  });
  it("respects braces inside strings", () => {
    expect(extractFirstJsonObject('x {"t": "a } b", "n": {"m": 1}} y')).toBe('{"t": "a } b", "n": {"m": 1}}');
  });
  it("returns null for an unfinished object", () => {
    expect(extractFirstJsonObject('{"a": 1')).toBeNull();
  });
  it("throws when there is no object", () => {
    expect(() => parseJsonObject("sorry")).toThrow();
  });
});
