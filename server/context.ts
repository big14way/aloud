import type { CallMetric, Metrics } from "../shared/api.js";
import { DailySpend, SessionLimiter } from "./budget.js";
import { loadConfig, type ServerConfig } from "./env.js";
import { type ChatRequest, type LLM, OpenAICompatibleLLM } from "./llm.js";

export type FastlaneStatus = "up" | "down" | "not_configured";

/** Tracks whether the distilled fast lane endpoint is reachable. Cached for a minute. */
export class FastlaneHealth {
  private status: FastlaneStatus;
  private checkedAt = 0;

  constructor(
    private readonly cfg: ServerConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.status = cfg.fastlane ? "down" : "not_configured";
  }

  async check(force = false): Promise<FastlaneStatus> {
    const lane = this.cfg.fastlane;
    if (!lane) return "not_configured";
    if (!force && this.now() - this.checkedAt < 60_000) return this.status;
    this.checkedAt = this.now();
    try {
      const res = await this.fetchImpl(`${lane.url}/v1/models`, {
        headers: lane.token ? { Authorization: `Bearer ${lane.token}` } : {},
        signal: AbortSignal.timeout(2500),
      });
      this.status = res.ok ? "up" : "down";
    } catch {
      this.status = "down";
    }
    return this.status;
  }

  markDown(): void {
    if (this.cfg.fastlane) {
      this.status = "down";
      this.checkedAt = this.now();
    }
  }
}

export interface Ctx {
  cfg: ServerConfig;
  llm: LLM;
  fastlane: FastlaneHealth;
  spend: DailySpend;
  sessions: SessionLimiter;
  /** Looser per-IP cap, so rotating session ids does not bypass the session cap. */
  ips: SessionLimiter;
}

const PER_IP_FACTOR = 4;

export function createContext(cfg: ServerConfig = loadConfig(), llm: LLM = new OpenAICompatibleLLM(cfg)): Ctx {
  return {
    cfg,
    llm,
    fastlane: new FastlaneHealth(cfg),
    spend: new DailySpend(cfg.dailyBudgetUsd),
    sessions: new SessionLimiter(cfg.sessionLimitPerHour),
    ips: new SessionLimiter(cfg.sessionLimitPerHour * PER_IP_FACTOR),
  };
}

/** Collects per-call metrics for one API request and charges them to the daily budget. */
export class Meter {
  readonly calls: CallMetric[] = [];
  private readonly started = Date.now();

  constructor(private readonly spend: DailySpend) {}

  add(metrics: CallMetric[]): void {
    for (const m of metrics) {
      this.calls.push(m);
      this.spend.add(m.cost_usd);
    }
  }

  summary(): Metrics {
    const cost = this.calls.reduce((s, c) => s + c.cost_usd, 0);
    return { total_ms: Date.now() - this.started, cost_usd: Math.round(cost * 1e6) / 1e6, calls: this.calls };
  }
}

/** The lane for everyday text calls: the distilled fast lane when it is up, else Lightning. */
export async function textLane(ctx: Ctx): Promise<Pick<ChatRequest, "lane" | "model">> {
  if (ctx.cfg.fastlane && (await ctx.fastlane.check()) === "up") {
    return { lane: "fastlane", model: ctx.cfg.fastlane.model };
  }
  return { lane: "fast", model: ctx.cfg.models.fast };
}

/** Run a text call on the fast lane, falling back to Lightning if the fast lane fails. */
export async function withTextLane<T>(ctx: Ctx, run: (lane: Pick<ChatRequest, "lane" | "model">) => Promise<T>): Promise<T> {
  const lane = await textLane(ctx);
  if (lane.lane !== "fastlane") return run(lane);
  try {
    return await run(lane);
  } catch {
    ctx.fastlane.markDown();
    return run({ lane: "fast", model: ctx.cfg.models.fast });
  }
}
