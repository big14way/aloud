import type { RouteRequest, RouteResponse, RouteSkill } from "../shared/api.js";
import { type RouteDecision, refusalFor, routeByRules, validateRoute } from "../shared/router.js";
import { type Ctx, Meter, withTextLane } from "./context.js";
import type { Tool } from "./llm.js";

// Intent routing with tool calling on Nemotron 3.5 Lightning (or the distilled
// fast lane). Flat, typed arguments; code validates every call.

function tool(name: string, description: string, props: Record<string, string> = {}): Tool {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(Object.entries(props).map(([k, d]) => [k, { type: "string", description: d }])),
        required: Object.keys(props),
        additionalProperties: false,
      },
    },
  };
}

export const ROUTE_TOOLS: Tool[] = [
  tool("describe_scene", "Say what is in front of the camera: objects, hazards, layout."),
  tool("read_text", "Read printed text aloud word for word: letters, labels, signs, receipts, screens."),
  tool("identify_object", "Say what the single object held up to the camera is."),
  tool("find_object", "Answer where one of the user's remembered objects is.", { object: "The object, in the user's words, e.g. 'house keys'." }),
  tool("remember_placement", "The user is putting an object somewhere and wants it remembered.", {
    object: "The object, e.g. 'keys'.",
    location: "Where, starting with a preposition, e.g. 'on the hall shelf'.",
  }),
  tool("picked_up", "The user has taken an object from where it was.", { object: "The object, e.g. 'wallet'." }),
  tool("enrol_object", "Learn a new personal object from the camera so it can be found later.", { label: "What to call it, e.g. 'car keys'." }),
  tool("appliance_help", "Help the user operate an appliance step by step using its manual.", { task: "What the user wants to do, e.g. 'defrost bread'." }),
  tool("plan_task", "Break an everyday task in front of the user into small spoken steps.", { goal: "The task, e.g. 'tidy my room'." }),
  tool("repeat_last", "Repeat the last answer."),
  tool("stop_speaking", "Stop talking."),
  tool("look_harder", "Look at the last scene again more carefully, taking more time."),
  tool("show_help", "Explain what Aloud can do."),
  tool("unsupported", "Nothing else fits the request.", { reason: "Short reason." }),
];

const TOOL_TO_SKILL: Record<string, RouteSkill> = {
  describe_scene: "describe",
  read_text: "read",
  identify_object: "what_is",
  find_object: "find",
  remember_placement: "remember_placement",
  picked_up: "picked_up",
  enrol_object: "enrol_object",
  appliance_help: "appliance_help",
  plan_task: "plan_task",
  repeat_last: "repeat",
  stop_speaking: "stop",
  look_harder: "look_harder",
  show_help: "help",
  unsupported: "unsupported",
};

export const ROUTE_SYSTEM = `You route one spoken request from a blind or low-vision user of Aloud, a camera assistant, to exactly one tool.
Call exactly one tool. Copy argument values from the user's words; keep them short. If nothing fits, call unsupported.`;

/** A state note on every turn, so the router knows what exists right now. */
export function stateNote(req: RouteRequest): string {
  const objects = req.known_objects?.length ? req.known_objects.join(", ") : "none yet";
  return `State: remembered objects: ${objects}. Appliance helper active: ${req.appliance_active ? "yes" : "no"}.`;
}

export function decisionFromToolCall(name: string, rawArgs: string, known: string[]): RouteDecision | null {
  const skill = TOOL_TO_SKILL[name];
  if (!skill) return null;
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = rawArgs ? JSON.parse(rawArgs) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : undefined);
  return validateRoute(skill, { object: str("object"), location: str("location"), label: str("label"), task: str("task"), goal: str("goal") }, known);
}

export async function route(ctx: Ctx, req: RouteRequest): Promise<RouteResponse> {
  const meter = new Meter(ctx.spend);
  const known = req.known_objects ?? [];
  // Refusals are decided in code before any model sees the request.
  const refusal = refusalFor(req.utterance);
  if (refusal) return { ok: true, ...refusal, lane: "rules", metrics: meter.summary() };

  if (ctx.cfg.nebiusApiKey && !ctx.spend.exhausted()) {
    try {
      const result = await withTextLane(ctx, async (lane) => {
        const res = await ctx.llm.chat({
          ...lane,
          messages: [
            { role: "system", content: ROUTE_SYSTEM },
            { role: "user", content: `${stateNote(req)}\nUser said: "${req.utterance}"` },
          ],
          tools: ROUTE_TOOLS,
          toolChoice: "required",
          temperature: 0.2,
          maxTokens: 200,
          reasoningEffort: "none",
        });
        meter.add([res.metric]);
        const call = res.toolCalls[0];
        const decision = call ? decisionFromToolCall(call.name, call.arguments, known) : null;
        if (!decision) throw new Error("no usable tool call");
        return { decision, lane: lane.lane };
      });
      return { ok: true, ...result.decision, lane: result.lane === "fastlane" ? "fastlane" : "fast", metrics: meter.summary() };
    } catch {
      // Fall through to the rules router.
    }
  }
  return { ok: true, ...routeByRules(req.utterance, known), lane: "rules", metrics: meter.summary() };
}
