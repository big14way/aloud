import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeLLM } from "./fake-llm.js";
import { ModelError, chatJson, resetJsonModes } from "./llm.js";

const Out = z.object({ answer: z.string() });
const req = { lane: "fast" as const, model: "m", messages: [{ role: "system" as const, content: "sys" }, { role: "user" as const, content: "hi" }] };

beforeEach(() => resetJsonModes());

describe("chatJson", () => {
  it("asks for strict json_schema and parses the reply", async () => {
    const llm = new FakeLLM(() => '{"answer":"yes"}');
    const res = await chatJson(llm, req, Out, "out", "json_schema");
    expect(res.data).toEqual({ answer: "yes" });
    const rf = llm.requests[0]?.responseFormat;
    expect(rf && typeof rf === "object" && rf.name).toBe("out");
  });

  it("sends one corrective follow-up after invalid JSON", async () => {
    const llm = new FakeLLM((_r, n) => (n === 0 ? "Sure! here you go" : '<think>ok</think>{"answer":"fixed"}'));
    const res = await chatJson(llm, req, Out, "out", "json_schema");
    expect(res.data.answer).toBe("fixed");
    expect(llm.requests).toHaveLength(2);
    expect(JSON.stringify(llm.requests[1]?.messages.at(-1))).toContain("not valid JSON");
    expect(res.metrics).toHaveLength(2);
  });

  it("gives up after the second invalid reply", async () => {
    const llm = new FakeLLM(() => '{"wrong": 1}');
    await expect(chatJson(llm, req, Out, "out", "json_schema")).rejects.toMatchObject({ kind: "invalid_output" });
  });

  it("falls back from json_schema to json_object when the server rejects it, and remembers", async () => {
    const llm = new FakeLLM((r) => (r.responseFormat && r.responseFormat !== "json_object" ? new ModelError("response_format unsupported", "bad_request") : '{"answer":"ok"}'));
    await chatJson(llm, req, Out, "out", "json_schema");
    expect(llm.requests.map((r) => r.responseFormat === "json_object")).toEqual([false, true]);
    const sys = llm.requests[1]?.messages[0];
    expect(sys?.role).toBe("system");
    expect(String(sys?.content)).toContain("JSON Schema");
    await chatJson(llm, req, Out, "out", "json_schema");
    expect(llm.requests[2]?.responseFormat).toBe("json_object");
  });

  it("does not retry on rate limits", async () => {
    const llm = new FakeLLM(() => new ModelError("slow down", "rate_limited", 3));
    await expect(chatJson(llm, req, Out, "out", "json_schema")).rejects.toMatchObject({ kind: "rate_limited", retryAfterSec: 3 });
    expect(llm.requests).toHaveLength(1);
  });
});
