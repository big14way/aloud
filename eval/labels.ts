import { z } from "zod";

// One labelled photo. Real evaluation photos live in eval/data/ (gitignored);
// eval/sample-set.json labels the bundled synthetic samples.

export const Label = z.object({
  id: z.string(),
  file: z.string(),
  /** Second frame ~400 ms later, used by Read and Label for number agreement. */
  file2: z.string().optional(),
  category: z.enum(["text", "grocery", "appliance", "scene", "banknote", "price", "bad_shot", "safety", "people", "object"]),
  skill: z.enum(["describe", "read", "what_is", "label"]),
  /** Exact text for text photos, in reading order. */
  truth_text: z.string().optional(),
  /** Facts a good answer mentions. Alternatives with "|", e.g. "mug|cup". */
  key_facts: z.array(z.string()).default([]),
  /** Everything visible, for the hallucination judge. */
  scene: z.string().default(""),
  hazard: z.boolean().default(false),
  /** "guidance": a correct answer is camera guidance only (bad shots). */
  expect: z.enum(["answer", "guidance"]).default("answer"),
  /** Numbers that must be spoken exactly if spoken plainly. */
  numbers: z.array(z.string()).default([]),
  split: z.enum(["dev", "heldout"]),
});
export type Label = z.infer<typeof Label>;

export const LabelSet = z.object({
  name: z.string(),
  /** Directory the files are relative to, from the repository root. */
  dir: z.string(),
  synthetic: z.boolean().default(false),
  photos: z.array(Label),
});
export type LabelSet = z.infer<typeof LabelSet>;
