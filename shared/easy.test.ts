import { describe, expect, it } from "vitest";
import { CHECK_IN, checkEasy, enforceEasy, hardWrap, plainWords, splitSentences, stepTurn, words } from "./easy.js";

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
  it("builds one step turn with encouragement, the name and a check-in", () => {
    expect(stepTurn("Put the clothes in the basket.", 0, 3, "Ada")).toEqual([
      "Step 1: Put the clothes in the basket.",
      "You're doing great, Ada.",
      CHECK_IN,
    ]);
  });
});
