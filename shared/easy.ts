import { EASY_MAX_WORDS } from "./config.js";

// Easy-language mode for people with cognitive disabilities. The rules are checked
// in code: short sentences, plain words, one step per turn, encouragement, and a
// check-in question.

/** Jargon -> plain word. Applied deterministically before any check. */
export const PLAIN_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bapproximately\b/gi, "about"],
  [/\butili[sz]e\b/gi, "use"],
  [/\bcommence\b/gi, "start"],
  [/\bterminate\b/gi, "stop"],
  [/\bproceed\b/gi, "go on"],
  [/\bsubsequently\b/gi, "then"],
  [/\bsufficient\b/gi, "enough"],
  [/\bassistance\b/gi, "help"],
  [/\billuminated\b/gi, "lit"],
  [/\bobstruction\b/gi, "something in the way"],
  [/\badjacent to\b/gi, "next to"],
  [/\bensure\b/gi, "make sure"],
  [/\bprior to\b/gi, "before"],
  [/\badditional\b/gi, "more"],
  [/\brequires?\b/gi, "needs"],
  [/\bpurchase\b/gi, "buy"],
  [/\battempt\b/gi, "try"],
  [/\bindicates?\b/gi, "shows"],
  [/\bretrieve\b/gi, "get"],
  [/\breceptacle\b/gi, "bin"],
  [/\bdeposit\b/gi, "put"],
  [/\bfacilitate\b/gi, "help"],
  [/\bnumerous\b/gi, "many"],
  [/\bmodify\b/gi, "change"],
  [/\bconfigure\b/gi, "set up"],
  [/\bactivate\b/gi, "turn on"],
  [/\bdeactivate\b/gi, "turn off"],
];

export const ENCOURAGEMENTS = ["You're doing great.", "Nice work.", "Good job.", "Well done.", "You've got this."] as const;

export const CHECK_IN = "Did that work?";

export function plainWords(text: string): string {
  let out = text;
  for (const [re, plain] of PLAIN_WORDS) {
    out = out.replace(re, (match) => (match[0] === match[0]?.toUpperCase() ? plain.charAt(0).toUpperCase() + plain.slice(1) : plain));
  }
  return out;
}

export function words(sentence: string): string[] {
  return sentence.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/** Split text into sentences on . ! ? followed by space or end. Keeps decimals like 12.50 together. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=["'(\p{Lu}\p{N}])/u)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

/** Break one long sentence into pieces of at most `max` words, preferring commas and "and". */
export function hardWrap(sentence: string, max = EASY_MAX_WORDS): string[] {
  const ws = words(sentence);
  if (ws.length <= max) return [sentence];
  const out: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length === 0) return;
    let s = current.join(" ").replace(/[,;:]$/, "");
    if (!/[.!?]$/.test(s)) s += ".";
    out.push(s.charAt(0).toUpperCase() + s.slice(1));
    current = [];
  };
  for (const w of ws) {
    current.push(w);
    const breakHere = /[,;:]$/.test(w) && current.length >= 4;
    if (current.length >= max || breakHere) flush();
  }
  flush();
  return out;
}

export interface EasyViolation {
  sentence: string;
  rule: "too_long" | "jargon";
}

export function checkEasy(sentences: string[], max = EASY_MAX_WORDS): EasyViolation[] {
  const out: EasyViolation[] = [];
  for (const s of sentences) {
    if (words(s).length > max) out.push({ sentence: s, rule: "too_long" });
    if (PLAIN_WORDS.some(([re]) => new RegExp(re.source, "i").test(s))) out.push({ sentence: s, rule: "jargon" });
  }
  return out;
}

/** Deterministic fallback: plain words, then hard-wrap anything still too long. */
export function enforceEasy(text: string | string[], max = EASY_MAX_WORDS): string[] {
  const sentences = (Array.isArray(text) ? text : [text]).flatMap((t) => splitSentences(plainWords(t)));
  return sentences.flatMap((s) => hardWrap(s, max));
}

export function encouragement(turn: number): string {
  return ENCOURAGEMENTS[Math.abs(turn) % ENCOURAGEMENTS.length] ?? ENCOURAGEMENTS[0];
}

// A number the model put in front of a step ("1.", "2)", "/1/", "Step 3:"). Aloud numbers
// steps itself, so a kept one is read twice: "Step 1: /1/ Fill the kettle." The lookahead
// keeps times and amounts at the start of a step ("10:30", "1.5 cups").
const STEP_NUMBER = /^\s*(?:step\s*\d{1,2}\s*[:.)\-–—]?|#\d{1,2}|[(\/[]?\d{1,2}\s*[)\/.:\-–—\]])(?!\d)\s*/i;

export function stripStepNumber(step: string): string {
  const out = step.replace(STEP_NUMBER, "");
  return out.trim() ? out : step;
}

/** One step, spoken as: "Step 2: <step>. <encouragement, name>. Did that work?" */
export function stepTurn(step: string, index: number, total: number, name?: string): string[] {
  const body = enforceEasy(stripStepNumber(step));
  const first = body[0] ?? step;
  const lead = total > 1 ? hardWrap(`Step ${index + 1}: ${first}`) : [first];
  const cheer = encouragement(index);
  const personal = name ? `${cheer.replace(/\.$/, "")}, ${name}.` : cheer;
  return [...lead, ...body.slice(1), personal, CHECK_IN];
}
