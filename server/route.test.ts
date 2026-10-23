import { describe, expect, it } from "vitest";
import { REFUSALS } from "../shared/safety.js";
import { createContext } from "./context.js";
import { FakeLLM, userText } from "./fake-llm.js";
import { ModelError } from "./llm.js";
import { ROUTE_TOOLS, route } from "./route.js";
import { testConfig } from "./test-fixtures.js";

describe("route", () => {
  it("routes with Lightning tool calling and a state note", async () => {
    const llm = new FakeLLM(() => ({ toolCalls: [{ name: "find_object", arguments: '{"object":"house keys"}' }] }));
    const ctx = createContext(testConfig(), llm);
    const res = await route(ctx, { utterance: "any idea where my house keys went", known_objects: ["house keys"] });
    expect(res).toMatchObject({ outcome: "success", skill: "find", args: { object: "house keys" }, lane: "fast" });
    const r = llm.requests[0]!;
    expect(r.model).toBe("nvidia/Nemotron-3_5-Lightning");
    expect(r.toolChoice).toBe("required");
    expect(r.tools).toBe(ROUTE_TOOLS);
    expect(userText(r)).toContain("remembered objects: house keys");
  });

  it("refuses in code without calling a model", async () => {
    const llm = new FakeLLM(() => new Error("must not be called"));
    const res = await route(createContext(testConfig(), llm), { utterance: "how many tablets should I take" });
    expect(res).toMatchObject({ outcome: "fatal", skill: "refuse", speech: [REFUSALS.dosing], lane: "rules" });
    expect(llm.requests).toHaveLength(0);
  });

  it("validates tool arguments and asks a follow-up", async () => {
    const llm = new FakeLLM(() => ({ toolCalls: [{ name: "remember_placement", arguments: '{"object":"keys","location":""}' }] }));
    const res = await route(createContext(testConfig(), llm), { utterance: "remember my keys" });
    expect(res.outcome).toBe("fixable");
  });

  it("falls back to rules when the model fails or returns no tool", async () => {
    const failing = new FakeLLM(() => new ModelError("down", "unavailable"));
    expect(await route(createContext(testConfig(), failing), { utterance: "read this" })).toMatchObject({ skill: "read", lane: "rules" });
    const silent = new FakeLLM(() => ({ text: "Sure!" }));
    expect(await route(createContext(testConfig(), silent), { utterance: "read this" })).toMatchObject({ skill: "read", lane: "rules" });
    const unknownTool = new FakeLLM(() => ({ toolCalls: [{ name: "delete_everything", arguments: "{}" }] }));
    expect(await route(createContext(testConfig(), unknownTool), { utterance: "read this" })).toMatchObject({ skill: "read", lane: "rules" });
  });

  it("works with no model key at all", async () => {
    const llm = new FakeLLM(() => new Error("no"));
    const res = await route(createContext(testConfig({ NEBIUS_API_KEY: "" }), llm), { utterance: "what is this" });
    expect(res).toMatchObject({ skill: "what_is", lane: "rules" });
    expect(llm.requests).toHaveLength(0);
  });
});
