import { z } from "zod";
import type { LabelRead, MatchRead, ObjectDescription, StepCheck, VisionRead } from "./schemas.js";

// Request and response contracts shared by the PWA and the API.

/** A JPEG/PNG/WebP data URL. 2.5 MB of base64 is far above the ~200 KB frames the app sends. */
export const DataUrl = z
  .string()
  .max(2_500_000)
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/, "must be a base64 image data URL");

export const VisionSkillName = z.enum(["describe", "read", "what_is"]);
export const SeeSkill = z.enum(["describe", "read", "what_is", "enrol", "match", "label", "step_check", "plan"]);
export type SeeSkill = z.infer<typeof SeeSkill>;

export const Mode = z.enum(["standard", "simple"]);
export type Mode = z.infer<typeof Mode>;

export const SeeRequest = z.object({
  skill: SeeSkill,
  frames: z.array(DataUrl).min(1).max(2),
  /** Enrolment thumbnails for "match". */
  references: z.array(DataUrl).max(3).optional(),
  mode: Mode.default("standard"),
  /** Slow path: vision reasoning on. Only when the user asks to look harder. */
  look_harder: z.boolean().optional(),
  context: z
    .object({
      label: z.string().max(80).optional(),
      description: z.string().max(400).optional(),
      instruction: z.string().max(300).optional(),
      visual_check: z.string().max(300).optional(),
      goal: z.string().max(200).optional(),
      user_name: z.string().max(40).optional(),
    })
    .optional(),
});
export type SeeRequest = z.infer<typeof SeeRequest>;

export interface CallMetric {
  lane: "vision" | "fast" | "steps" | "judge" | "fastlane";
  model: string;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  cost_usd: number;
}

export interface Metrics {
  total_ms: number;
  cost_usd: number;
  calls: CallMetric[];
}

export type SeeStatus = "answered" | "guidance" | "empty" | "refused";

export interface SeeResponse {
  ok: true;
  skill: SeeSkill;
  status: SeeStatus;
  speech: string[];
  confidence: number;
  flags: string[];
  frames_used: number;
  numbers?: { agreed: number; adjudicated: number; abstained: number };
  read?: VisionRead;
  enrol?: ObjectDescription;
  match?: MatchRead;
  label?: LabelRead & { model_number_verified: boolean };
  step?: StepCheck;
  plan?: { steps: string[] };
  metrics: Metrics;
}

export type ErrorKind = "budget" | "rate_limited" | "session_limit" | "bad_request" | "model_error" | "not_configured" | "tool_error";

export interface ErrorResponse {
  ok: false;
  error: ErrorKind;
  speech: string[];
  retry_after_s?: number;
  detail?: string;
}

export const ERROR_SPEECH: Record<ErrorKind, string> = {
  budget: "The demo budget for today is used up. Sample photos still work with saved answers.",
  rate_limited: "Aloud is busy right now. Please try again in a few seconds.",
  session_limit: "You've reached this hour's limit for the demo. Sample photos still work with saved answers.",
  bad_request: "Something went wrong with that picture. Please try again.",
  model_error: "I couldn't get an answer just now. Please try again.",
  not_configured: "Aloud's server isn't set up with a model key yet.",
  tool_error: "I couldn't reach the search service just now. Please try again.",
};

// Intent routing: one utterance -> one skill with flat, typed arguments.

export const RouteSkill = z.enum([
  "describe",
  "read",
  "what_is",
  "find",
  "remember_placement",
  "picked_up",
  "enrol_object",
  "appliance_help",
  "plan_task",
  "repeat",
  "stop",
  "look_harder",
  "help",
  "refuse",
  "unsupported",
]);
export type RouteSkill = z.infer<typeof RouteSkill>;

export const RouteRequest = z.object({
  utterance: z.string().min(1).max(500),
  known_objects: z.array(z.string().max(80)).max(50).optional(),
  appliance_active: z.boolean().optional(),
});
export type RouteRequest = z.infer<typeof RouteRequest>;

export interface RouteArgs {
  object?: string;
  location?: string;
  label?: string;
  task?: string;
  goal?: string;
}

/** success: run it. fixable: ask the user the follow-up in `speech`. fatal: refuse with `speech`. */
export type RouteOutcome = "success" | "fixable" | "fatal";

export interface RouteResponse {
  ok: true;
  outcome: RouteOutcome;
  skill: RouteSkill;
  args: RouteArgs;
  speech: string[];
  lane: "rules" | "fast" | "fastlane";
  metrics: Metrics;
}

export const ShapeRequest = z.object({
  sentences: z.array(z.string().max(600)).min(1).max(30),
  mode: Mode,
  user_name: z.string().max(40).optional(),
  /** Status words that must survive, e.g. from a memory answer. */
  keep: z.array(z.string().max(40)).max(5).optional(),
});
export type ShapeRequest = z.infer<typeof ShapeRequest>;

export interface ShapeResponse {
  ok: true;
  speech: string[];
  source: "model" | "fallback" | "unchanged";
  metrics: Metrics;
}

export const ApplianceRequest = z.object({
  brand: z.string().max(80),
  model_number: z.string().min(2).max(60),
  appliance_type: z.string().max(60),
  task: z.string().min(2).max(200),
  mode: Mode.default("standard"),
});
export type ApplianceRequest = z.infer<typeof ApplianceRequest>;

export interface ApplianceStep {
  instruction: string;
  visual_check: string;
}

export interface ApplianceResponse {
  ok: true;
  found_instructions: boolean;
  steps: ApplianceStep[];
  caution: string;
  sources: { title: string; url: string }[];
  speech: string[];
  metrics: Metrics;
}

export interface HealthResponse {
  ok: true;
  lanes: {
    vision: { model: string; configured: boolean };
    fast: { model: string; configured: boolean };
    steps: { model: string; configured: boolean };
    judge: { model: string; configured: boolean; enabled: boolean };
    fastlane: { model: string | null; status: "up" | "down" | "not_configured" };
    tavily: { configured: boolean };
  };
  budget: { day: string; spent_usd: number; cap_usd: number };
}
