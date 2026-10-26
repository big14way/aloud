import { describe, expect, it } from "vitest";
import { CHECK_IN, checkEasy, cleanStep, enforceEasy, hardWrap, plainWords, splitSentences, stepTurn, words } from "./easy.js";

describe("easy language", () => {
  it("replaces jargon with plain words and keeps capitals", () => {
    expect(plainWords("Approximately two steps. Ensure the door is shut.")).toBe("About two steps. Make sure the door is shut.");
  });
  it("splits sentences without breaking decimals", () => {
    expect(splitSentences("It costs 12.50 today. Put it away! Done?")).toEqual(["It costs 12.50 today.", "Put it away!", "Done?"]);
  });
  it("wraps long sentences to at most 15 words", () => {
    const long = "Pick up the blue shirt from the floor, fold it in half, and put it in the top drawer of the white dresser near the window.";
    const parts = hardWrap(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(words(p).length).toBeLessThanOrEqual(15);
  });
  it("flags long sentences and jargon", () => {
    expect(checkEasy(["Please utilize the basket."]).map((v) => v.rule)).toEqual(["jargon"]);
    expect(checkEasy(["one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen"]).map((v) => v.rule)).toEqual(["too_long"]);
  });
  it("enforces both rules deterministically", () => {
    const out = enforceEasy("Subsequently you should retrieve the clothes and deposit them in the receptacle beside the bed in the corner of the room by the window.");
    expect(checkEasy(out)).toEqual([]);
  });
  it("drops numbers and marks the model put around a step, and keeps times and amounts", () => {
    for (const s of ["/1/ Fill the kettle.", "1. Fill the kettle.", "1) Fill the kettle.", "(1) Fill the kettle.", "Step 1: Fill the kettle.", "step 2 - Fill the kettle.", "#3 Fill the kettle."]) {
      expect(cleanStep(s)).toBe("Fill the kettle.");
    }
    for (const s of ["/fill the kettle/", "**Fill the kettle**", "“Fill the kettle.”", "/ fill the kettle", "fill the kettle", "!\\ Fill the kettle.", "- Fill the kettle", "• 1. Fill the kettle."]) {
      expect(cleanStep(s)).toBe("Fill the kettle.");
    }
    for (const s of ["10:30 is when the timer ends.", "1.5 cups of water go in.", "2 cups of water go in.", "Fill the kettle.", 'Press "Start" twice.', "Is the light on?"]) {
      expect(cleanStep(s)).toBe(s);
    }
    expect(cleanStep("1.")).toBe("1.");
    expect(stepTurn("/1/ Carefully fill the kettle.", 0, 3)[0]).toBe("Step 1: Carefully fill the kettle.");
  });
  it("builds one step turn with encouragement, the name and a check-in", () => {
    expect(stepTurn("Put the clothes in the basket.", 0, 3, "Ada")).toEqual([
      "Step 1: Put the clothes in the basket.",
      "You're doing great, Ada.",
      CHECK_IN,
    ]);
  });
});
