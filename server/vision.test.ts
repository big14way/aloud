import { beforeEach, describe, expect, it } from "vitest";
import { NUMBER_ABSTAIN } from "../shared/gates.js";
import { SeeRequest } from "../shared/api.js";
import { createContext } from "./context.js";
import { FakeLLM, firstImage, imageCount, userText } from "./fake-llm.js";
import { resetJsonModes, type ChatRequest } from "./llm.js";
import { FRAME_A, FRAME_B, THUMB, testConfig, visionJson } from "./test-fixtures.js";
import { sameModelNumber, see } from "./vision.js";

beforeEach(() => resetJsonModes());

function setup(respond: (req: ChatRequest, n: number) => string | Error, env: Record<string, string> = {}) {
  const llm = new FakeLLM(respond);
  const ctx = createContext(testConfig(env), llm);
  return { llm, ctx };
}

const req = (body: Record<string, unknown>) => SeeRequest.parse(body);

describe("describe", () => {
  it("calls Super-VL once with thinking off and speaks from the gates", async () => {
    const { llm, ctx } = setup(() => visionJson([{ content: "a kettle", position_clock: 12, distance: "arm_length" }, { kind: "hazard", content: "a hot pan", position_clock: 2, distance: "within_reach" }]));
    const res = await see(ctx, req({ skill: "describe", frames: [FRAME_A, FRAME_B] }));
    expect(llm.requests).toHaveLength(1);
    const r = llm.requests[0]!;
    expect(r.model).toBe("nvidia/Nemotron-3.5-Super-VL");
    expect(r.reasoningEffort).toBe("none");
    expect(r.temperature).toBe(0.2);
    expect(imageCount(r)).toBe(1);
    expect(res.speech).toEqual(["Careful: a hot pan at 2 o'clock, within reach.", "A kettle at 12 o'clock, about an arm's length away."]);
    expect(res.frames_used).toBe(1);
    expect(res.metrics.calls).toHaveLength(1);
  });

  it("turns thinking on only when asked to look harder", async () => {
    const { llm, ctx } = setup(() => visionJson([{ content: "a mug" }]));
    await see(ctx, req({ skill: "describe", frames: [FRAME_A], look_harder: true }));
    expect(llm.requests[0]?.reasoningEffort).toBe("high");
  });
});

describe("read with two frames", () => {
  const total = (value: string) => visionJson([{ kind: "text", content: "Total" }, { kind: "number", content: value, number_kind: "price" }]);

  it("speaks a number both frames agree on", async () => {
    const { llm, ctx } = setup(() => total("$12.50"));
    const res = await see(ctx, req({ skill: "read", frames: [FRAME_A, FRAME_B] }));
    expect(llm.requests).toHaveLength(2);
    expect(res.speech).toEqual(["Total", "$12.50"]);
    expect(res.numbers).toEqual({ agreed: 1, adjudicated: 0, abstained: 0 });
  });

  it("asks Ultra when frames disagree, and abstains when Ultra does", async () => {
    const { llm, ctx } = setup((r) => {
      if (r.lane === "judge") return JSON.stringify({ agree: false, best_reading: "", should_abstain: true, reason: "different digits" });
      return firstImage(r) === FRAME_A ? total("$12.50") : total("$17.50");
    });
    const res = await see(ctx, req({ skill: "read", frames: [FRAME_A, FRAME_B] }));
    const judge = llm.requests.find((r) => r.lane === "judge");
    expect(judge?.model).toBe("nvidia/Nemotron-3-Ultra-550b-a55b");
    expect(imageCount(judge!)).toBe(0);
    expect(res.speech).toEqual(["Total", "(number unclear)", NUMBER_ABSTAIN]);
    expect(res.numbers).toEqual({ agreed: 0, adjudicated: 0, abstained: 1 });
  });

  it("rejects an Ultra reading that no frame produced", async () => {
    const { ctx } = setup((r) => {
      if (r.lane === "judge") return JSON.stringify({ agree: true, best_reading: "$15.00", should_abstain: false, reason: "average" });
      return firstImage(r) === FRAME_A ? total("$12.50") : total("$17.50");
    });
    const res = await see(ctx, req({ skill: "read", frames: [FRAME_A, FRAME_B] }));
    expect(res.speech).toContain(NUMBER_ABSTAIN);
  });

  it("speaks Ultra's reading plainly when it explains the disagreement", async () => {
    const cutOff = visionJson([{ kind: "text", content: "Total" }, { kind: "number", content: "$12.5", number_kind: "price", confidence: 0.6 }], {
      image_quality: { blur: false, too_dark: false, glare: false, cut_off: "right" },
    });
    const { ctx } = setup((r) => {
      if (r.lane === "judge") return JSON.stringify({ agree: true, best_reading: "$12.50", should_abstain: false, reason: "frame 2 cut off" });
      return firstImage(r) === FRAME_A ? total("$12.50") : cutOff.replace('"$12.5"', '"$12"');
    });
    const res = await see(ctx, req({ skill: "read", frames: [FRAME_A, FRAME_B] }));
    expect(res.speech).toEqual(["Total", "$12.50"]);
    expect(res.numbers).toEqual({ agreed: 0, adjudicated: 1, abstained: 0 });
  });

  it("abstains on numbers with a single frame", async () => {
    const { llm, ctx } = setup(() => total("$12.50"));
    const res = await see(ctx, req({ skill: "read", frames: [FRAME_A] }));
    expect(llm.requests).toHaveLength(1);
    expect(res.speech).toContain(NUMBER_ABSTAIN);
  });

  it("still reads the text when the second frame's call fails", async () => {
    const { ctx } = setup((r) => (firstImage(r) === FRAME_A ? total("$12.50") : new Error("timeout")));
    const res = await see(ctx, req({ skill: "read", frames: [FRAME_A, FRAME_B] }));
    expect(res.speech).toEqual(["Total", "(number unclear)", NUMBER_ABSTAIN]);
    expect(res.metrics.calls).toHaveLength(1);
  });

  it("skips Ultra when adjudication is disabled", async () => {
    const { llm, ctx } = setup((r) => (firstImage(r) === FRAME_A ? total("$12.50") : total("$17.50")), { ENABLE_ADJUDICATION: "false" });
    const res = await see(ctx, req({ skill: "read", frames: [FRAME_A, FRAME_B] }));
    expect(llm.requests.some((r) => r.lane === "judge")).toBe(false);
    expect(res.speech).toContain(NUMBER_ABSTAIN);
  });

  it("uses the better frame when the first one is unusable", async () => {
    const { ctx } = setup((r) =>
      firstImage(r) === FRAME_A
        ? visionJson([{ kind: "text", content: "Dea", confidence: 0.4 }], { image_quality: { blur: true, too_dark: false, glare: false, cut_off: "none" } })
        : visionJson([{ kind: "text", content: "Dear Sam" }]),
    );
    const res = await see(ctx, req({ skill: "read", frames: [FRAME_A, FRAME_B] }));
    expect(res.speech).toEqual(["Dear Sam"]);
  });
});

describe("enrol, match, label, step check", () => {
  const ok = { image_quality: { blur: false, too_dark: false, glare: false, cut_off: "none" }, can_answer: true, camera_guidance: "" };

  it("enrol: describes the object and asks to confirm", async () => {
    const { ctx } = setup(() => JSON.stringify({ ...ok, label_guess: "keys", description: "Brass key ring with two silver keys and a red tag", confidence: 0.9 }));
    const res = await see(ctx, req({ skill: "enrol", frames: [FRAME_A], context: { label: "house keys" } }));
    expect(res.speech).toEqual(["I see brass key ring with two silver keys and a red tag.", "Should I remember this as your house keys? Say yes or no."]);
  });

  it("enrol: refuses to remember a person", async () => {
    const { ctx } = setup(() => JSON.stringify({ ...ok, label_guess: "my friend", description: "a woman in a blue coat", confidence: 0.9 }));
    const res = await see(ctx, req({ skill: "enrol", frames: [FRAME_A] }));
    expect(res.status).toBe("refused");
  });

  it("match: sends reference thumbnails before the current frame", async () => {
    const { llm, ctx } = setup(() => JSON.stringify({ ...ok, visible: true, confidence: 0.85, position_clock: 2, distance: "within_reach", reason: "red tag" }));
    const res = await see(ctx, req({ skill: "match", frames: [FRAME_A], references: [THUMB, THUMB], context: { label: "house keys", description: "red tag" } }));
    expect(imageCount(llm.requests[0]!)).toBe(3);
    expect(userText(llm.requests[0]!)).toContain("LAST image");
    expect(res.speech).toEqual(["I can see your house keys at 2 o'clock, within reach."]);
  });

  it("match: confident absence is said plainly; low confidence is not", async () => {
    const absent = setup(() => JSON.stringify({ ...ok, visible: false, confidence: 0.8, position_clock: 0, distance: "unknown", reason: "" }));
    expect((await see(absent.ctx, req({ skill: "match", frames: [FRAME_A], references: [THUMB], context: { label: "wallet" } }))).speech).toEqual(["I don't see your wallet here."]);
    const unsure = setup(() => JSON.stringify({ ...ok, visible: false, confidence: 0.4, position_clock: 0, distance: "unknown", reason: "" }));
    expect((await see(unsure.ctx, req({ skill: "match", frames: [FRAME_A], references: [THUMB], context: { label: "wallet" } }))).speech[0]).toContain("can't tell");
  });

  it("label: needs both frames to agree on the model number", async () => {
    const label = (m: string) => JSON.stringify({ ...ok, appliance_type: "microwave", brand: "Acme", model_number: m, confidence: 0.9 });
    const agree = setup(() => label("MW-2041"));
    const a = await see(agree.ctx, req({ skill: "label", frames: [FRAME_A, FRAME_B] }));
    expect(a.speech).toEqual(["This is an Acme microwave, model MW-2041."]);
    expect(a.label?.model_number_verified).toBe(true);
    const differ = setup((r) => label(firstImage(r) === FRAME_A ? "MW-2041" : "MW-2047"));
    const b = await see(differ.ctx, req({ skill: "label", frames: [FRAME_A, FRAME_B] }));
    expect(b.speech).toEqual(["I can't read the model number reliably. Move closer to the label and hold still."]);
  });

  it("label: a guidance answer is never verified, even if both frames agree", async () => {
    const blurry = JSON.stringify({ ...ok, image_quality: { ...ok.image_quality, blur: true }, appliance_type: "microwave", brand: "Acme", model_number: "MW-2041", confidence: 0.6 });
    const { ctx } = setup(() => blurry);
    const res = await see(ctx, req({ skill: "label", frames: [FRAME_A, FRAME_B] }));
    expect(res.status).toBe("guidance");
    expect(res.label?.model_number_verified).toBe(false);
  });

  it("charges billed calls to the budget when a request fails", async () => {
    const { ctx } = setup(() => "not json at all");
    await expect(see(ctx, req({ skill: "describe", frames: [FRAME_A] }))).rejects.toBeTruthy();
    expect(ctx.spend.snapshot().spent_usd).toBeGreaterThan(0);
  });

  it("step check: screens the model's observation", async () => {
    const { ctx } = setup(() => JSON.stringify({ ...ok, step_done: "no", confidence: 0.8, observation: "The Start button is not lit yet. Press it firmly." }));
    const res = await see(ctx, req({ skill: "step_check", frames: [FRAME_A], context: { instruction: "Press Start", visual_check: "Start is lit" } }));
    expect(res.speech).toEqual(["It doesn't look done yet. The Start button is not lit yet."]);
  });

  it("model number comparison ignores case, spaces and dashes", () => {
    expect(sameModelNumber("mw 2041", "MW-2041")).toBe(true);
    expect(sameModelNumber("MW2041", "MW2047")).toBe(false);
    expect(sameModelNumber("", "")).toBe(false);
  });
});

describe("simple mode", () => {
  it("plans from the scene with Lightning and speaks one step", async () => {
    const { llm, ctx } = setup((r) => {
      if (r.lane === "fast") return JSON.stringify({ summary: "Let's tidy the floor.", steps: ["Put the clothes in the basket.", "Put the books on the shelf."], encouragement: "You can do it." });
      return visionJson([{ content: "clothes on the floor" }, { content: "a laundry basket", position_clock: 3 }]);
    });
    const res = await see(ctx, req({ skill: "plan", frames: [FRAME_A], mode: "simple", context: { goal: "tidy my room", user_name: "Ada" } }));
    const fast = llm.requests.find((r) => r.lane === "fast");
    expect(fast?.model).toBe("nvidia/Nemotron-3_5-Lightning");
    expect(userText(fast!)).toContain("A laundry basket at 3 o'clock.");
    expect(res.plan?.steps).toEqual(["Put the clothes in the basket.", "Put the books on the shelf."]);
    expect(res.speech).toEqual(["Let's tidy the floor.", "Step 1: Put the clothes in the basket.", "You're doing great, Ada.", "Did that work?"]);
  });

  it("screens the plan summary and steps like any model text", async () => {
    const { ctx } = setup((r) => {
      if (r.lane === "fast") return JSON.stringify({ summary: "The road is clear, so you can cross now.", steps: ["Ask the man by the door for help.", "Put the cup in the sink."], encouragement: "Go!" });
      return visionJson([{ content: "a cup", position_clock: 12 }]);
    });
    const res = await see(ctx, req({ skill: "plan", frames: [FRAME_A], mode: "simple", context: { goal: "clear the table" } }));
    expect(res.plan?.steps).toEqual(["Put the cup in the sink."]);
    expect(res.speech[0]).toBe("Let's clear the table.");
    expect(res.speech.join(" ")).not.toMatch(/cross|man/);
  });

  it("refuses an unsafe goal before looking", async () => {
    const { llm, ctx } = setup(() => visionJson([]));
    const res = await see(ctx, req({ skill: "plan", frames: [FRAME_A], mode: "simple", context: { goal: "cross the road" } }));
    expect(res.status).toBe("refused");
    expect(llm.requests).toHaveLength(0);
  });

  it("keeps Read verbatim in simple mode", async () => {
    const long = "Your appointment has been rescheduled to the following week owing to unforeseen circumstances beyond our control";
    const { llm, ctx } = setup(() => visionJson([{ kind: "text", content: long }]));
    const res = await see(ctx, req({ skill: "read", frames: [FRAME_A], mode: "simple" }));
    expect(res.speech).toEqual([long]);
    expect(llm.requests.every((r) => r.lane === "vision")).toBe(true);
  });
});
