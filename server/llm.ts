import OpenAI from "openai";
import type { z } from "zod";
import type { CallMetric } from "../shared/api.js";
import { costUsd } from "../shared/config.js";
import { parseJsonObject } from "../shared/json.js";
import { jsonSchemaFor } from "../shared/schemas.js";
import type { JsonMode, ServerConfig } from "./env.js";

export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type Tool = OpenAI.Chat.Completions.ChatCompletionFunctionTool;
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";
export type Lane = CallMetric["lane"];
export type { CallMetric };

export interface ChatRequest {
  lane: Lane;
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  responseFormat?: { name: string; schema: Record<string, unknown> } | "json_object";
  tools?: Tool[];
  toolChoice?: "auto" | "required" | "none";
  signal?: AbortSignal;
}

export interface ToolCall {
  name: string;
  arguments: string;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  metric: CallMetric;
}

/** The only thing the skills need from a model provider. Tests swap in a fake. */
export interface LLM {
  chat(req: ChatRequest): Promise<ChatResult>;
}

export class ModelError extends Error {
  /** Billed calls made before the failure, so the daily budget still counts them. */
  metrics: CallMetric[] = [];

  constructor(
    message: string,
    readonly kind: "rate_limited" | "bad_request" | "unavailable" | "invalid_output" | "aborted" | "not_configured",
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

/** Metrics of billed calls carried by a failure (empty for anything else). */
export function errorMetrics(err: unknown): CallMetric[] {
  return err instanceof ModelError ? err.metrics : [];
}

/** OpenAI-compatible client for Nebius Token Factory and the optional Serverless fast lane. */
export class OpenAICompatibleLLM implements LLM {
  private readonly tokenFactory: OpenAI | null;
  private readonly fastlane: OpenAI | null;

  constructor(cfg: ServerConfig) {
    this.tokenFactory = cfg.nebiusApiKey
      ? new OpenAI({ apiKey: cfg.nebiusApiKey, baseURL: cfg.nebiusBaseUrl, maxRetries: 1, timeout: 45_000 })
      : null;
    this.fastlane = cfg.fastlane
      ? new OpenAI({ apiKey: cfg.fastlane.token || "none", baseURL: `${cfg.fastlane.url}/v1`, maxRetries: 0, timeout: 15_000 })
      : null;
  }

  /** Models that rejected reasoning_effort; it is not sent to them again. */
  private readonly noReasoningParam = new Set<string>();

  async chat(req: ChatRequest): Promise<ChatResult> {
    try {
      return await this.send(req);
    } catch (err) {
      if (err instanceof ModelError && err.kind === "bad_request" && req.reasoningEffort && /reasoning/i.test(err.message)) {
        this.noReasoningParam.add(req.model);
        return this.send(req);
      }
      throw err;
    }
  }

  private async send(req: ChatRequest): Promise<ChatResult> {
    const client = req.lane === "fastlane" ? this.fastlane : this.tokenFactory;
    if (!client) throw new ModelError(`No client configured for lane ${req.lane}`, "not_configured");
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxTokens ?? 600,
    };
    if (req.reasoningEffort && req.lane !== "fastlane" && !this.noReasoningParam.has(req.model)) body.reasoning_effort = req.reasoningEffort;
    if (req.lane === "fastlane") body.chat_template_kwargs = { enable_thinking: false };
    if (req.responseFormat === "json_object") body.response_format = { type: "json_object" };
    else if (req.responseFormat) {
      body.response_format = { type: "json_schema", json_schema: { name: req.responseFormat.name, schema: req.responseFormat.schema, strict: true } };
    }
    if (req.tools) {
      body.tools = req.tools;
      body.tool_choice = req.toolChoice ?? "auto";
    }
    const started = Date.now();
    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = (await client.chat.completions.create(
        body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        { signal: req.signal },
      )) as OpenAI.Chat.Completions.ChatCompletion;
    } catch (err) {
      throw toModelError(err);
    }
    const latency = Date.now() - started;
    const choice = completion.choices[0];
    const usage = completion.usage;
    const prompt = usage?.prompt_tokens ?? 0;
    const output = usage?.completion_tokens ?? 0;
    const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    const toolCalls: ToolCall[] = [];
    for (const call of choice?.message.tool_calls ?? []) {
      if (call.type === "function") toolCalls.push({ name: call.function.name, arguments: call.function.arguments });
    }
    return {
      text: choice?.message.content ?? "",
      toolCalls,
      metric: {
        lane: req.lane,
        model: req.model,
        latency_ms: latency,
        prompt_tokens: prompt,
        completion_tokens: output,
        reasoning_tokens: reasoning,
        cost_usd: req.lane === "fastlane" ? 0 : costUsd(req.model, prompt, output),
      },
    };
  }
}

function toModelError(err: unknown): ModelError {
  if (err instanceof ModelError) return err;
  if (err instanceof OpenAI.APIUserAbortError) return new ModelError("Request aborted", "aborted");
  if (err instanceof OpenAI.APIError) {
    if (err.status === 429) {
      const retry = Number(err.headers?.get("retry-after"));
      return new ModelError("Rate limited", "rate_limited", Number.isFinite(retry) ? retry : undefined);
    }
    if (err.status === 400 || err.status === 422) return new ModelError(err.message, "bad_request");
    return new ModelError(err.message, "unavailable");
  }
  return new ModelError(err instanceof Error ? err.message : String(err), "unavailable");
}

// JSON mode can differ per model on Token Factory. If strict json_schema is
// rejected, fall back to json_object, then to prompt-only JSON. A fallback is
// remembered only once it has worked, and errors that are clearly about something
// else (context length, the image) never trigger one.
const jsonModeByModel = new Map<string, JsonMode>();

const FALLBACK: Record<JsonMode, JsonMode | null> = { json_schema: "json_object", json_object: "prompt", prompt: null };
const NOT_A_FORMAT_ERROR = /context|too long|maximum|max_tokens|token limit|image|base64|decode/i;

export function resetJsonModes(): void {
  jsonModeByModel.clear();
}

export interface JsonCall<T> {
  data: T;
  metrics: CallMetric[];
}

/**
 * Ask for JSON matching `schema`. Validates with zod; on invalid output sends one
 * corrective follow-up and retries once.
 */
export async function chatJson<T>(
  llm: LLM,
  req: Omit<ChatRequest, "responseFormat">,
  schema: z.ZodType<T>,
  name: string,
  defaultMode: JsonMode,
): Promise<JsonCall<T>> {
  const jsonSchema = jsonSchemaFor(schema);
  const metrics: CallMetric[] = [];
  const startMode: JsonMode = jsonModeByModel.get(req.model) ?? defaultMode;
  let mode: JsonMode = startMode;

  // Some chat templates only accept a system message first, so the hint is merged into it.
  const withSchemaHint = (messages: Message[]): Message[] => {
    if (mode === "json_schema") return messages;
    const hint = `Reply with ONLY one JSON object, no prose, matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
    const [head, ...rest] = messages;
    if (head?.role === "system" && typeof head.content === "string") {
      return [{ role: "system", content: `${head.content}\n\n${hint}` }, ...rest];
    }
    return [{ role: "system", content: hint }, ...messages];
  };

  const call = async (messages: Message[]): Promise<ChatResult> => {
    for (;;) {
      try {
        const result = await llm.chat({
          ...req,
          messages: withSchemaHint(messages),
          responseFormat: mode === "json_schema" ? { name, schema: jsonSchema } : mode === "json_object" ? "json_object" : undefined,
        });
        metrics.push(result.metric);
        if (mode !== startMode) jsonModeByModel.set(req.model, mode);
        return result;
      } catch (err) {
        const next = FALLBACK[mode];
        if (err instanceof ModelError && err.kind === "bad_request" && next && !NOT_A_FORMAT_ERROR.test(err.message)) {
          mode = next;
          continue;
        }
        throw err;
      }
    }
  };

  try {
    const first = await call(req.messages);
    const parsed = tryParse(first.text, schema);
    if (parsed.ok) return { data: parsed.data, metrics };

    const retry = await call([
      ...req.messages,
      { role: "assistant", content: first.text.slice(0, 4000) },
      {
        role: "user",
        content: `The previous answer was not valid JSON for the schema (${parsed.error}). Reply ONLY with the corrected JSON object.`,
      },
    ]);
    const second = tryParse(retry.text, schema);
    if (second.ok) return { data: second.data, metrics };
    throw new ModelError(`Model returned invalid JSON twice: ${second.error}`, "invalid_output");
  } catch (err) {
    const e = err instanceof ModelError ? err : new ModelError(err instanceof Error ? err.message : String(err), "unavailable");
    e.metrics = [...metrics, ...e.metrics.filter((m) => !metrics.includes(m))];
    throw e;
  }
}

function tryParse<T>(text: string, schema: z.ZodType<T>): { ok: true; data: T } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = parseJsonObject(text);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unparseable" };
  }
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}
