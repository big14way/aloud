import { MODELS } from "../shared/config.js";

export type JsonMode = "json_schema" | "json_object" | "prompt";

export interface ServerConfig {
  nebiusApiKey: string;
  nebiusBaseUrl: string;
  tavilyApiKey: string;
  models: { vision: string; fast: string; steps: string; judge: string };
  /** Optional distilled Nemotron Nano 4B on a Nebius Serverless AI endpoint. */
  fastlane: { url: string; token: string; model: string } | null;
  jsonMode: JsonMode;
  adjudication: boolean;
  dailyBudgetUsd: number;
  sessionLimitPerHour: number;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const jsonMode = env.NEBIUS_JSON_MODE;
  const fastlaneUrl = env.FASTLANE_URL?.trim() ?? "";
  return {
    nebiusApiKey: env.NEBIUS_API_KEY?.trim() ?? "",
    nebiusBaseUrl: env.NEBIUS_BASE_URL?.trim() || "https://api.tokenfactory.nebius.com/v1/",
    tavilyApiKey: env.TAVILY_API_KEY?.trim() ?? "",
    models: {
      vision: env.MODEL_VISION?.trim() || MODELS.vision,
      fast: env.MODEL_FAST?.trim() || MODELS.fast,
      steps: env.MODEL_STEPS?.trim() || MODELS.steps,
      judge: env.MODEL_JUDGE?.trim() || MODELS.judge,
    },
    fastlane: fastlaneUrl
      ? { url: fastlaneUrl.replace(/\/+$/, ""), token: env.FASTLANE_TOKEN?.trim() ?? "", model: env.FASTLANE_MODEL?.trim() || "aloud-nano-4b" }
      : null,
    jsonMode: jsonMode === "json_object" || jsonMode === "prompt" ? jsonMode : "json_schema",
    adjudication: env.ENABLE_ADJUDICATION !== "false",
    dailyBudgetUsd: num(env.DAILY_BUDGET_USD, 1),
    sessionLimitPerHour: num(env.SESSION_LIMIT_PER_HOUR, 30),
  };
}
