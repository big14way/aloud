import type { ChatRequest, ChatResult, LLM, ToolCall } from "./llm.js";

export type FakeReply = string | { text?: string; toolCalls?: ToolCall[] } | Error;

/** Scripted model for tests: each call is answered by `respond`, and every request is recorded. */
export class FakeLLM implements LLM {
  readonly requests: ChatRequest[] = [];

  constructor(private readonly respond: (req: ChatRequest, n: number) => FakeReply) {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    this.requests.push(req);
    const reply = this.respond(req, this.requests.length - 1);
    if (reply instanceof Error) throw reply;
    const r = typeof reply === "string" ? { text: reply } : reply;
    return {
      text: r.text ?? "",
      toolCalls: r.toolCalls ?? [],
      metric: { lane: req.lane, model: req.model, latency_ms: 5, prompt_tokens: 1000, completion_tokens: 100, reasoning_tokens: 0, cost_usd: 0.001 },
    };
  }
}

/** The text of the last user message, for routing fake replies. */
export function userText(req: ChatRequest): string {
  const last = [...req.messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  return (last.content ?? []).map((p) => ("text" in p ? p.text : "")).join(" ");
}

export function imageCount(req: ChatRequest): number {
  const last = [...req.messages].reverse().find((m) => m.role === "user");
  if (!last || typeof last.content === "string") return 0;
  return (last.content ?? []).filter((p) => p.type === "image_url").length;
}

export function firstImage(req: ChatRequest): string {
  const last = [...req.messages].reverse().find((m) => m.role === "user");
  if (!last || typeof last.content === "string") return "";
  const part = (last.content ?? []).find((p) => p.type === "image_url");
  return part && part.type === "image_url" ? part.image_url.url : "";
}
