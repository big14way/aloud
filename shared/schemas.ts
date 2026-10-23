import { z } from "zod";

// Structured outputs requested from the vision model. Every read carries its own
// self-assessment (image quality, can_answer, per-item confidence) so the gates in
// gates.ts can decide what is safe to say. Numeric ranges are clamped in code
// (normalize.ts) rather than in the schema, because guided decoding backends do
// not all support minimum/maximum.

export const CutOff = z.enum(["none", "left", "right", "top", "bottom"]);
export type CutOff = z.infer<typeof CutOff>;

export const ImageQuality = z.object({
  blur: z.boolean(),
  too_dark: z.boolean(),
  glare: z.boolean(),
  cut_off: CutOff,
});
export type ImageQuality = z.infer<typeof ImageQuality>;

export const ItemKind = z.enum(["hazard", "object", "person", "text", "number", "place"]);
export type ItemKind = z.infer<typeof ItemKind>;

export const NumberKind = z.enum(["none", "price", "amount", "phone", "date", "time", "banknote", "other"]);
export type NumberKind = z.infer<typeof NumberKind>;

export const Distance = z.enum(["unknown", "within_reach", "arm_length", "few_steps", "far"]);
export type Distance = z.infer<typeof Distance>;

export const VisionItem = z.object({
  kind: ItemKind,
  content: z.string(),
  confidence: z.number(),
  position_clock: z.int(),
  distance: Distance,
  number_kind: NumberKind,
});
export type VisionItem = z.infer<typeof VisionItem>;

/** Describe, Read and What-is all use this shape; the prompt changes per skill. */
export const VisionRead = z.object({
  image_quality: ImageQuality,
  can_answer: z.boolean(),
  camera_guidance: z.string(),
  medicine_label: z.boolean(),
  items: z.array(VisionItem),
});
export type VisionRead = z.infer<typeof VisionRead>;

/** Enrolment: a distinctive description of one object the user wants remembered. */
export const ObjectDescription = z.object({
  image_quality: ImageQuality,
  can_answer: z.boolean(),
  camera_guidance: z.string(),
  label_guess: z.string(),
  description: z.string(),
  confidence: z.number(),
});
export type ObjectDescription = z.infer<typeof ObjectDescription>;

/** Memory verification: is the enrolled object (first image) visible in the current frame (last image)? */
export const MatchRead = z.object({
  image_quality: ImageQuality,
  can_answer: z.boolean(),
  camera_guidance: z.string(),
  visible: z.boolean(),
  confidence: z.number(),
  position_clock: z.int(),
  distance: Distance,
  reason: z.string(),
});
export type MatchRead = z.infer<typeof MatchRead>;

/** Appliance helper: the brand and model number on a rating label or panel. */
export const LabelRead = z.object({
  image_quality: ImageQuality,
  can_answer: z.boolean(),
  camera_guidance: z.string(),
  appliance_type: z.string(),
  brand: z.string(),
  model_number: z.string(),
  confidence: z.number(),
});
export type LabelRead = z.infer<typeof LabelRead>;

/** Appliance helper: has the current step visibly happened? */
export const StepCheck = z.object({
  image_quality: ImageQuality,
  can_answer: z.boolean(),
  camera_guidance: z.string(),
  step_done: z.enum(["yes", "no", "unclear"]),
  confidence: z.number(),
  observation: z.string(),
});
export type StepCheck = z.infer<typeof StepCheck>;

/** Ultra's verdict when two frames disagree on a number. Ultra never sees the images. */
export const Adjudication = z.object({
  agree: z.boolean(),
  best_reading: z.string(),
  should_abstain: z.boolean(),
  reason: z.string(),
});
export type Adjudication = z.infer<typeof Adjudication>;

/** Appliance steps written from a manual excerpt. */
export const StepPlan = z.object({
  found_instructions: z.boolean(),
  steps: z.array(
    z.object({
      instruction: z.string(),
      visual_check: z.string(),
    }),
  ),
  caution: z.string(),
});
export type StepPlan = z.infer<typeof StepPlan>;

/** Simple mode: a short task plan, spoken one step at a time. */
export const SimplePlan = z.object({
  summary: z.string(),
  steps: z.array(z.string()),
  encouragement: z.string(),
});
export type SimplePlan = z.infer<typeof SimplePlan>;

/** Memory extraction from an utterance such as "I'm putting my keys on the hall shelf". */
export const PlacementExtract = z.object({
  object: z.string(),
  preposition: z.enum(["on", "in", "under", "next to", "behind", "at", "none"]),
  surface: z.string(),
  place: z.string(),
});
export type PlacementExtract = z.infer<typeof PlacementExtract>;

/** JSON Schema for a response_format, without the $schema key some servers reject. */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema) as Record<string, unknown>;
  delete out.$schema;
  return out;
}
