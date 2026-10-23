import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { applianceSteps, buildQuery } from "./appliance.js";
import { createContext } from "./context.js";
import { FakeLLM, userText } from "./fake-llm.js";
import { Tavily, TavilyError, rankManualResults } from "./tavily.js";
import { testConfig } from "./test-fixtures.js";

const req = { brand: "Acme", model_number: "MW-2041", appliance_type: "microwave", task: "defrost bread", mode: "standard" as const };

function fakeFetch(handler: (path: string, body: Record<string, unknown>, headers: Headers) => unknown) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const out = handler(path, body, new Headers(init?.headers));
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

const searchResults = {
  results: [
    { title: "Recipes blog", url: "https://blog.example/bread", content: "bread is nice", score: 0.9 },
    { title: "Acme MW-2041 Owner's Manual", url: "https://acme.example/mw2041.pdf", content: "Defrost: press DEFROST", score: 0.7 },
  ],
};

describe("Tavily client", () => {
  it("sends the key as a bearer token and the documented fields", async () => {
    const calls: { path: string; body: Record<string, unknown>; auth: string | null }[] = [];
    const f = fakeFetch((path, body, headers) => {
      calls.push({ path, body, auth: headers.get("authorization") });
      return path === "/search" ? searchResults : { results: [{ url: "https://acme.example/mw2041.pdf", raw_content: "Press DEFROST." }] };
    });
    const t = new Tavily("tvly-test", f);
    await t.search("acme manual");
    await t.extract(["https://acme.example/mw2041.pdf"], "defrost bread");
    expect(calls[0]).toMatchObject({ path: "/search", auth: "Bearer tvly-test", body: { query: "acme manual", search_depth: "basic", max_results: 5 } });
    expect(calls[1]?.body.urls).toEqual(["https://acme.example/mw2041.pdf"]);
    expect(calls[1]).toMatchObject({ path: "/extract", body: { urls: ["https://acme.example/mw2041.pdf"], query: "defrost bread", chunks_per_source: 5, format: "text" } });
  });

  it("raises TavilyError on HTTP failure", async () => {
    const t = new Tavily("k", fakeFetch(() => new Response("{}", { status: 432 })));
    await expect(t.search("x")).rejects.toBeInstanceOf(TavilyError);
  });

  it("ranks the matching manual above other pages", () => {
    expect(rankManualResults(searchResults.results, "MW-2041")[0]?.url).toBe("https://acme.example/mw2041.pdf");
  });

  it("prefers the maker's help page over a forum or spec sheet that only mentions the model", () => {
    const live = [
      { title: "model NN-SN966S Lost all control of the keypad", url: "https://www.ifixit.com/Answers/View/752717/model+NN-SN966S", content: "keypad problem", score: 0.62 },
      { title: "How to use the auto or turbo defrost feature", url: "https://help.na.panasonic.com/answers/how-to-use-the-auto-or-turbo-defrost-feature-on-the-microwave-oven", content: "Defrost: press Turbo Defrost", score: 0.67 },
      { title: "Panasonic NN-SN966S specs", url: "https://appliances.techreviewer.com/appliance-specs/panasonic-nn-sn966s-microwave", content: "specifications", score: 0.65 },
    ];
    expect(rankManualResults(live, "NN-SN966S", "defrost bread")[0]?.url).toContain("help.na.panasonic.com");
  });
});

describe("applianceSteps", () => {
  const steps = {
    found_instructions: true,
    steps: [
      { instruction: "Press the DEFROST button on the right of the panel.", visual_check: "the display shows dEF" },
      { instruction: "Turn the dial to set the weight.", visual_check: "the display shows a weight" },
      { instruction: "See https://evil.example for more.", visual_check: "" },
    ],
    caution: "Do not run the microwave empty.",
  };

  it("searches with the model number, extracts the manual, and asks Super for steps", async () => {
    const tavily = new Tavily("k", fakeFetch((path) => (path === "/search" ? searchResults : { results: [{ url: "https://acme.example/mw2041.pdf", raw_content: "Acme MW-2041 manual. DEFROST: press DEFROST, set weight with dial." }] })));
    const llm = new FakeLLM(() => JSON.stringify(steps));
    const res = await applianceSteps(createContext(testConfig({ TAVILY_API_KEY: "k" }), llm), req, tavily);
    const r = llm.requests[0]!;
    expect(r.model).toBe("nvidia/nemotron-3-super-120b-a12b");
    expect(userText(r)).toContain('<source url="https://acme.example/mw2041.pdf">');
    expect(res.steps).toHaveLength(2);
    expect(res.speech).toEqual([
      "I found instructions for model MW-2041. There are 2 steps.",
      "Careful: Do not run the microwave empty.",
      "Step 1: Press the DEFROST button on the right of the panel.",
      "Press the button when you're done, and I'll check with the camera.",
    ]);
    expect(res.sources[0]?.url).toBe("https://acme.example/mw2041.pdf");
  });

  it("says when the steps come from a similar model's manual", async () => {
    const tavily = new Tavily("k", fakeFetch((path) => (path === "/search" ? searchResults : { results: [{ url: "https://acme.example/mw2050.pdf", raw_content: "MW-2050 manual. DEFROST: press DEFROST." }] })));
    const llm = new FakeLLM(() => JSON.stringify(steps));
    const res = await applianceSteps(createContext(testConfig(), llm), req, tavily);
    expect(res.speech[0]).toBe("I found instructions for a similar model, so the buttons may differ from yours. There are 2 steps.");
  });

  it("says so when the manual doesn't cover the task", async () => {
    const tavily = new Tavily("k", fakeFetch((path) => (path === "/search" ? searchResults : { results: [] })));
    const llm = new FakeLLM(() => JSON.stringify({ found_instructions: false, steps: [], caution: "" }));
    const res = await applianceSteps(createContext(testConfig(), llm), req, tavily);
    expect(res.found_instructions).toBe(false);
    expect(res.speech[0]).toContain("not clear steps to defrost bread");
  });

  it("says so when search finds nothing, without calling a model", async () => {
    const tavily = new Tavily("k", fakeFetch(() => ({ results: [] })));
    const llm = new FakeLLM(() => new Error("no"));
    const res = await applianceSteps(createContext(testConfig(), llm), req, tavily);
    expect(res.speech[0]).toContain("couldn't find a manual for model MW-2041");
    expect(llm.requests).toHaveLength(0);
  });

  it("builds a manual query", () => {
    expect(buildQuery(req)).toBe("Acme MW-2041 microwave owner's manual how to defrost bread");
  });
});

describe("/api/appliance", () => {
  it("needs the Tavily key", async () => {
    const app = createApp(createContext(testConfig({ TAVILY_API_KEY: "" }), new FakeLLM(() => "{}")));
    const res = await app.fetch(new Request("http://local/api/appliance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) }));
    expect(res.status).toBe(503);
  });

  it("maps Tavily failures to a spoken tool error", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const failing = () => new Tavily("k", fakeFetch(() => new Response("{}", { status: 500 })));
    const app = createApp(createContext(testConfig({ TAVILY_API_KEY: "k" }), new FakeLLM(() => "{}")), failing);
    const res = await app.fetch(new Request("http://local/api/appliance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) }));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe("tool_error");
    vi.restoreAllMocks();
  });
});
