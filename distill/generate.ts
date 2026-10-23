// Teacher data for distilling Aloud's everyday text work into Nemotron 3 Nano 4B.
// Nemotron 3 Ultra on Token Factory is the teacher. Code validates every teacher
// output and keeps only examples that pass; held-out evaluation utterances are
// never used as seeds, so the student is scored on requests it has not seen.
//
//   npx tsx distill/generate.ts [--per-seed 10] [--shape 250] [--plan 150] [--concurrency 4]
//
// Writes distill/data/{train,val}.jsonl (gitignored) and distill/data/stats.json.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { render } from "../shared/gates.js";
import { type MemEvent, type MemObject, answerFind } from "../shared/memory.js";
import { givesDosingAdvice, looksLikeMedicine, makesTrafficClaim } from "../shared/safety.js";
import { SimplePlan, type VisionItem } from "../shared/schemas.js";
import { words } from "../shared/easy.js";

try {
  process.loadEnvFile(".env");
} catch {
  // Env may come from the shell.
}

const { createContext, Meter } = await import("../server/context.js");
const { chatJson, ModelError } = await import("../server/llm.js");
const { ROUTE_SYSTEM, ROUTE_TOOLS, decisionFromToolCall, stateNote } = await import("../server/route.js");
const { SHAPE_SYSTEM, shapeViolations } = await import("../server/shape.js");
const { PLAN_SYSTEM } = await import("../server/vision.js");

const args = process.argv.slice(2);
const opt = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const PER_SEED = opt("per-seed", 10);
const SHAPE_N = opt("shape", 250);
const PLAN_N = opt("plan", 150);
const CONCURRENCY = opt("concurrency", 4);

const ctx = createContext();
if (!ctx.cfg.nebiusApiKey) {
  console.error("NEBIUS_API_KEY is not set.");
  process.exit(1);
}
const teacher = { lane: "judge" as const, model: ctx.cfg.models.judge };
const meter = new Meter(ctx.spend);

// Deterministic randomness so a rerun produces the same inputs.
let seed = 20261023;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const sample = <T>(xs: readonly T[], n: number): T[] => [...xs].sort(() => rand() - 0.5).slice(0, n);

async function pool<T, R>(items: T[], fn: (item: T, i: number) => Promise<R | null>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fn(items[i]!, i);
          if (r !== null) out.push(r);
          break;
        } catch (err) {
          if (err instanceof ModelError && err.kind === "rate_limited") {
            await new Promise((r) => setTimeout(r, (err.retryAfterSec ?? 5) * 1000));
            continue;
          }
          console.error(`  item ${i} failed: ${err instanceof Error ? err.message : String(err)}`);
          break;
        }
      }
      if (i % 25 === 0) console.error(`  ${i}/${items.length}, spent $${meter.summary().cost_usd.toFixed(3)}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}

type Msg = { role: "system" | "user"; content: string };
type Example =
  | { task: "route"; group: string; messages: Msg[]; tools: unknown[]; target: { tool_call: { name: string; arguments: Record<string, string> } } }
  | { task: "shape" | "plan"; group: string; messages: Msg[]; target: { json: unknown } };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// --- 1. Routing --------------------------------------------------------------

const Utterances = z.object({ utterances: z.array(z.object({ utterance: z.string(), skill: z.string(), args: z.record(z.string(), z.string()), split: z.enum(["dev", "heldout"]) })) });
const all = Utterances.parse(JSON.parse(await readFile("eval/utterances.json", "utf8"))).utterances;
const heldout = new Set(all.filter((u) => u.split === "heldout").map((u) => norm(u.utterance)));
// Refusals never reach a model at runtime (code refuses first), so they are not taught.
const seeds = all.filter((u) => u.split === "dev" && u.skill !== "refuse");

const Variants = z.object({ variants: z.array(z.string()) });
const OBJECT_POOL = ["house keys", "car keys", "wallet", "glasses", "sunglasses", "bus pass", "remote", "phone charger", "hearing aid case", "purse", "blue mug", "pill organiser"];

function noisy(u: string): string {
  let s = u.toLowerCase().replace(/[?.!,]/g, "");
  if (rand() < 0.5) s = `${pick(["um", "uh", "so", "okay", "hey"])} ${s}`;
  return s;
}

console.error("Routing: paraphrasing dev seeds…");
const variantLists = await pool(seeds, async (s) => {
  const res = await chatJson(
    ctx.llm,
    {
      ...teacher,
      messages: [
        { role: "system", content: "You write realistic spoken requests for a phone assistant used by blind and low-vision people. Reply with JSON only." },
        {
          role: "user",
          content: `Write ${PER_SEED} different ways someone might say this request aloud. Keep the same meaning and the same object and place words. Vary length and wording; include casual and indirect speech.\nRequest: "${s.utterance}"\nReply as {"variants": [...]}`,
        },
      ],
      temperature: 0.9,
      reasoningEffort: "low",
      maxTokens: 1500,
    },
    Variants,
    "variants",
    ctx.cfg.jsonMode,
  );
  meter.add(res.metrics);
  const vs = [s.utterance, ...res.data.variants].filter((v) => !heldout.has(norm(v)));
  const withNoise = vs.flatMap((v) => (rand() < 0.3 ? [v, noisy(v)] : [v]));
  return withNoise.map((v) => ({ seed: s, utterance: v }));
});
const routeInputs = variantLists.flat();
console.error(`Routing: ${routeInputs.length} utterances; teacher routing…`);

const routeExamples = await pool(routeInputs, async ({ seed: s, utterance }): Promise<Example | null> => {
  const known = sample(OBJECT_POOL, 2 + Math.floor(rand() * 5));
  const req = { utterance, known_objects: known, appliance_active: rand() < 0.15 };
  const messages: Msg[] = [
    { role: "system", content: ROUTE_SYSTEM },
    { role: "user", content: `${stateNote(req)}\nUser said: "${utterance}"` },
  ];
  const res = await ctx.llm.chat({ ...teacher, messages, tools: ROUTE_TOOLS, toolChoice: "required", temperature: 0.2, reasoningEffort: "low", maxTokens: 1500 });
  meter.add([res.metric]);
  const call = res.toolCalls[0];
  if (!call) return null;
  const decision = decisionFromToolCall(call.name, call.arguments, known);
  // Keep only teacher answers that agree with the seed's label.
  if (!decision || decision.skill !== s.skill) return null;
  const argsOk = Object.entries(s.args).every(([k, v]) => (decision.args[k as keyof typeof decision.args] ?? "").toLowerCase().includes(v.toLowerCase()));
  if (!argsOk && utterance === s.utterance) return null;
  const parsed = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
  const cleanArgs = Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]));
  return { task: "route", group: `route:${s.utterance}`, messages, tools: ROUTE_TOOLS, target: { tool_call: { name: call.name, arguments: cleanArgs } } };
});

// --- 2. Speech shaping ---------------------------------------------------------

const Inputs = z.object({ answers: z.array(z.array(z.string())) });
const NOW = Date.parse("2026-10-29T12:00:00Z");

function memoryAnswer(): string[] {
  const label = pick(OBJECT_POOL);
  const obj: MemObject = { id: "o", label, aliases: [], description: "", thumbs: [], created_ts: 0 };
  const place = pick(["on the hall shelf", "in the top kitchen drawer", "next to the front door", "on the bedside table", "in the blue bag by the sofa"]);
  const h = (x: number) => NOW - x * 3_600_000;
  const placed: MemEvent = { id: "a", object_id: "o", kind: "placed", location: place, place_id: null, ts: h(2 + Math.floor(rand() * 30)), source: "user_said", confidence: 1, identity_confidence: 0.9 };
  const after: MemEvent[] = rand() < 0.5 ? [{ ...placed, id: "b", kind: "picked_up", location: "", ts: h(1) }] : [];
  return [answerFind(label, [obj], [placed, ...after], NOW, { timeZone: "UTC" }).speech];
}

console.error("Shaping: generating inputs…");
const generated = await pool(Array.from({ length: Math.ceil(SHAPE_N / 20) }, (_, i) => i), async () => {
  const res = await chatJson(
    ctx.llm,
    {
      ...teacher,
      messages: [
        { role: "system", content: "You write example spoken answers from a camera assistant for blind people. Reply with JSON only." },
        {
          role: "user",
          content:
            'Write 20 example answers as {"answers": [["sentence", "sentence"], ...]}. Each answer is 1 to 3 sentences, at least one sentence longer than 15 words, wordy or formal. Topics: appliance instructions, describing a room or kitchen, labels on food packets, opening hours on signs. Some answers include a hedge like "I think it says \\"...\\", but I\'m not sure.", some include numbers or quoted text. No medicine, no people, no traffic.',
        },
      ],
      temperature: 0.9,
      reasoningEffort: "low",
      maxTokens: 4000,
    },
    Inputs,
    "answers",
    ctx.cfg.jsonMode,
  );
  meter.add(res.metrics);
  return res.data.answers.filter((a) => a.length > 0 && a.every((s) => s.length < 400));
});
const shapeInputs = [...generated.flat(), ...Array.from({ length: Math.ceil(SHAPE_N / 5) }, memoryAnswer)].slice(0, SHAPE_N);

const ShapeOut = z.object({ sentences: z.array(z.string()) });
const shapeExamples = await pool(shapeInputs, async (sentences, i): Promise<Example | null> => {
  const keep = sentences.join(" ").includes("last confirmed") ? ["last confirmed"] : [];
  const messages: Msg[] = [
    { role: "system", content: SHAPE_SYSTEM },
    { role: "user", content: `Rewrite these sentences:\n${JSON.stringify(sentences)}` },
  ];
  const res = await chatJson(ctx.llm, { ...teacher, messages, temperature: 0.2, reasoningEffort: "low", maxTokens: 1500 }, ShapeOut, "shaped_speech", ctx.cfg.jsonMode);
  meter.add(res.metrics);
  if (shapeViolations(sentences, res.data.sentences, keep).length > 0) return null;
  return { task: "shape", group: `shape:${i}`, messages, target: { json: res.data } };
});

// --- 3. Simple-mode plans ------------------------------------------------------

const SCENE_THINGS: Partial<VisionItem>[] = [
  { content: "clothes on the floor" },
  { content: "a laundry basket", position_clock: 3 },
  { content: "an unmade bed", position_clock: 12 },
  { content: "books on the floor", position_clock: 9 },
  { content: "a bookshelf", position_clock: 10 },
  { content: "dirty dishes in the sink", position_clock: 12 },
  { content: "a dish rack", position_clock: 2 },
  { content: "a rubbish bin", position_clock: 4 },
  { content: "a backpack", position_clock: 1 },
  { content: "a water bottle", position_clock: 11 },
  { content: "shoes by the door", position_clock: 6 },
  { content: "a coat on a chair", position_clock: 8 },
  { kind: "hazard", content: "a hot pan on the hob", position_clock: 2, distance: "within_reach" },
  { content: "a table with crumbs", position_clock: 12 },
  { content: "a cloth", position_clock: 3 },
];
const GOALS = ["tidy my room", "clear the table", "wash the dishes", "pack my bag for the day", "get ready to go out", "clean the kitchen counter", "put my clothes away", "make my bed"];

const planInputs = Array.from({ length: PLAN_N }, () => {
  const items = sample(SCENE_THINGS, 3 + Math.floor(rand() * 3)).map(
    (p): VisionItem => ({ kind: "object", confidence: 0.85 + rand() * 0.14, position_clock: 0, distance: pick(["within_reach", "arm_length", "few_steps"] as const), number_kind: "none", content: "", ...p }),
  );
  const scene = render({ skill: "describe", read: { image_quality: { blur: false, too_dark: false, glare: false, cut_off: "none" }, can_answer: true, camera_guidance: "", medicine_label: false, items } }).speech;
  return { goal: pick(GOALS), scene };
});

const planExamples = await pool(planInputs, async ({ goal, scene }, i): Promise<Example | null> => {
  const messages: Msg[] = [
    { role: "system", content: PLAN_SYSTEM },
    { role: "user", content: `Goal: ${goal}\nScene:\n${scene.join("\n")}` },
  ];
  const res = await chatJson(ctx.llm, { ...teacher, messages, temperature: 0.3, reasoningEffort: "low", maxTokens: 1500 }, SimplePlan, "simple_plan", ctx.cfg.jsonMode);
  meter.add(res.metrics);
  const p = res.data;
  const ok =
    p.steps.length >= 1 &&
    p.steps.length <= 5 &&
    [...p.steps, p.summary, p.encouragement].every((s) => words(s).length <= 15 && !makesTrafficClaim(s) && !givesDosingAdvice(s) && !looksLikeMedicine(s));
  return ok ? { task: "plan", group: `plan:${i}`, messages, target: { json: p } } : null;
});

// --- Split by group so paraphrases of one seed never straddle train and val -----

const examples = [...routeExamples, ...shapeExamples, ...planExamples];
const groups = [...new Set(examples.map((e) => e.group))];
const valGroups = new Set(groups.filter(() => rand() < 0.1));
const train = examples.filter((e) => !valGroups.has(e.group));
const val = examples.filter((e) => valGroups.has(e.group));

await mkdir("distill/data", { recursive: true });
const jsonl = (xs: Example[]) => xs.map((x) => JSON.stringify(x)).join("\n") + "\n";
await writeFile("distill/data/train.jsonl", jsonl(train));
await writeFile("distill/data/val.jsonl", jsonl(val));
const count = (xs: Example[], t: string) => xs.filter((x) => x.task === t).length;
const stats = {
  teacher: teacher.model,
  generated_at: new Date().toISOString(),
  kept: { route: routeExamples.length, shape: shapeExamples.length, plan: planExamples.length },
  tried: { route: routeInputs.length, shape: shapeInputs.length, plan: planInputs.length },
  train: { total: train.length, route: count(train, "route"), shape: count(train, "shape"), plan: count(train, "plan") },
  val: { total: val.length, route: count(val, "route"), shape: count(val, "shape"), plan: count(val, "plan") },
  teacher_cost_usd: meter.summary().cost_usd,
};
await writeFile("distill/data/stats.json", `${JSON.stringify(stats, null, 2)}\n`);
console.log(JSON.stringify(stats, null, 2));
