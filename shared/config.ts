// Model ids and prices from the Nebius Token Factory public catalog
// (https://tokenfactory.nebius.com/api/public/models_info, checked 2026-10-23).
// Casing matters: Lightning uses "3_5", Super-VL uses "3.5", Super 120B is lowercase.

export const MODELS = {
  /** Sees. Image in, structured JSON out. Run with reasoning_effort "none" on the interactive path. */
  vision: "nvidia/Nemotron-3.5-Super-VL",
  /** Fast everyday text calls: intent routing, speech shaping, memory extraction. */
  fast: "nvidia/Nemotron-3_5-Lightning",
  /** Turns an appliance manual excerpt into concrete steps. */
  steps: "nvidia/nemotron-3-super-120b-a12b",
  /** Settles disagreements between two vision reads. Never sees images. */
  judge: "nvidia/Nemotron-3-Ultra-550b-a55b",
} as const;

export type ModelRole = keyof typeof MODELS;

/** USD per 1M tokens, [input, output]. */
export const PRICES_PER_M: Record<string, readonly [number, number]> = {
  "nvidia/Nemotron-3.5-Super-VL": [0.3, 0.9],
  "nvidia/Nemotron-3_5-Lightning": [0.06, 0.24],
  "nvidia/nemotron-3-super-120b-a12b": [0.3, 0.9],
  "nvidia/Nemotron-3-Ultra-550b-a55b": [1.0, 3.0],
  "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B": [0.06, 0.24],
};

export function costUsd(model: string, promptTokens: number, completionTokens: number): number {
  const price = PRICES_PER_M[model];
  if (!price) return 0;
  return (promptTokens * price[0] + completionTokens * price[1]) / 1_000_000;
}

export const THRESHOLDS = {
  /** At or above this, an item is spoken plainly. */
  plain: 0.8,
  /** From here up to `plain`, an item is spoken with "I think …, but I'm not sure". Below, it is dropped. */
  unsure: 0.5,
  /** Memory: identity and event confidence needed to promote an observation to trusted state. */
  trust: 0.7,
} as const;

/** Easy-language mode: hard limit on words per sentence. */
export const EASY_MAX_WORDS = 15;
