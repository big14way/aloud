import { z } from "zod";
import type { SeeRequest, SeeResponse } from "../shared/api.js";
import { THRESHOLDS } from "../shared/config.js";
import { enforceEasy, stepTurn } from "../shared/easy.js";
import { type NumberVerdict, type VisionSkill, clockPhrase, distancePhrase, guidancePhrase, hasQualityIssue, qualityGate, render } from "../shared/gates.js";
import { clamp01, clampClock, normalizeRead } from "../shared/normalize.js";
import { compareFrames, hasNumber, numericTokens } from "../shared/numbers.js";
import { REFUSALS, checkUtterance, givesDosingAdvice, hasTrafficContext, looksLikeMedicine, makesTrafficClaim, mentionsPerson } from "../shared/safety.js";
import {
  Adjudication,
  LabelRead,
  MatchRead,
  ObjectDescription,
  SimplePlan,
  StepCheck,
  VisionRead,
  type VisionItem,
} from "../shared/schemas.js";
import { type Ctx, Meter, withTextLane } from "./context.js";
import { chatJson, errorMetrics, type JsonCall, type Message, ModelError } from "./llm.js";
import {
  ADJUDICATE_SYSTEM,
  ENROL_PROMPT,
  LABEL_PROMPT,
  SKILL_PROMPTS,
  VISION_SYSTEM,
  matchPrompt,
  stepCheckPrompt,
} from "./prompts.js";
import { shapeEasy } from "./shape.js";

/** Rethrow a frame failure whose billed calls were already charged. */
function withoutMetrics(err: unknown): unknown {
  if (err instanceof ModelError) err.metrics = [];
  return err;
}

const MAX_TOKENS: Record<SeeRequest["skill"], number> = {
  describe: 800,
  read: 1500,
  what_is: 400,
  enrol: 400,
  match: 300,
  label: 300,
  step_check: 300,
  plan: 500,
};

/** At most this many disputed numbers go to Ultra per request; the rest abstain. */
const MAX_ADJUDICATIONS = 3;

function visionCall<T>(ctx: Ctx, req: SeeRequest, schema: z.ZodType<T>, name: string, instruction: string, images: string[]): Promise<JsonCall<T>> {
  const content: Message["content"] = [
    ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
    { type: "text" as const, text: instruction },
  ];
  const maxTokens = MAX_TOKENS[req.skill];
  return chatJson(
    ctx.llm,
    {
      lane: "vision",
      model: ctx.cfg.models.vision,
      messages: [
        { role: "system", content: VISION_SYSTEM },
        { role: "user", content } as Message,
      ],
      temperature: 0.2,
      // Thinking stays off on the interactive path; "look harder" is the deliberate slow path.
      reasoningEffort: req.look_harder ? "high" : "none",
      maxTokens: req.look_harder ? maxTokens + 4000 : maxTokens,
    },
    schema,
    name,
    ctx.cfg.jsonMode,
  );
}

function base(req: SeeRequest, meter: Meter, framesUsed: number): Omit<SeeResponse, "status" | "speech" | "confidence" | "flags"> {
  return { ok: true, skill: req.skill, frames_used: framesUsed, metrics: meter.summary() };
}

export async function see(ctx: Ctx, req: SeeRequest): Promise<SeeResponse> {
  const meter = new Meter(ctx.spend);
  try {
    switch (req.skill) {
      case "describe":
      case "read":
      case "what_is":
        return await seeAndSay(ctx, req, req.skill, meter);
      case "enrol":
        return await enrol(ctx, req, meter);
      case "match":
        return await match(ctx, req, meter);
      case "label":
        return await label(ctx, req, meter);
      case "step_check":
        return await stepCheck(ctx, req, meter);
      case "plan":
        return await plan(ctx, req, meter);
    }
  } catch (err) {
    // Calls billed before a failure still count against the daily budget.
    meter.add(errorMetrics(err));
    throw err;
  }
}

/** Model text that may be spoken: no people, traffic judgements, dosing or medicine. */
function speakable(text: string): boolean {
  return Boolean(text.trim()) && !mentionsPerson(text) && !makesTrafficClaim(text) && !givesDosingAdvice(text) && !looksLikeMedicine(text);
}

/** Run frame calls in parallel; charge every billed call even if one of them fails. */
async function frameCalls<T>(meter: Meter, calls: Promise<JsonCall<T>>[]): Promise<PromiseSettledResult<JsonCall<T>>[]> {
  const results = await Promise.allSettled(calls);
  for (const r of results) meter.add(r.status === "fulfilled" ? r.value.metrics : errorMetrics(r.reason));
  return results;
}

async function seeAndSay(ctx: Ctx, req: SeeRequest, skill: VisionSkill, meter: Meter): Promise<SeeResponse> {
  // Read uses both frames so numbers can be cross-checked; the others need one.
  const frames = skill === "read" ? req.frames : req.frames.slice(0, 1);
  const [first, extra] = await frameCalls(meter, frames.map((f) => visionCall(ctx, req, VisionRead, "vision_read", SKILL_PROMPTS[skill], [f])));
  // The first frame must succeed. If only the second fails, numbers abstain but the text is still read.
  if (first!.status === "rejected") throw withoutMetrics(first!.reason);
  let primary = normalizeRead(first!.value.data);
  let second = extra?.status === "fulfilled" ? normalizeRead(extra.value.data) : null;
  if (second && !qualityGate(primary, skill).pass && qualityGate(second, skill).pass) [primary, second] = [second, primary];

  let numbers: Map<number, NumberVerdict> | undefined;
  let counts: SeeResponse["numbers"];
  // Number checks (and any Ultra call) only matter when the read will be spoken, not for guidance.
  if (skill === "read" && qualityGate(primary, skill).pass) {
    const verdicts = await verifyNumbers(ctx, meter, primary, second);
    numbers = verdicts;
    counts = { agreed: 0, adjudicated: 0, abstained: 0 };
    primary.items.forEach((item, i) => {
      if (item.confidence < THRESHOLDS.unsure || !hasNumber(item) || numericTokens(item.content).length === 0) return;
      const v = verdicts.get(i);
      if (!v || v.source === "abstained") counts!.abstained++;
      else counts![v.source]++;
    });
  }

  const rendered = render({ skill, read: primary, numbers });
  let speech = rendered.speech;
  // Read stays verbatim in every mode. Describe and What-is are reworded in simple mode.
  if (req.mode === "simple" && skill !== "read" && rendered.status === "answered") {
    speech = (await shapeEasy(ctx, meter, speech)).speech;
  }
  return {
    ...base(req, meter, frames.length),
    status: rendered.status,
    speech,
    confidence: rendered.confidence,
    flags: rendered.flags,
    numbers: counts,
    read: primary,
    metrics: meter.summary(),
  };
}

/** Two-frame agreement for every number-bearing line; disagreements go to Ultra or abstain. */
async function verifyNumbers(ctx: Ctx, meter: Meter, a: { items: VisionItem[]; image_quality: VisionRead["image_quality"] }, b: VisionRead | null): Promise<Map<number, NumberVerdict>> {
  const verdicts = new Map<number, NumberVerdict>();
  if (!b) return verdicts;
  const { agreed, disputed } = compareFrames(a.items, b.items);
  for (const i of agreed) verdicts.set(i, { source: "agreed" });
  const eligible = disputed.filter((i) => (a.items[i]?.confidence ?? 0) >= THRESHOLDS.unsure);
  const canJudge = ctx.cfg.adjudication && !ctx.spend.exhausted();
  const toJudge = canJudge ? eligible.slice(0, MAX_ADJUDICATIONS) : [];
  for (const i of eligible) if (!toJudge.includes(i)) verdicts.set(i, { source: "abstained" });
  const results = await Promise.all(
    toJudge.map((i) =>
      adjudicate(ctx, meter, a, b, i).catch((err: unknown): NumberVerdict => {
        meter.add(errorMetrics(err));
        return { source: "abstained" };
      }),
    ),
  );
  toJudge.forEach((i, k) => verdicts.set(i, results[k] ?? { source: "abstained" }));
  return verdicts;
}

async function adjudicate(ctx: Ctx, meter: Meter, a: { items: VisionItem[]; image_quality: VisionRead["image_quality"] }, b: VisionRead, index: number): Promise<NumberVerdict> {
  const line = a.items[index]!.content;
  const candidates = [line, ...b.items.filter((i) => /\d/.test(i.content)).map((i) => i.content)];
  const evidence = {
    disputed_line_frame_1: line,
    frame_1: { image_quality: a.image_quality, lines: a.items.map((i) => ({ text: i.content, confidence: i.confidence })) },
    frame_2: { image_quality: b.image_quality, lines: b.items.map((i) => ({ text: i.content, confidence: i.confidence })) },
    allowed_best_readings: candidates,
  };
  const res = await chatJson(
    ctx.llm,
    {
      lane: "judge",
      model: ctx.cfg.models.judge,
      messages: [
        { role: "system", content: ADJUDICATE_SYSTEM },
        { role: "user", content: `best_reading must be copied exactly from allowed_best_readings.\n${JSON.stringify(evidence)}` },
      ],
      temperature: 0,
      reasoningEffort: "low",
      maxTokens: 2500,
    },
    Adjudication,
    "adjudication",
    ctx.cfg.jsonMode,
  );
  meter.add(res.metrics);
  const v = res.data;
  const best = v.best_reading.trim();
  // Code, not the judge, has the last word: the reading must be one a frame actually produced.
  if (v.should_abstain || !candidates.some((c) => c.trim() === best)) return { source: "abstained" };
  return { source: "adjudicated", reading: best, consistent: v.agree };
}

function qualityOnly(q: VisionRead["image_quality"], canAnswer: boolean, confidence: number, skill: VisionSkill): string | null {
  if (!canAnswer || (hasQualityIssue(q) && confidence < THRESHOLDS.plain)) return guidancePhrase(q, skill);
  return null;
}

async function enrol(ctx: Ctx, req: SeeRequest, meter: Meter): Promise<SeeResponse> {
  const res = await visionCall(ctx, req, ObjectDescription, "object_description", ENROL_PROMPT, req.frames.slice(0, 1));
  meter.add(res.metrics);
  const d = { ...res.data, confidence: clamp01(res.data.confidence) };
  const label = (req.context?.label || d.label_guess).trim();
  const guidance = qualityOnly(d.image_quality, d.can_answer, d.confidence, "what_is");
  const common = { ...base(req, meter, 1), enrol: d, metrics: meter.summary() };
  if (guidance) return { ...common, status: "guidance", speech: [guidance], confidence: 0, flags: ["quality_gate"] };
  if (mentionsPerson(d.description) || mentionsPerson(d.label_guess)) {
    return { ...common, status: "refused", speech: ["I can't remember people. I can remember objects, like keys or a wallet."], confidence: 0, flags: ["person_refused"] };
  }
  if (d.confidence < THRESHOLDS.trust) {
    return { ...common, status: "guidance", speech: ["I can't see one object clearly. Hold it about an arm's length away, on its own, and try again."], confidence: d.confidence, flags: [] };
  }
  const description = d.description.replace(/[\s.]+$/, "");
  return {
    ...common,
    status: "answered",
    speech: [`I see ${description.charAt(0).toLowerCase()}${description.slice(1)}.`, `Should I remember this as your ${label}? Say yes or no.`],
    confidence: d.confidence,
    flags: [],
  };
}

async function match(ctx: Ctx, req: SeeRequest, meter: Meter): Promise<SeeResponse> {
  const refs = req.references ?? [];
  const label = req.context?.label ?? "object";
  const common = base(req, meter, 1);
  if (refs.length === 0) {
    return { ...common, status: "empty", speech: [`I don't have a picture of your ${label} yet.`], confidence: 0, flags: [] };
  }
  const res = await visionCall(ctx, req, MatchRead, "match_read", matchPrompt(label, req.context?.description ?? "", refs.length), [...refs, req.frames[0]!]);
  meter.add(res.metrics);
  const m = { ...res.data, confidence: clamp01(res.data.confidence), position_clock: clampClock(res.data.position_clock) };
  const where = [clockPhrase(m.position_clock), distancePhrase(m.distance)].filter(Boolean).join(", ");
  const at = where ? ` ${where}` : "";
  const guidance = qualityOnly(m.image_quality, m.can_answer, m.confidence, "describe");
  let speech: string;
  let status: SeeResponse["status"] = "answered";
  if (guidance) {
    speech = guidance;
    status = "guidance";
  } else if (m.visible && m.confidence >= THRESHOLDS.trust) speech = `I can see your ${label}${at}.`;
  else if (m.visible && m.confidence >= THRESHOLDS.unsure) speech = `I might see your ${label}${at}, but I'm not sure.`;
  else if (!m.visible && m.confidence >= THRESHOLDS.trust) speech = `I don't see your ${label} here.`;
  else speech = `I can't tell if your ${label} is here. Try moving the camera slowly.`;
  return { ...common, status, speech: [speech], confidence: m.confidence, flags: [], match: m, metrics: meter.summary() };
}

/** Model numbers match if they agree ignoring case, spaces and dashes. */
export function sameModelNumber(a: string, b: string): boolean {
  const n = (s: string) => s.toUpperCase().replace(/[\s\-_./]/g, "");
  return n(a).length >= 2 && n(a) === n(b);
}

async function label(ctx: Ctx, req: SeeRequest, meter: Meter): Promise<SeeResponse> {
  const [first, extra] = await frameCalls(meter, req.frames.map((f) => visionCall(ctx, req, LabelRead, "label_read", LABEL_PROMPT, [f])));
  if (first!.status === "rejected") throw withoutMetrics(first!.reason);
  const a = { ...first!.value.data, confidence: clamp01(first!.value.data.confidence) };
  const b = extra?.status === "fulfilled" ? extra.value.data : null;
  const guidance = qualityOnly(a.image_quality, a.can_answer, a.confidence, "read");
  // Only an answered read with two agreeing frames is verified.
  const verified = !guidance && b !== null && b.can_answer && sameModelNumber(a.model_number, b.model_number);
  const common = { ...base(req, meter, req.frames.length), label: { ...a, model_number_verified: verified }, metrics: meter.summary() };
  if (guidance) return { ...common, status: "guidance", speech: [guidance], confidence: 0, flags: ["quality_gate"] };
  if (!a.model_number.trim()) {
    return { ...common, status: "empty", speech: ["I can't find a model number. Look for a sticker on the back, the side, or inside the door."], confidence: a.confidence, flags: [] };
  }
  if (!verified) {
    return { ...common, status: "guidance", speech: ["I can't read the model number reliably. Move closer to the label and hold still."], confidence: a.confidence, flags: ["number_abstained"] };
  }
  const what = [a.brand.trim(), a.appliance_type.trim()].filter(Boolean).join(" ") || "appliance";
  const article = /^[aeiou]/i.test(what) ? "an" : "a";
  return { ...common, status: "answered", speech: [`This is ${article} ${what}, model ${a.model_number.trim()}.`], confidence: a.confidence, flags: ["number_agreed"] };
}

async function stepCheck(ctx: Ctx, req: SeeRequest, meter: Meter): Promise<SeeResponse> {
  const instruction = req.context?.instruction ?? "";
  const res = await visionCall(ctx, req, StepCheck, "step_check", stepCheckPrompt(instruction, req.context?.visual_check ?? ""), req.frames.slice(0, 1));
  meter.add(res.metrics);
  const s = { ...res.data, confidence: clamp01(res.data.confidence) };
  const common = { ...base(req, meter, 1), step: s, metrics: meter.summary() };
  const guidance = qualityOnly(s.image_quality, s.can_answer, s.confidence, "describe");
  if (guidance) return { ...common, status: "guidance", speech: [guidance], confidence: 0, flags: ["quality_gate"] };
  // The observation is model text, so it is screened and cut to one short sentence.
  const raw = s.observation.split(/(?<=[.!?])\s/)[0]?.trim() ?? "";
  const safe = speakable(raw) && raw.split(/\s+/).length <= 20;
  const note = safe ? ` ${raw.replace(/[.!?]*$/, ".")}` : "";
  let speech: string[];
  if (s.step_done === "yes" && s.confidence >= THRESHOLDS.trust) speech = ["That step looks done."];
  else if (s.step_done === "no" && s.confidence >= THRESHOLDS.trust) speech = [`It doesn't look done yet.${note}`];
  else speech = [`I can't tell if that worked.${note}`];
  if (req.mode === "simple") speech = enforceEasy(speech);
  return { ...common, status: "answered", speech, confidence: s.confidence, flags: [] };
}

export const PLAN_SYSTEM = `You help a person with a cognitive disability do one everyday task, one small step at a time.
Use only the things listed in the scene. Make at most 5 steps. Each step is one action in at most 12 easy words.
If something is hot or sharp, say "carefully". Never involve roads, medicine, or electrics beyond a normal switch.
summary: one short sentence about the plan. encouragement: one short warm sentence.
Reply with JSON only.`;

async function plan(ctx: Ctx, req: SeeRequest, meter: Meter): Promise<SeeResponse> {
  const goal = req.context?.goal?.trim() || "tidy up this space";
  // The goal is the user's own words; unsafe goals are refused before looking.
  const refusal = checkUtterance(goal) ?? (hasTrafficContext(goal) ? "traffic" : looksLikeMedicine(goal) ? "dosing" : null);
  if (refusal) {
    return { ...base(req, meter, 0), status: "refused", speech: [REFUSALS[refusal]], confidence: 0, flags: ["goal_refused"], metrics: meter.summary() };
  }
  const scene = await seeAndSay(ctx, { ...req, skill: "describe", mode: "standard" }, "describe", meter);
  if (scene.status !== "answered") return { ...scene, skill: "plan" };
  const res = await withTextLane(ctx, (lane) =>
    chatJson(
      ctx.llm,
      {
        ...lane,
        messages: [
          { role: "system", content: PLAN_SYSTEM },
          { role: "user", content: `Goal: ${goal}\nScene:\n${scene.speech.join("\n")}` },
        ],
        temperature: 0.3,
        maxTokens: 500,
        reasoningEffort: "none",
      },
      SimplePlan,
      "simple_plan",
      ctx.cfg.jsonMode,
    ),
  );
  meter.add(res.metrics);
  const steps = res.data.steps
    .map((s) => s.trim())
    .filter((s) => speakable(s))
    .slice(0, 5)
    .map((s) => enforceEasy(s).join(" "));
  if (steps.length === 0) {
    return { ...scene, skill: "plan", status: "empty", speech: ["I couldn't make a plan from this picture. Try pointing the phone at the whole area."], metrics: meter.summary() };
  }
  const name = req.context?.user_name;
  // The summary is model text too: it is screened like the steps.
  const summary = enforceEasy(speakable(res.data.summary) ? res.data.summary : `Let's ${goal}.`);
  return {
    ...scene,
    skill: "plan",
    status: "answered",
    speech: [...summary, ...stepTurn(steps[0]!, 0, steps.length, name)],
    plan: { steps },
    metrics: meter.summary(),
  };
}
