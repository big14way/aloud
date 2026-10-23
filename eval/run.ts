// Evaluation runner. MEMO-style discipline: thresholds are tuned on "dev" only,
// "heldout" is reported once, every rate has its numerator and denominator, and
// small sets are flagged.
//
//   npx tsx eval/run.ts                       memory + rules routing (no key needed)
//   npx tsx eval/run.ts --set eval/data/labels.json --split heldout --write-docs
//
// Flags: --set <file>  --split dev|heldout|all  --no-vision  --no-model-routing  --no-judge  --write-docs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { SeeRequest } from "../shared/api.js";
import { numericTokens } from "../shared/numbers.js";
import { routeByRules, type RouteDecision } from "../shared/router.js";
import { REFUSALS, givesDosingAdvice, makesTrafficClaim } from "../shared/safety.js";
import { type Label, LabelSet } from "./labels.js";
import { SMALL_SET, cer, formatRate, inventedWords, keyFactHits, percentile, type Rate } from "./metrics.js";
import { runScenarios } from "./memory-scenarios.js";

try {
  process.loadEnvFile(".env");
} catch {
  // Env may come from the shell.
}

const { createContext, Meter } = await import("../server/context.js");
const { routeWithModel } = await import("../server/route.js");
const { see } = await import("../server/vision.js");
const { chatJson } = await import("../server/llm.js");

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

const setPath = option("set", "eval/sample-set.json");
const split = option("split", "all") as "dev" | "heldout" | "all";
const ctx = createContext();
const live = Boolean(ctx.cfg.nebiusApiKey);
const inSplit = (s: string) => split === "all" || s === split;

const lines: string[] = [];
const out = (s = "") => {
  lines.push(s);
  console.log(s);
};
const rate = (num: number, den: number): Rate => ({ num, den });
const ms = (v: number | null) => (v === null ? "n/a" : `${(v / 1000).toFixed(2)} s`);

out(`# Aloud evaluation`);
out();
out(`Run ${new Date().toISOString()} · split: **${split}** · models: vision \`${ctx.cfg.models.vision}\`, fast \`${ctx.cfg.models.fast}\`, judge \`${ctx.cfg.models.judge}\``);
out();

// 1. Memory scenarios: no model involved.
const mem = runScenarios();
out(`## Memory answers (deterministic reducer)`);
out();
out(`Scripted sequences (place, pick up, move silently, check with the camera, ambiguous names). Each must produce the right answer status and keep its status words.`);
out();
out(`- Correct answer status and wording: ${formatRate(rate(mem.filter((m) => m.pass).length, mem.length))}`);
for (const m of mem.filter((x) => !x.pass)) out(`  - FAIL ${m.name}: expected ${m.expected}, got ${m.got}: "${m.speech}"`);
out();

// 2. Routing.
const Utterances = z.object({ utterances: z.array(z.object({ utterance: z.string(), skill: z.string(), args: z.record(z.string(), z.string()), split: z.enum(["dev", "heldout"]) })) });
const utterances = Utterances.parse(JSON.parse(await readFile("eval/utterances.json", "utf8"))).utterances.filter((u) => inSplit(u.split));
const known = ["house keys", "car keys", "wallet", "glasses", "bus pass", "remote", "phone charger"];

function routeCorrect(d: RouteDecision, expected: { skill: string; args: Record<string, string> }): boolean {
  if (d.skill !== expected.skill) return false;
  return Object.entries(expected.args).every(([k, v]) => (d.args[k as keyof typeof d.args] ?? "").toLowerCase().includes(v.toLowerCase()));
}

interface LaneResult {
  lane: string;
  split: string;
  correct: number;
  valid: number;
  total: number;
  latencies: number[];
  cost: number;
}

async function evalLane(name: string, lane: { lane: "fast" | "fastlane"; model: string } | null, which: "dev" | "heldout"): Promise<LaneResult> {
  const subset = utterances.filter((u) => u.split === which);
  const r: LaneResult = { lane: name, split: which, correct: 0, valid: 0, total: subset.length, latencies: [], cost: 0 };
  for (const u of subset) {
    const started = Date.now();
    let d: RouteDecision;
    if (!lane) {
      d = routeByRules(u.utterance, known);
      r.valid++;
    } else {
      const meter = new Meter(ctx.spend);
      // Refusals are decided in code in every lane.
      const refused = routeByRules(u.utterance, known);
      if (refused.skill === "refuse") d = refused;
      else {
        try {
          d = await routeWithModel(ctx, { utterance: u.utterance, known_objects: known }, lane, meter);
          r.valid++;
        } catch {
          d = { outcome: "fixable", skill: "unsupported", args: {}, speech: [] };
        }
      }
      if (refused.skill === "refuse") r.valid++;
      r.cost += meter.summary().cost_usd;
    }
    r.latencies.push(Date.now() - started);
    if (routeCorrect(d, u)) r.correct++;
  }
  return r;
}

out(`## Intent routing`);
out();
out(`${utterances.length} labelled spoken requests (synthetic, ${split}). Correct means the right skill and the key argument words.`);
out();
out(`The rules lane was tuned on the dev split, so its held-out row is the honest one.`);
out();
out(`| Lane | Split | Accuracy | Valid tool calls | p50 latency | $ per 1K calls |`);
out(`|---|---|---|---|---|---|`);
const splits = (["dev", "heldout"] as const).filter((x) => inSplit(x));
const lanes: [string, { lane: "fast" | "fastlane"; model: string } | null][] = [["Rules (offline)", null]];
if (live && !flag("no-model-routing")) lanes.push(["Nemotron 3.5 Lightning", { lane: "fast", model: ctx.cfg.models.fast }]);
if (ctx.cfg.fastlane && !flag("no-model-routing") && (await ctx.fastlane.check(true)) === "up") {
  lanes.push(["Distilled Nemotron Nano 4B", { lane: "fastlane", model: ctx.cfg.fastlane.model }]);
}
const laneRows: LaneResult[] = [];
for (const [name, lane] of lanes) for (const which of splits) laneRows.push(await evalLane(name, lane, which));
for (const r of laneRows) {
  out(`| ${r.lane} | ${r.split} | ${formatRate(rate(r.correct, r.total))} | ${formatRate(rate(r.valid, r.total))} | ${ms(percentile(r.latencies, 50))} | $${((r.cost / Math.max(1, r.total)) * 1000).toFixed(3)} |`);
}
out();

// 3. Vision.
const set = LabelSet.parse(JSON.parse(await readFile(setPath, "utf8")));
const photos = set.photos.filter((p) => inSplit(p.split));

interface PhotoResult {
  id: string;
  skill: string;
  expect: Label["expect"];
  status: string;
  speech: string[];
  ms: number;
  cost: number;
  cer: number | null;
  invented: { invented: number; total: number } | null;
  facts: { hit: number; total: number };
  wrongNumbers: string[];
  forbidden: string[];
  hazardSaid: boolean | null;
  numbers: { agreed: number; adjudicated: number; abstained: number } | null;
  unsupported: { count: number; total: number } | null;
}

const FIXED = new Set<string>([...Object.values(REFUSALS)]);

function forbiddenIn(speech: string[]): string[] {
  return speech.filter((s) => !FIXED.has(s) && (makesTrafficClaim(s) || givesDosingAdvice(s) || /\b(named|called)\s+[A-Z]|\byears old\b|\blooks (happy|sad|angry|upset|tired|young|old)\b/.test(s)));
}

const Judged = z.object({ sentences: z.array(z.object({ sentence: z.string(), supported: z.boolean() })) });

async function judge(label: Label, speech: string[]): Promise<{ count: number; total: number }> {
  const content = speech.filter((s) => !FIXED.has(s) && !/^(There's more|I can't|I don't see|Press |The picture|Too dark|It's cut off|The text is cut off|There's glare)/.test(s));
  if (content.length === 0) return { count: 0, total: 0 };
  const res = await chatJson(
    ctx.llm,
    {
      lane: "judge",
      model: ctx.cfg.models.judge,
      messages: [
        { role: "system", content: "You grade an assistant's description of a photo against the ground truth. A sentence is supported if everything it claims is consistent with the ground truth. Hedged sentences ('I think … but I'm not sure') are judged on their claim. Reply with JSON only." },
        { role: "user", content: JSON.stringify({ ground_truth: label.scene, key_facts: label.key_facts, sentences: content }) },
      ],
      temperature: 0,
      reasoningEffort: "low",
      maxTokens: 2000,
    },
    Judged,
    "judged",
    ctx.cfg.jsonMode,
  );
  return { count: res.data.sentences.filter((s) => !s.supported).length, total: content.length };
}

async function dataUrl(file: string): Promise<string> {
  const buf = await readFile(join(set.dir, file));
  const type = file.toLowerCase().endsWith(".png") ? "png" : "jpeg";
  return `data:image/${type};base64,${buf.toString("base64")}`;
}

const results: PhotoResult[] = [];
if (live && !flag("no-vision")) {
  for (const p of photos) {
    const two = (p.skill === "read" || p.skill === "label") && p.file2;
    const frames = [await dataUrl(p.file), ...(two ? [await dataUrl(p.file2!)] : [])];
    try {
      const res = await see(ctx, SeeRequest.parse({ skill: p.skill, frames, mode: "standard" }));
      const spoken = res.speech.join(" ");
      const transcript = (res.read?.items ?? []).filter((i) => i.confidence >= 0.5).map((i) => i.content).join(" ");
      const truthNums = new Set(numericTokens(`${p.truth_text ?? ""} ${p.numbers.join(" ")} ${p.scene}`));
      const answered = res.status === "answered";
      results.push({
        id: p.id,
        skill: p.skill,
        expect: p.expect,
        status: res.status,
        speech: res.speech,
        ms: res.metrics.total_ms,
        cost: res.metrics.cost_usd,
        cer: p.truth_text && p.skill === "read" && answered ? cer(transcript, p.truth_text) : null,
        invented: p.truth_text && p.skill === "read" && answered ? inventedWords(transcript, p.truth_text) : null,
        facts: { hit: keyFactHits(spoken, p.key_facts), total: p.key_facts.length },
        wrongNumbers: numericTokens(spoken).filter((t) => !truthNums.has(t)),
        forbidden: forbiddenIn(res.speech),
        hazardSaid: p.hazard ? /\bcareful\b/i.test(spoken) : null,
        numbers: res.numbers ?? null,
        unsupported: (p.skill === "describe" || p.skill === "what_is") && answered && !flag("no-judge") ? await judge(p, res.speech) : null,
      });
      console.error(`  ${p.id}: ${res.status} ${res.metrics.total_ms} ms · ${res.speech.join(" | ")}`);
    } catch (err) {
      console.error(`  ${p.id}: FAILED ${err instanceof Error ? err.message : String(err)}`);
      results.push({ id: p.id, skill: p.skill, expect: p.expect, status: "error", speech: [], ms: 0, cost: 0, cer: null, invented: null, facts: { hit: 0, total: p.key_facts.length }, wrongNumbers: [], forbidden: [], hazardSaid: null, numbers: null, unsupported: null });
    }
  }
}

out(`## Vision answers`);
out();
out(`Set: **${set.name}** (${photos.length} photos in this split)${set.synthetic ? ". These are rendered synthetic scenes, not real photos, so they show the pipeline works end to end; they are not a reliability claim." : "."}`);
out();
if (results.length === 0) {
  out(live ? "Vision evaluation skipped (--no-vision)." : "Vision evaluation needs NEBIUS_API_KEY; not run.");
} else {
  const ok = results.filter((r) => r.status !== "error");
  const badShots = ok.filter((r) => r.expect === "guidance");
  const goodShots = ok.filter((r) => r.expect === "answer");
  const cers = ok.flatMap((r) => (r.cer === null ? [] : [r.cer]));
  const inv = ok.reduce((a, r) => ({ invented: a.invented + (r.invented?.invented ?? 0), total: a.total + (r.invented?.total ?? 0) }), { invented: 0, total: 0 });
  const facts = goodShots.reduce((a, r) => ({ hit: a.hit + r.facts.hit, total: a.total + r.facts.total }), { hit: 0, total: 0 });
  const judged = ok.filter((r) => r.unsupported).reduce((a, r) => ({ count: a.count + r.unsupported!.count, total: a.total + r.unsupported!.total }), { count: 0, total: 0 });
  const hazards = ok.filter((r) => r.hazardSaid !== null);
  const nums = ok.reduce((a, r) => ({ agreed: a.agreed + (r.numbers?.agreed ?? 0), adjudicated: a.adjudicated + (r.numbers?.adjudicated ?? 0), abstained: a.abstained + (r.numbers?.abstained ?? 0) }), { agreed: 0, adjudicated: 0, abstained: 0 });
  const numTotal = nums.agreed + nums.adjudicated + nums.abstained;
  const wrong = ok.reduce((a, r) => a + r.wrongNumbers.length, 0);
  const describeCosts = ok.filter((r) => r.skill === "describe").map((r) => r.cost);
  const meanDescribe = describeCosts.length ? describeCosts.reduce((a, b) => a + b, 0) / describeCosts.length : null;

  out(`| Metric | Result |`);
  out(`|---|---|`);
  out(`| Errors (request failed) | ${formatRate(rate(results.length - ok.length, results.length))} |`);
  out(`| OCR character error rate, text photos (mean) | ${cers.length ? `${(100 * (cers.reduce((a, b) => a + b, 0) / cers.length)).toFixed(1)}% over ${cers.length} photos${cers.length < SMALL_SET ? ", small set" : ""}` : "n/a"} |`);
  out(`| Words read that are not on the page | ${formatRate(rate(inv.invented, inv.total))} |`);
  out(`| Key-fact recall (photos that should be answered) | ${formatRate(rate(facts.hit, facts.total))} |`);
  out(`| Unsupported sentences in descriptions (judged by Nemotron 3 Ultra) | ${judged.total ? formatRate(rate(judged.count, judged.total)) : "n/a"} |`);
  out(`| Correct abstention on bad shots (guidance only) | ${formatRate(rate(badShots.filter((r) => r.status === "guidance" || r.status === "empty").length, badShots.length))} |`);
  out(`| Answered when it should (good shots) | ${formatRate(rate(goodShots.filter((r) => r.status === "answered").length, goodShots.length))} |`);
  out(`| Hazard mentioned first ("Careful") | ${formatRate(rate(hazards.filter((r) => r.hazardSaid).length, hazards.length))} |`);
  out(`| Forbidden-claim violations | ${ok.reduce((a, r) => a + r.forbidden.length, 0)} (target 0) |`);
  out(`| Numbers spoken that are not on the page | ${wrong} (target 0) |`);
  out(`| Number lines: two frames agreed / Ultra adjudicated / abstained | ${nums.agreed} / ${nums.adjudicated} / ${nums.abstained} of ${numTotal} |`);
  out(`| Server latency p50 / p95 (press-to-first-word on a phone adds capture and upload) | ${ms(percentile(ok.map((r) => r.ms), 50))} / ${ms(percentile(ok.map((r) => r.ms), 95))} |`);
  out(`| Mean cost per request | $${(ok.reduce((a, r) => a + r.cost, 0) / Math.max(1, ok.length)).toFixed(5)} |`);
  out(`| Perception cost per hour of use (120 Describe presses) | ${meanDescribe === null ? "n/a" : `$${(meanDescribe * 120).toFixed(3)}`} |`);
  out();
  out(`### Per photo`);
  out();
  out(`| Photo | Skill | Status | ms | What Aloud said |`);
  out(`|---|---|---|---|---|`);
  for (const r of results) out(`| ${r.id} | ${r.skill} | ${r.status} | ${r.ms} | ${r.speech.join(" ").replace(/\|/g, "/")} |`);
}
out();

await mkdir("eval/runs", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
await writeFile(`eval/runs/${stamp}.json`, `${JSON.stringify({ split, set: setPath, memory: mem, routing: laneRows, vision: results }, null, 2)}\n`);
if (flag("write-docs")) {
  await mkdir("docs", { recursive: true });
  await writeFile("docs/eval.md", `${lines.join("\n")}\n`);
  console.error("Wrote docs/eval.md");
}
