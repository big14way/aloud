import type { Metrics, Mode, SeeSkill } from "../../shared/api";

// Sample-photo mode: bundled photos so every skill can be tried on a laptop with no
// camera. Saved answers (recorded from real runs) are used only when the live API
// can't answer, and are always labelled as saved.

export interface Sample {
  id: string;
  title: string;
  alt: string;
  file: string;
  suggested: SeeSkill | "find";
}

export interface CachedAnswer {
  speech: string[];
  metrics: Metrics | null;
  recorded_at: string;
}

let manifest: Promise<Sample[]> | null = null;
let cache: Promise<Record<string, CachedAnswer>> | null = null;

export function loadSamples(): Promise<Sample[]> {
  manifest ??= fetch("/samples/manifest.json")
    .then((r) => (r.ok ? (r.json() as Promise<{ samples: Sample[] }>) : { samples: [] }))
    .then((m) => m.samples)
    .catch(() => []);
  return manifest;
}

export function cacheKey(sampleId: string, skill: SeeSkill, mode: Mode): string {
  return `${sampleId}|${skill}|${mode}`;
}

export async function cachedAnswer(sampleId: string, skill: SeeSkill, mode: Mode): Promise<CachedAnswer | null> {
  cache ??= fetch("/samples/cache.json")
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, CachedAnswer>>) : {}))
    .catch(() => ({}));
  const all = await cache;
  return all[cacheKey(sampleId, skill, mode)] ?? all[cacheKey(sampleId, skill, "standard")] ?? null;
}

export async function sampleDataUrl(sample: Sample): Promise<string> {
  const res = await fetch(`/samples/${sample.file}`);
  if (!res.ok) throw new Error(`Sample ${sample.id} is missing`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}
