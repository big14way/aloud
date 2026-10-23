import { THRESHOLDS } from "./config.js";
import { hasNumber, numericTokens } from "./numbers.js";
import {
  PHARMACIST_NOTE,
  REFUSALS,
  givesDosingAdvice,
  hasTrafficContext,
  looksLikeMedicine,
  makesTrafficClaim,
  mentionsPerson,
} from "./safety.js";
import type { Distance, ImageQuality, VisionItem, VisionRead } from "./schemas.js";

// Everything Aloud says about an image is produced here, from the structured read,
// by fixed rules. The model never writes the spoken sentence directly.

export type VisionSkill = "describe" | "read" | "what_is";
export type AnswerStatus = "answered" | "guidance" | "empty";

export const NUMBER_ABSTAIN = "I see a number but can't confirm it. Move closer.";
/** Describe and What-is use one frame, so their numbers are masked and checked by Read instead. */
export const NUMBER_DEFER = "Press Read to check the number.";

export interface NumberVerdict {
  /** "agreed": both frames gave the same value. "adjudicated": Ultra judged two different reads. */
  source: "agreed" | "adjudicated" | "abstained";
  reading?: string;
  /** For adjudicated readings: Ultra said the two reads are consistent. */
  consistent?: boolean;
}

export interface RenderInput {
  skill: VisionSkill;
  read: VisionRead;
  /** Verdicts for number-bearing items of `read`, keyed by item index. Missing means unverified. */
  numbers?: Map<number, NumberVerdict>;
}

export interface Rendered {
  status: AnswerStatus;
  speech: string[];
  /** Items below the "unsure" threshold that were not spoken. */
  dropped: number;
  /** Mean confidence of the items that were spoken (0 when none). */
  confidence: number;
  /** Safety rules that fired, for logging and evaluation. */
  flags: string[];
}

export function hasQualityIssue(q: ImageQuality): boolean {
  return q.blur || q.too_dark || q.glare || q.cut_off !== "none";
}

/** Fixed camera guidance. The model's own guidance text is logged, never spoken. */
export function guidancePhrase(q: ImageQuality, skill: VisionSkill): string {
  const subject = skill === "read" ? "The text is" : "It's";
  if (q.too_dark) return "Too dark. Try a light, or move toward the window.";
  switch (q.cut_off) {
    case "right":
      return `${subject} cut off on the right. Move the phone right.`;
    case "left":
      return `${subject} cut off on the left. Move the phone left.`;
    case "top":
      return `${subject} cut off at the top. Tilt the phone up.`;
    case "bottom":
      return `${subject} cut off at the bottom. Tilt the phone down.`;
    case "none":
      break;
  }
  if (q.blur) return "The picture is blurry. Hold the phone still and press again.";
  if (q.glare) return "There's glare. Tilt the phone a little and press again.";
  return "I can't see clearly. Hold the phone about an arm's length away and press again.";
}

/**
 * Quality gate: if the model says it cannot answer, or any quality flag is set and
 * no item reaches the plain threshold, Aloud speaks only the camera guidance.
 */
export function qualityGate(read: VisionRead, skill: VisionSkill): { pass: true } | { pass: false; guidance: string } {
  const strong = read.items.some((i) => i.confidence >= THRESHOLDS.plain);
  if (!read.can_answer || (hasQualityIssue(read.image_quality) && !strong)) {
    return { pass: false, guidance: guidancePhrase(read.image_quality, skill) };
  }
  return { pass: true };
}

export function clockPhrase(clock: number): string {
  return clock >= 1 && clock <= 12 ? `at ${clock} o'clock` : "";
}

export function distancePhrase(d: Distance): string {
  switch (d) {
    case "within_reach":
      return "within reach";
    case "arm_length":
      return "about an arm's length away";
    case "few_steps":
      return "a few steps away";
    case "far":
      return "far away";
    case "unknown":
      return "";
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "A kettle" -> "a kettle", but leaves proper text alone. */
function lowerArticle(s: string): string {
  return /^(A|An|The|Some)\s/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function stripEndPunctuation(s: string): string {
  return s.replace(/[\s.!?;,]+$/, "");
}

function where(item: VisionItem): string {
  return [clockPhrase(item.position_clock), distancePhrase(item.distance)].filter(Boolean).join(", ");
}

function personSentence(item: VisionItem): string {
  const parts = ["A person", distancePhrase(item.distance), clockPhrase(item.position_clock)].filter(Boolean);
  return `${parts.join(", ")}.`;
}

function maskNumbers(text: string): string {
  return text.replace(/(?:[$€£₦¥₹]\s?)?\d(?:[\d.,:/\-]*\d)?%?/g, "(number unclear)");
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

const KIND_ORDER: Record<VisionItem["kind"], number> = {
  hazard: 0,
  place: 1,
  person: 2,
  object: 2,
  text: 2,
  number: 2,
};

/** Upper bound on items spoken by Describe, so answers stay to a couple of sentences. */
export const DESCRIBE_MAX_ITEMS = 4;

export function render(input: RenderInput): Rendered {
  const { skill, read } = input;
  const flags: string[] = [];
  const gate = qualityGate(read, skill);
  if (!gate.pass) {
    flags.push("quality_gate");
    return { status: "guidance", speech: [gate.guidance], dropped: 0, confidence: 0, flags };
  }
  const result =
    skill === "read" ? renderRead(input, flags) : skill === "what_is" ? renderWhatIs(input, flags) : renderDescribe(input, flags);
  if (read.image_quality.cut_off !== "none" && result.speech.length > 0) {
    result.speech.push(guidancePhrase({ ...read.image_quality, too_dark: false }, skill));
    flags.push("cut_off_tip");
  }
  return { ...result, flags: [...new Set(flags)] };
}

type Body = Omit<Rendered, "flags">;

function renderDescribe(input: RenderInput, flags: string[]): Body {
  const { read } = input;
  const speech: string[] = [];
  const spokenConf: number[] = [];
  let dropped = 0;
  let trafficRefused = false;
  let medicineNoted = false;
  let numberNoted = false;

  const ordered = read.items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] || a.index - b.index);

  const streetScene = read.items.some((i) => hasTrafficContext(i.content));
  let numbersMasked = false;
  let spokenNonHazard = 0;
  for (const { item } of ordered) {
    if (item.confidence < THRESHOLDS.unsure) {
      dropped++;
      continue;
    }
    if (makesTrafficClaim(item.content, streetScene)) {
      if (!trafficRefused) speech.push(REFUSALS.traffic);
      trafficRefused = true;
      flags.push("traffic_claim_removed");
      continue;
    }
    if (item.kind !== "hazard" && spokenNonHazard >= DESCRIBE_MAX_ITEMS) continue;
    if (item.kind !== "hazard") spokenNonHazard++;
    spokenConf.push(item.confidence);

    if (item.kind === "person" || mentionsPerson(item.content)) {
      if (item.kind !== "person") flags.push("person_redacted");
      speech.push(personSentence(item));
      continue;
    }
    if (looksLikeMedicine(item.content) || givesDosingAdvice(item.content)) {
      flags.push("medicine");
      if (!medicineNoted) speech.push("There's a medicine label. Press Read to hear it word for word.");
      medicineNoted = true;
      continue;
    }
    let content = stripEndPunctuation(item.content);
    const loc = where(item);
    const digits = numericTokens(content).length > 0;
    if (item.kind === "number" || (item.number_kind !== "none" && !digits)) {
      // A single frame can't confirm a number. Point to Read, which uses two.
      if (!numberNoted) speech.push("There's a number here. Press Read to check it.");
      numberNoted = true;
      flags.push("number_deferred");
      continue;
    }
    if (digits) {
      content = maskNumbers(content);
      numbersMasked = true;
      flags.push("number_deferred");
    }
    const plain = item.confidence >= THRESHOLDS.plain;
    if (item.kind === "text") {
      speech.push(plain ? `There's text that says "${content}".` : `I think there's text that says "${content}", but I'm not sure.`);
    } else if (item.kind === "hazard") {
      speech.push(plain ? `Careful: ${lowerArticle(content)}${loc ? ` ${loc}` : ""}.` : `Careful, I think there's ${lowerArticle(content)}${loc ? ` ${loc}` : ""}, but I'm not sure.`);
    } else {
      speech.push(plain ? `${capitalize(content)}${loc ? ` ${loc}` : ""}.` : `I think there's ${lowerArticle(content)}${loc ? ` ${loc}` : ""}, but I'm not sure.`);
    }
  }
  if (numbersMasked) speech.push(NUMBER_DEFER);
  if (dropped > 0 && speech.length > 0) speech.push("There's more I can't make out.");
  if (speech.length === 0) {
    return {
      status: "empty",
      speech: [dropped > 0 ? "I can't make out what's here. Try moving closer or adding light." : "I don't see anything I can describe. Try pointing the phone a little differently."],
      dropped,
      confidence: 0,
    };
  }
  return { status: "answered", speech, dropped, confidence: mean(spokenConf) };
}

function renderRead(input: RenderInput, flags: string[]): Body {
  const { read, numbers } = input;
  const speech: string[] = [];
  const spokenConf: number[] = [];
  let dropped = 0;
  let numberAbstained = false;
  const medicine = read.medicine_label || read.items.some((i) => looksLikeMedicine(i.content));

  read.items.forEach((item, index) => {
    if (item.confidence < THRESHOLDS.unsure) {
      dropped++;
      return;
    }
    const content = item.content;
    let plain = item.confidence >= THRESHOLDS.plain;
    let spoken = content;
    if (hasNumber(item) && numericTokens(content).length > 0) {
      const verdict = numbers?.get(index);
      if (!verdict || verdict.source === "abstained") {
        spoken = maskNumbers(content);
        numberAbstained = true;
        flags.push("number_abstained");
      } else if (verdict.source === "adjudicated") {
        spoken = verdict.reading ?? content;
        flags.push("number_adjudicated");
        if (!verdict.consistent) plain = false;
      } else {
        flags.push("number_agreed");
      }
    }
    spokenConf.push(item.confidence);
    speech.push(plain ? spoken : `I think it says "${stripEndPunctuation(spoken)}", but I'm not sure.`);
  });

  if (dropped > 0) speech.push(speech.length > 0 ? "There's more text I can't read." : "There's text here, but I can't read it. Try moving closer or adding light.");
  if (numberAbstained) speech.push(NUMBER_ABSTAIN);
  if (medicine && speech.length > 0) {
    flags.push("medicine");
    speech.push(PHARMACIST_NOTE);
  }
  if (speech.length === 0) {
    return { status: "empty", speech: ["I don't see any text."], dropped, confidence: 0 };
  }
  return { status: spokenConf.length > 0 ? "answered" : "empty", speech, dropped, confidence: mean(spokenConf) };
}

function renderWhatIs(input: RenderInput, flags: string[]): Body {
  const { read } = input;
  const speech: string[] = [];
  const spokenConf: number[] = [];
  let dropped = 0;
  let numberNote = false;
  const streetScene = read.items.some((i) => hasTrafficContext(i.content));

  /** One frame can't confirm a number: mask it and send the user to Read. */
  const unverified = (text: string) => {
    if (numericTokens(text).length === 0) return text;
    numberNote = true;
    flags.push("number_deferred");
    return maskNumbers(text);
  };

  const usable = read.items.filter((i) => {
    if (i.confidence < THRESHOLDS.unsure) {
      dropped++;
      return false;
    }
    return true;
  });
  const main = usable.find((i) => i.kind === "object" || i.kind === "hazard" || i.kind === "person" || i.kind === "place");
  if (main) {
    spokenConf.push(main.confidence);
    if (main.kind === "person" || mentionsPerson(main.content)) {
      if (main.kind !== "person") flags.push("person_redacted");
      speech.push(personSentence(main));
    } else if (looksLikeMedicine(main.content) || givesDosingAdvice(main.content)) {
      flags.push("medicine");
      speech.push("This is a medicine. Press Read to hear the label word for word.");
    } else if (makesTrafficClaim(main.content, streetScene)) {
      flags.push("traffic_claim_removed");
      speech.push(REFUSALS.traffic);
    } else {
      const content = unverified(stripEndPunctuation(main.content));
      speech.push(main.confidence >= THRESHOLDS.plain ? `This is ${lowerArticle(content)}.` : `I think this is ${lowerArticle(content)}, but I'm not sure.`);
    }
  }
  const labels = usable.filter((i) => (i.kind === "text" || i.kind === "number") && i !== main).slice(0, 2);
  for (const t of labels) {
    if (looksLikeMedicine(t.content)) {
      if (!flags.includes("medicine")) speech.push("There's a medicine label. Press Read to hear it word for word.");
      flags.push("medicine");
      continue;
    }
    if (t.kind === "number" || (t.number_kind !== "none" && numericTokens(t.content).length === 0)) {
      numberNote = true;
      flags.push("number_deferred");
      continue;
    }
    spokenConf.push(t.confidence);
    const content = unverified(stripEndPunctuation(t.content));
    speech.push(t.confidence >= THRESHOLDS.plain ? `The label says "${content}".` : `I think the label says "${content}", but I'm not sure.`);
  }
  if (numberNote) speech.push(speech.length > 0 ? NUMBER_DEFER : "There's a number here. Press Read to check it.");
  if (speech.length === 0) {
    return {
      status: "empty",
      speech: ["I'm not sure what this is. Try holding it closer, about an arm's length away."],
      dropped,
      confidence: 0,
    };
  }
  return { status: "answered", speech, dropped, confidence: mean(spokenConf) };
}
