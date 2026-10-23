import { beforeEach, describe, expect, it } from "vitest";
import { createContext, Meter } from "./context.js";
import { FakeLLM } from "./fake-llm.js";
import { resetJsonModes } from "./llm.js";
import { shapeEasy, shapeViolations } from "./shape.js";
import { testConfig } from "./test-fixtures.js";

beforeEach(() => resetJsonModes());

const long = ["I last confirmed your house keys on the hall shelf today at 10:42, but they were picked up afterward and moved somewhere else."];

describe("shapeViolations", () => {
  it("catches dropped hedges, changed numbers and changed quotes", () => {
    expect(shapeViolations(['I think it says "EXIT", but I\'m not sure.'], ["It says EXTT."])).toEqual(expect.arrayContaining(['dropped "not sure"', 'dropped "i think"', 'changed quote "EXIT"']));
    expect(shapeViolations(["It costs $12.50."], ["It costs $15."])).toEqual(expect.arrayContaining(["dropped number $12.5", "added number $15"]));
  });
  it("catches safety problems the rewrite introduced", () => {
    expect(shapeViolations(["A crossing ahead."], ["A crossing ahead. It is safe to cross."])).toContain("traffic claim");
    expect(shapeViolations(["A chair."], ["A chair. A man sits on it."])).toContain("added a person");
  });
});

describe("shapeEasy", () => {
  it("leaves already-easy speech alone without a model call", async () => {
    const llm = new FakeLLM(() => new Error("no call expected"));
    const ctx = createContext(testConfig(), llm);
    const out = await shapeEasy(ctx, new Meter(ctx.spend), ["A mug at 3 o'clock."]);
    expect(out).toEqual({ speech: ["A mug at 3 o'clock."], source: "unchanged" });
    expect(llm.requests).toHaveLength(0);
  });

  it("accepts a rewrite that keeps the facts and the status words", async () => {
    const llm = new FakeLLM(() => JSON.stringify({ sentences: ["I last confirmed your house keys on the hall shelf today at 10:42.", "They were picked up after that.", "I haven't confirmed them anywhere since."] }));
    const ctx = createContext(testConfig(), llm);
    const out = await shapeEasy(ctx, new Meter(ctx.spend), long, ["last confirmed"]);
    expect(out.source).toBe("model");
    expect(llm.requests[0]?.reasoningEffort).toBe("none");
  });

  it("re-asks once, then falls back to the deterministic rewrite", async () => {
    const llm = new FakeLLM(() => JSON.stringify({ sentences: ["Your keys are on the shelf."] }));
    const ctx = createContext(testConfig(), llm);
    const out = await shapeEasy(ctx, new Meter(ctx.spend), long, ["last confirmed"]);
    expect(llm.requests).toHaveLength(2);
    expect(out.source).toBe("fallback");
    expect(out.speech.join(" ")).toContain("last confirmed");
  });
});
