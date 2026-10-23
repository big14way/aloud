import { z } from "zod";
import { checkEasy, enforceEasy, plainWords } from "../shared/easy.js";
import { numericTokens } from "../shared/numbers.js";
import { givesDosingAdvice, hasTrafficContext, makesTrafficClaim, mentionsPerson, personWords } from "../shared/safety.js";
import { type Ctx, type Meter, withTextLane } from "./context.js";
import { chatJson, errorMetrics } from "./llm.js";

// Easy-language rewrite. The model rewords; code checks that every fact, number,
// quote and hedge survived, and falls back to a deterministic rewrite if not.

const ShapeOut = z.object({ sentences: z.array(z.string()) });

export const SHAPE_SYSTEM = `You rewrite short spoken answers for a person with a cognitive disability.
Rules:
- Easy, everyday words. Every sentence has at most 15 words.
- Keep every fact. Add nothing that is not in the input.
- Keep hedges exactly: "I think", "not sure", "can't confirm", "last confirmed", "haven't confirmed".
- Copy numbers and anything in quotes exactly.
- Be warm and calm. Do not judge.
Reply with JSON only: {"sentences": ["...", "..."]}`;

/** Words that change the meaning of an answer if dropped. */
export const HEDGES = ["not sure", "i think", "can't confirm", "last confirmed", "haven't confirmed", "don't have a confirmed", "which one", "careful", "pharmacist", "can't judge"];

function lower(xs: string[]): string {
  return xs.join(" ").toLowerCase().replace(/’/g, "'");
}

function quotes(text: string): string[] {
  return [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "").filter(Boolean);
}

/** Every reason the rewrite is not acceptable. Empty means it passes. */
export function shapeViolations(input: string[], output: string[], keep: string[] = []): string[] {
  const out: string[] = [];
  if (output.length === 0) return ["empty output"];
  for (const v of checkEasy(output)) out.push(`${v.rule}: "${v.sentence}"`);
  const inText = lower(input);
  const outText = lower(output);
  for (const h of [...HEDGES, ...keep.map((k) => k.toLowerCase())]) {
    if (inText.includes(h) && !outText.includes(h)) out.push(`dropped "${h}"`);
  }
  const inNums = numericTokens(input.join(" "));
  const outNums = numericTokens(output.join(" "));
  for (const n of inNums) if (!outNums.includes(n)) out.push(`dropped number ${n}`);
  for (const n of outNums) if (!inNums.includes(n)) out.push(`added number ${n}`);
  const joinedOut = output.join(" ");
  for (const q of quotes(input.join(" "))) if (!joinedOut.includes(q)) out.push(`changed quote "${q}"`);
  const street = input.some((s) => hasTrafficContext(s));
  if (output.some((s) => makesTrafficClaim(s, street))) out.push("traffic claim");
  if (output.some((s) => givesDosingAdvice(s))) out.push("dosing advice");
  // Rewording may not add anyone, or any detail about someone ("a person" -> "a sad old man").
  const before = personWords(input.join(" "));
  const added = [...personWords(output.join(" "))].filter((w) => !before.has(w));
  if (added.length > 0 || (!input.some((s) => mentionsPerson(s)) && output.some((s) => mentionsPerson(s)))) out.push("added a person");
  if (/\b(happy|sad|angry|upset|smiling|crying|old|young|elderly|tired|scared|pregnant|sick|drunk)\b/i.test(output.join(" ")) && before.size > 0) {
    const inText = input.join(" ").toLowerCase();
    for (const w of output.join(" ").toLowerCase().match(/\b(happy|sad|angry|upset|smiling|crying|old|young|elderly|tired|scared|pregnant|sick|drunk)\b/g) ?? []) {
      if (!inText.includes(w)) out.push(`added a detail about a person: ${w}`);
    }
  }
  return out;
}

export interface Shaped {
  speech: string[];
  source: "model" | "fallback" | "unchanged";
}

export async function shapeEasy(ctx: Ctx, meter: Meter, sentences: string[], keep: string[] = []): Promise<Shaped> {
  if (sentences.length === 0) return { speech: [], source: "unchanged" };
  if (checkEasy(sentences).length === 0) return { speech: sentences, source: "unchanged" };
  try {
    return await withTextLane(ctx, async (lane) => {
      const base = {
        ...lane,
        temperature: 0.2,
        maxTokens: 400,
        reasoningEffort: "none" as const,
      };
      const ask = async (extra: string) => {
        const res = await chatJson(
          ctx.llm,
          {
            ...base,
            messages: [
              { role: "system", content: SHAPE_SYSTEM },
              { role: "user", content: `Rewrite these sentences:\n${JSON.stringify(sentences)}${extra}` },
            ],
          },
          ShapeOut,
          "shaped_speech",
          ctx.cfg.jsonMode,
        );
        meter.add(res.metrics);
        return res.data.sentences.map((s) => plainWords(s.trim())).filter(Boolean);
      };
      const first = await ask("");
      const problems = shapeViolations(sentences, first, keep);
      if (problems.length === 0) return { speech: first, source: "model" as const };
      const second = await ask(`\n\nYour last rewrite broke these rules: ${problems.join("; ")}. Fix them.`);
      if (shapeViolations(sentences, second, keep).length === 0) return { speech: second, source: "model" as const };
      return { speech: enforceEasy(sentences), source: "fallback" as const };
    });
  } catch (err) {
    meter.add(errorMetrics(err));
    return { speech: enforceEasy(sentences), source: "fallback" };
  }
}
