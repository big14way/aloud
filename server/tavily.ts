// Minimal Tavily REST client (https://docs.tavily.com): search, then extract the
// task-relevant chunks of the best pages. Web content is untrusted data.

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface TavilyExtract {
  url: string;
  raw_content: string;
}

export class TavilyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class Tavily {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = "https://api.tavily.com",
  ) {}

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new TavilyError(`Tavily ${path} failed with ${res.status}`, res.status);
    return (await res.json()) as T;
  }

  async search(query: string, maxResults = 5): Promise<TavilyResult[]> {
    const data = await this.post<{ results?: TavilyResult[] }>("/search", {
      query,
      search_depth: "basic",
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
    });
    return (data.results ?? []).filter((r) => typeof r.url === "string" && typeof r.content === "string");
  }

  /** Extract only the chunks relevant to `query` from up to 5 pages. */
  async extract(urls: string[], query: string): Promise<TavilyExtract[]> {
    if (urls.length === 0) return [];
    const data = await this.post<{ results?: TavilyExtract[] }>("/extract", {
      urls: urls.slice(0, 5),
      query,
      chunks_per_source: 5,
      extract_depth: "basic",
      format: "text",
    });
    return (data.results ?? []).filter((r) => typeof r.raw_content === "string" && r.raw_content.trim().length > 0);
  }
}

/** Rank results so manual-like pages come first. */
export function rankManualResults(results: TavilyResult[], modelNumber: string): TavilyResult[] {
  const model = modelNumber.toLowerCase().replace(/[\s\-_]/g, "");
  const score = (r: TavilyResult) => {
    const hay = `${r.title} ${r.url} ${r.content}`.toLowerCase();
    let s = r.score;
    if (hay.replace(/[\s\-_]/g, "").includes(model)) s += 1;
    if (/manual|instruction|user guide|owner'?s guide|operating/.test(hay)) s += 0.5;
    if (/\.pdf($|\?)/.test(r.url.toLowerCase())) s += 0.25;
    return s;
  };
  return [...results].sort((a, b) => score(b) - score(a));
}
