import { describe, expect, it } from "vitest";
import { NUMBER_ABSTAIN, guidancePhrase, qualityGate, render, type NumberVerdict } from "./gates.js";
import { PHARMACIST_NOTE, REFUSALS } from "./safety.js";
import { item, read } from "./test-helpers.js";

const dark = { blur: false, too_dark: true, glare: false, cut_off: "none" as const };

describe("quality gate", () => {
  it("speaks only guidance when the model says it cannot answer", () => {
    const r = render({ skill: "describe", read: read([item({ content: "a mug" })], { can_answer: false }) });
    expect(r.status).toBe("guidance");
    expect(r.speech).toEqual(["I can't see clearly. Hold the phone about an arm's length away and press again."]);
  });
  it("speaks only guidance when a flag is set and nothing is confident", () => {
    const r = render({ skill: "read", read: read([item({ kind: "text", content: "Dear", confidence: 0.6 })], { image_quality: dark }) });
    expect(r.speech).toEqual(["Too dark. Try a light, or move toward the window."]);
  });
  it("answers despite a flag when an item is confident", () => {
    expect(qualityGate(read([item({ content: "a mug", confidence: 0.85 })], { image_quality: dark }), "describe").pass).toBe(true);
  });
  it("uses fixed phrases for each cut-off side", () => {
    const q = { blur: false, too_dark: false, glare: false, cut_off: "right" as const };
    expect(guidancePhrase(q, "read")).toBe("The text is cut off on the right. Move the phone right.");
    expect(guidancePhrase({ ...q, cut_off: "top" }, "describe")).toBe("It's cut off at the top. Tilt the phone up.");
  });
  it("never speaks the model's own guidance text", () => {
    const r = render({ skill: "read", read: read([], { can_answer: false, camera_guidance: "Your hand is shaking badly!" }) });
    expect(r.speech.join(" ")).not.toContain("shaking");
  });
});

describe("confidence wording", () => {
  it("speaks confident items plainly, hedges middling ones, drops weak ones and counts them", () => {
    const r = render({
      skill: "describe",
      read: read([
        item({ content: "A kettle", confidence: 0.9, position_clock: 12, distance: "arm_length" }),
        item({ content: "a mug", confidence: 0.6, position_clock: 3 }),
        item({ content: "a spoon", confidence: 0.3 }),
      ]),
    });
    expect(r.speech).toEqual([
      "A kettle at 12 o'clock, about an arm's length away.",
      "I think there's a mug at 3 o'clock, but I'm not sure.",
      "There's more I can't make out.",
    ]);
    expect(r.dropped).toBe(1);
  });
  it("puts hazards first", () => {
    const r = render({
      skill: "describe",
      read: read([
        item({ content: "a kettle", position_clock: 12 }),
        item({ kind: "hazard", content: "a knife on the board, blade toward you", position_clock: 2, distance: "within_reach" }),
      ]),
    });
    expect(r.speech[0]).toBe("Careful: a knife on the board, blade toward you at 2 o'clock, within reach.");
  });
  it("hedges unsure text in Read", () => {
    const r = render({ skill: "read", read: read([item({ kind: "text", content: "Dear Sam,", confidence: 0.7 })]) });
    expect(r.speech).toEqual(['I think it says "Dear Sam", but I\'m not sure.']);
  });
});

describe("people", () => {
  it("renders people from the template, ignoring the model's description", () => {
    const r = render({
      skill: "describe",
      read: read([item({ kind: "person", content: "a smiling young woman, maybe Sarah", position_clock: 1, distance: "few_steps" })]),
    });
    expect(r.speech).toEqual(["A person, a few steps away, at 1 o'clock."]);
  });
  it("redacts people hidden inside object items", () => {
    const r = render({ skill: "describe", read: read([item({ content: "a man reading a newspaper" })]) });
    expect(r.speech).toEqual(["A person."]);
    expect(r.flags).toContain("person_redacted");
  });
});

describe("traffic", () => {
  it("drops traffic-safety claims and speaks the refusal once", () => {
    const r = render({
      skill: "describe",
      read: read([item({ content: "the road is clear" }), item({ content: "no cars on the street" }), item({ content: "a bus stop", position_clock: 11 })]),
    });
    expect(r.speech).toEqual([REFUSALS.traffic, "A bus stop at 11 o'clock."]);
  });
});

describe("medicine", () => {
  it("reads medicine verbatim and adds the pharmacist note", () => {
    const verdicts = new Map<number, NumberVerdict>([[1, { source: "agreed" }]]);
    const r = render({
      skill: "read",
      read: read([item({ kind: "text", content: "Paracetamol tablets" }), item({ kind: "text", content: "500 mg" })], { medicine_label: true }),
      numbers: verdicts,
    });
    expect(r.speech).toEqual(["Paracetamol tablets", "500 mg", PHARMACIST_NOTE]);
  });
  it("does not describe medicine in Describe; it points to Read", () => {
    const r = render({ skill: "describe", read: read([item({ content: "a box of ibuprofen 200 mg" })]) });
    expect(r.speech).toEqual(["There's a medicine label. Press Read to hear it word for word."]);
  });
});

describe("numbers", () => {
  const receipt = read([item({ kind: "text", content: "Total" }), item({ kind: "number", content: "$12.50", number_kind: "price" })]);
  it("speaks a number plainly only when both frames agreed", () => {
    const r = render({ skill: "read", read: receipt, numbers: new Map([[1, { source: "agreed" }]]) });
    expect(r.speech).toEqual(["Total", "$12.50"]);
  });
  it("masks an unverified number and abstains", () => {
    const r = render({ skill: "read", read: receipt });
    expect(r.speech).toEqual(["Total", "(number unclear)", NUMBER_ABSTAIN]);
  });
  it("hedges an adjudicated reading that the two frames did not agree on", () => {
    const r = render({ skill: "read", read: receipt, numbers: new Map([[1, { source: "adjudicated", reading: "$12.50", consistent: false }]]) });
    expect(r.speech[1]).toBe('I think it says "$12.50", but I\'m not sure.');
  });
  it("defers numbers in Describe to Read", () => {
    const r = render({ skill: "describe", read: read([item({ kind: "number", content: "$20", number_kind: "banknote" })]) });
    expect(r.speech).toEqual(["There's a number here. Press Read to check it."]);
  });
});

describe("what is this", () => {
  it("names the main object and a confident label", () => {
    const r = render({
      skill: "what_is",
      read: read([item({ content: "A tin of chopped tomatoes", confidence: 0.92 }), item({ kind: "text", content: "Chopped Tomatoes", confidence: 0.9 })]),
    });
    expect(r.speech).toEqual(["This is a tin of chopped tomatoes.", 'The label says "Chopped Tomatoes".']);
  });
  it("hedges when unsure", () => {
    const r = render({ skill: "what_is", read: read([item({ content: "a TV remote", confidence: 0.65 })]) });
    expect(r.speech).toEqual(["I think this is a TV remote, but I'm not sure."]);
  });
});

describe("empty and cut-off", () => {
  it("says when there is no text", () => {
    expect(render({ skill: "read", read: read([]) }).speech).toEqual(["I don't see any text."]);
  });
  it("adds a cut-off tip after a confident answer", () => {
    const r = render({
      skill: "read",
      read: read([item({ kind: "text", content: "Dear Sam" })], { image_quality: { blur: false, too_dark: false, glare: false, cut_off: "right" } }),
    });
    expect(r.speech).toEqual(["Dear Sam", "The text is cut off on the right. Move the phone right."]);
  });
});
