// Records saved answers for the bundled sample photos by running the real API
// pipeline against Nebius Token Factory. The app plays these back only when the
// live API can't answer (no key, budget used up, offline), and says it's a saved answer.
// Usage: npx tsx scripts/record-samples.ts   (needs NEBIUS_API_KEY in .env)
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Mode, SeeSkill } from "../shared/api.js";
import { SeeRequest } from "../shared/api.js";

try {
  process.loadEnvFile(".env");
} catch {
  // Env may come from the shell instead.
}

const { createContext } = await import("../server/context.js");
const { see } = await import("../server/vision.js");

interface Sample {
  id: string;
  file: string;
  suggested: string;
}

const dir = join(process.cwd(), "public", "samples");
const { samples } = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as { samples: Sample[] };

async function dataUrl(file: string): Promise<string> {
  return `data:image/jpeg;base64,${(await readFile(join(dir, file))).toString("base64")}`;
}

const ctx = createContext();
if (!ctx.cfg.nebiusApiKey) {
  console.error("NEBIUS_API_KEY is not set.");
  process.exit(1);
}

const jobs: { sample: Sample; skill: SeeSkill; mode: Mode }[] = [];
for (const sample of samples) {
  const skills = new Set<SeeSkill>(["describe", "what_is"]);
  if (["read", "label", "plan"].includes(sample.suggested)) skills.add(sample.suggested as SeeSkill);
  for (const skill of skills) jobs.push({ sample, skill, mode: skill === "plan" ? "simple" : "standard" });
}

const cache: Record<string, { speech: string[]; metrics: unknown; recorded_at: string }> = {};
let spent = 0;
for (const { sample, skill, mode } of jobs) {
  const two = skill === "read" || skill === "label";
  const frames = [await dataUrl(sample.file), ...(two ? [await dataUrl(`frame2/${sample.file}`)] : [])];
  const req = SeeRequest.parse({ skill, frames, mode, context: skill === "plan" ? { goal: "tidy this room" } : undefined });
  try {
    const res = await see(ctx, req);
    cache[`${sample.id}|${skill}|${mode}`] = { speech: res.speech, metrics: res.metrics, recorded_at: new Date().toISOString() };
    spent += res.metrics.cost_usd;
    console.log(`${sample.id} ${skill}: ${res.status} in ${res.metrics.total_ms} ms, $${res.metrics.cost_usd.toFixed(5)}\n  ${res.speech.join(" | ")}`);
  } catch (err) {
    console.error(`${sample.id} ${skill}: FAILED ${err instanceof Error ? err.message : String(err)}`);
  }
}

await writeFile(join(dir, "cache.json"), `${JSON.stringify(cache, null, 2)}\n`);
console.log(`\nSaved ${Object.keys(cache).length} answers to public/samples/cache.json. Total cost $${spent.toFixed(4)}.`);
