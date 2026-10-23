import { describe, expect, it } from "vitest";
import { SentenceChunker, chunkSentences } from "./speech.js";

describe("SentenceChunker", () => {
  it("releases only complete sentences as text streams in", () => {
    const c = new SentenceChunker();
    expect(c.push("A kettle at 12")).toEqual([]);
    expect(c.push(" o'clock. A mug")).toEqual(["A kettle at 12 o'clock."]);
    expect(c.push(" on the left. ")).toEqual(["A mug on the left."]);
    expect(c.flush()).toEqual([]);
  });
  it("flushes the remainder at the end", () => {
    const c = new SentenceChunker();
    c.push("Total $12.50");
    expect(c.flush()).toEqual(["Total $12.50"]);
  });
  it("skips duplicates and punctuation-only segments", () => {
    expect(chunkSentences("Hello there. Hello there. ... ! Bye.")).toEqual(["Hello there.", "Bye."]);
  });
  it("does not split on abbreviations or decimals", () => {
    expect(chunkSentences("Dr. Lee lives at No. 5 Main St. It costs 3.50 now.")).toEqual(["Dr. Lee lives at No. 5 Main St. It costs 3.50 now."]);
  });
});
