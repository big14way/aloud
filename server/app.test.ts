import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createContext } from "./context.js";
import { FakeLLM } from "./fake-llm.js";
import { ModelError, resetJsonModes } from "./llm.js";
import { FRAME_A, testConfig, visionJson } from "./test-fixtures.js";

beforeEach(() => resetJsonModes());
afterEach(() => vi.restoreAllMocks());

function app(env: Record<string, string> = {}, reply: () => string | Error = () => visionJson([{ content: "a mug" }])) {
  const ctx = createContext(testConfig(env), new FakeLLM(reply));
  return { ctx, app: createApp(ctx) };
}

const json = async (res: Response): Promise<any> => res.json();

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://local/api${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("API", () => {
  it("reports lanes and budget on /api/health", async () => {
    const { app: a } = app();
    const res = await a.fetch(new Request("http://local/api/health"));
    const body = await json(res);
    expect(body.lanes.vision).toEqual({ model: "nvidia/Nemotron-3.5-Super-VL", configured: true });
    expect(body.lanes.fastlane.status).toBe("not_configured");
    expect(body.budget.cap_usd).toBe(5);
  });

  it("answers /api/see", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { app: a } = app();
    const res = await a.fetch(post("/see", { skill: "describe", frames: [FRAME_A] }));
    expect(res.status).toBe(200);
    expect((await json(res)).speech).toEqual(["A mug."]);
  });

  it("never logs image data", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { app: a } = app();
    await a.fetch(post("/see", { skill: "describe", frames: [FRAME_A] }));
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).not.toContain("base64");
    expect(logged).toContain('"frame"');
  });

  it("rejects bad bodies with a spoken error", async () => {
    const { app: a } = app();
    const res = await a.fetch(post("/see", { skill: "describe", frames: ["http://example.com/x.jpg"] }));
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBe("bad_request");
    expect(body.speech[0]).toMatch(/try again/);
  });

  it("says when no model key is configured", async () => {
    const { app: a } = app({ NEBIUS_API_KEY: "" });
    const res = await a.fetch(post("/see", { skill: "describe", frames: [FRAME_A] }));
    expect(res.status).toBe(503);
    expect((await json(res)).error).toBe("not_configured");
  });

  it("caps requests per session per hour", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { app: a } = app({ SESSION_LIMIT_PER_HOUR: "2" });
    const h = { "x-aloud-session": "s1", "x-forwarded-for": "1.2.3.4" };
    expect((await a.fetch(post("/see", { skill: "describe", frames: [FRAME_A] }, h))).status).toBe(200);
    expect((await a.fetch(post("/see", { skill: "describe", frames: [FRAME_A] }, h))).status).toBe(200);
    const third = await a.fetch(post("/see", { skill: "describe", frames: [FRAME_A] }, h));
    expect(third.status).toBe(429);
    expect((await json(third)).error).toBe("session_limit");
  });

  it("stops spending when the daily budget is used up", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { app: a, ctx } = app();
    ctx.spend.add(5);
    const res = await a.fetch(post("/see", { skill: "describe", frames: [FRAME_A] }));
    expect(res.status).toBe(429);
    expect((await json(res)).error).toBe("budget");
  });

  it("passes rate limits through with a retry hint", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { app: a } = app({}, () => new ModelError("429", "rate_limited", 7));
    const res = await a.fetch(post("/see", { skill: "describe", frames: [FRAME_A] }));
    expect(res.status).toBe(429);
    expect(await json(res)).toMatchObject({ error: "rate_limited", retry_after_s: 7 });
  });

  it("returns unchanged speech for standard-mode shaping without a model call", async () => {
    const { app: a } = app({}, () => new Error("should not be called"));
    const res = await a.fetch(post("/shape", { sentences: ["Your keys: on the shelf, confirmed today at 10:42."], mode: "standard" }));
    expect((await json(res)).source).toBe("unchanged");
  });
});
