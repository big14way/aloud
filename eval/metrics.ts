// Evaluation metrics. Every rate keeps its numerator and denominator, and any rate
// from fewer than 30 examples is flagged as a small set.

export const SMALL_SET = 30;

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Lowercase, unify quotes and dashes, collapse whitespace. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Character error rate of `predicted` against `truth`, after normalisation. */
export function cer(predicted: string, truth: string): number {
  const t = normalizeText(truth);
  if (t.length === 0) return predicted.trim() ? 1 : 0;
  return levenshtein(normalizeText(predicted), t) / t.length;
}

export function containsFact(text: string, fact: string): boolean {
  const alts = fact.split("|").map((f) => normalizeText(f)).filter(Boolean);
  const t = normalizeText(text);
  return alts.some((a) => t.includes(a));
}

/** Key facts may list alternatives with "|", e.g. "kettle|jug". */
export function keyFactHits(text: string, facts: string[]): number {
  return facts.filter((f) => containsFact(text, f)).length;
}

function words(s: string): string[] {
  return normalizeText(s)
    .split(/[^\p{L}\p{N}$.,:/-]+/u)
    .map((w) => w.replace(/[.,:]+$/, ""))
    .filter(Boolean);
}

/** Words Aloud read that are not in the ground truth: a proxy for invented text. */
export function inventedWords(predicted: string, truth: string): { invented: number; total: number } {
  const truthSet = new Set(words(truth));
  const pred = words(predicted);
  return { invented: pred.filter((w) => !truthSet.has(w)).length, total: pred.length };
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export interface Rate {
  num: number;
  den: number;
}

export function formatRate(r: Rate): string {
  if (r.den === 0) return "n/a (0 examples)";
  const pct = ((100 * r.num) / r.den).toFixed(1);
  return `${pct}% (${r.num}/${r.den})${r.den < SMALL_SET ? ", small set" : ""}`;
}
