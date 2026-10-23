// Type-only imports: zod stays on the server and out of the phone bundle.
import type {
  ApplianceRequest,
  ApplianceResponse,
  ErrorResponse,
  HealthResponse,
  RouteRequest,
  RouteResponse,
  SeeRequest,
  SeeResponse,
  ShapeRequest,
  ShapeResponse,
} from "../../shared/api";
import { sessionId } from "./session";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ErrorResponse; offline: boolean };

const OFFLINE: ErrorResponse = { ok: false, error: "model_error", speech: ["I'm offline right now."] };
const FAILED: ErrorResponse = { ok: false, error: "model_error", speech: ["I couldn't get an answer just now. Please try again."] };

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 40_000): Promise<ApiResult<T>> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, error: OFFLINE, offline: true };
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { "content-type": "application/json", "x-aloud-session": sessionId() },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, error: OFFLINE, offline: true };
  }
  const json = (await res.json().catch(() => null)) as (T & { ok?: boolean }) | ErrorResponse | null;
  if (res.ok && json && json.ok === true) return { ok: true, data: json as T };
  if (json && json.ok === false) return { ok: false, error: json as ErrorResponse, offline: false };
  return { ok: false, error: FAILED, offline: false };
}

export const api = {
  see: (req: SeeRequest) => call<SeeResponse>("POST", "/see", req),
  route: (req: RouteRequest) => call<RouteResponse>("POST", "/route", req, 15_000),
  shape: (req: ShapeRequest) => call<ShapeResponse>("POST", "/shape", req, 15_000),
  appliance: (req: ApplianceRequest) => call<ApplianceResponse>("POST", "/appliance", req, 60_000),
  health: () => call<HealthResponse>("GET", "/health", undefined, 8_000),
};
