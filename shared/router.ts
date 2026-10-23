import type { RouteArgs, RouteOutcome, RouteSkill } from "./api.js";
import { findQuery, parsePlacement } from "./memory.js";
import { REFUSALS, checkUtterance } from "./safety.js";

// Deterministic routing. The safety check always runs first, in code. The rules
// router is the offline lane and the fallback when the model lane fails.

export interface RouteDecision {
  outcome: RouteOutcome;
  skill: RouteSkill;
  args: RouteArgs;
  speech: string[];
}

export function refusalFor(utterance: string): RouteDecision | null {
  const kind = checkUtterance(utterance);
  if (!kind) return null;
  return { outcome: "fatal", skill: "refuse", args: {}, speech: [REFUSALS[kind]] };
}

function clean(s: string | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "").trim();
}

const RULES: ReadonlyArray<{ re: RegExp; skill: RouteSkill; args?: (m: RegExpExecArray, u: string) => RouteArgs }> = [
  { re: /^\s*(stop|quiet|be quiet|shush|cancel|enough)\b/i, skill: "stop" },
  { re: /\b(repeat|say (that|it) again|what did you say|pardon)\b/i, skill: "repeat" },
  { re: /\blook (harder|closer|again carefully)\b/i, skill: "look_harder" },
  { re: /\bremember (?:this|these|it|that) as (?:my |our |the )?(.+)$/i, skill: "enrol_object", args: (m) => ({ label: clean(m[1]) }) },
  {
    re: /\b(?:help me|how do i|show me how to|walk me through(?: how to)?)\s+(?:to\s+)?((?:use|start|set|turn on|switch on|run|operate|work|program|defrost|heat|wash|dry)\b.*)$/i,
    skill: "appliance_help",
    args: (m) => ({ task: clean(m[1]) }),
  },
  {
    re: /\b(?:help me|let'?s|i want to|i need to)\s+((?:tidy|clean|sort|organi[sz]e|pack|get dressed|get ready|make (?:the bed|a sandwich|tea|coffee))\b.*)$/i,
    skill: "plan_task",
    args: (m) => ({ goal: clean(m[1]) }),
  },
  { re: /\bwhat should i do (first|next)\b/i, skill: "plan_task", args: () => ({ goal: "" }) },
  { re: /\b(i'?ve got|i have got|i took|i'?m taking|i picked up|i'?ve picked up|i grabbed)\s+(?:my |the )?(.+)$/i, skill: "picked_up", args: (m) => ({ object: clean(m[2]) }) },
  { re: /\b(where(?:'s| is| are| did i (?:put|leave)| have i (?:put|left))|find my|find the|have you seen|look for)\b/i, skill: "find", args: (_m, u) => ({ object: findQuery(u) }) },
  { re: /\b(read|what does (?:it|this|that) say|what'?s written|what is written)\b/i, skill: "read" },
  { re: /\b(what(?:'s| is) (?:this|that|it)|what am i holding|identify (?:this|it))\b/i, skill: "what_is" },
  { re: /\b(describe|what(?:'s| is) (?:in front|around|here)|what do you see|look around|where am i)\b/i, skill: "describe" },
  { re: /\b(help|what can you do|commands)\b/i, skill: "help" },
];

export function routeByRules(utterance: string, knownObjects: string[] = []): RouteDecision {
  const refusal = refusalFor(utterance);
  if (refusal) return refusal;
  const placement = parsePlacement(utterance);
  if (placement) return validateRoute("remember_placement", { object: placement.object, location: placement.location }, knownObjects);
  for (const rule of RULES) {
    const m = rule.re.exec(utterance);
    if (m) return validateRoute(rule.skill, rule.args?.(m, utterance) ?? {}, knownObjects);
  }
  return {
    outcome: "fixable",
    skill: "unsupported",
    args: {},
    speech: ["I didn't catch that. You can say: what's in front of me, read this, what is this, where are my keys, or help."],
  };
}

function knownList(known: string[]): string {
  const names = known.slice(0, 5);
  if (names.length === 0) return "";
  return ` I know: ${names.join(", ")}.`;
}

/** Shim-style validation: success runs; fixable asks a follow-up that teaches the valid options. */
export function validateRoute(skill: RouteSkill, args: RouteArgs, knownObjects: string[] = []): RouteDecision {
  const a: RouteArgs = {};
  for (const [k, v] of Object.entries(args) as [keyof RouteArgs, string | undefined][]) {
    const c = clean(v);
    if (c) a[k] = c.slice(0, 120);
  }
  const ok = (): RouteDecision => ({ outcome: "success", skill, args: a, speech: [] });
  const fix = (speech: string): RouteDecision => ({ outcome: "fixable", skill, args: a, speech: [speech] });
  switch (skill) {
    case "find":
      return a.object ? ok() : fix(`Which object should I look for?${knownList(knownObjects)}`);
    case "picked_up":
      return a.object ? ok() : fix("Which object did you take?");
    case "remember_placement":
      if (!a.object) return fix("What are you putting down? For example: I'm putting my keys on the hall shelf.");
      if (!a.location) return fix(`Where are you putting your ${a.object}? For example: on the hall shelf.`);
      return ok();
    case "enrol_object":
      return a.label ? ok() : fix('What should I call it? Say: remember this as my keys.');
    case "appliance_help":
      return ok();
    case "plan_task":
      return ok();
    case "refuse":
      return { outcome: "fatal", skill, args: a, speech: [] };
    case "unsupported":
      return {
        outcome: "fixable",
        skill,
        args: a,
        speech: ["I can't do that yet. You can say: what's in front of me, read this, what is this, where are my keys, or help."],
      };
    default:
      return ok();
  }
}
