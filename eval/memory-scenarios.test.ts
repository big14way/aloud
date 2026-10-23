import { describe, expect, it } from "vitest";
import { runScenarios } from "./memory-scenarios.js";

describe("memory scenarios", () => {
  it.each(runScenarios())("$name", (r) => {
    expect(r.got, r.speech).toBe(r.expected);
    expect(r.pass, r.speech).toBe(true);
  });
});
