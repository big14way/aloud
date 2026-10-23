import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";
import {
  ERROR_SPEECH,
  type ErrorKind,
  type ErrorResponse,
  type HealthResponse,
  SeeRequest,
  ShapeRequest,
  type ShapeResponse,
} from "../shared/api.js";
import { createContext, type Ctx, Meter } from "./context.js";
import { ModelError } from "./llm.js";
import { shapeEasy } from "./shape.js";
import { see } from "./vision.js";

// Stateless API: nothing here writes images or audio anywhere. Logs carry only
// route, status, timings, token cost and a short hash of the first frame.

function clientKey(c: Context): { session: string; ip: string } {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";
  const session = (c.req.header("x-aloud-session") ?? "").slice(0, 64) || "anon";
  return { session: `${ip}|${session}`, ip };
}

function fail(c: Context, kind: ErrorKind, status: 400 | 404 | 413 | 429 | 500 | 502 | 503, extra: Partial<ErrorResponse> = {}) {
  const body: ErrorResponse = { ok: false, error: kind, speech: [ERROR_SPEECH[kind]], ...extra };
  return c.json(body, status);
}

function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 10);
}

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), ...entry }));
}

export function createApp(ctx: Ctx = createContext()) {
  const app = new Hono().basePath("/api");
  app.use("*", bodyLimit({ maxSize: 4 * 1024 * 1024, onError: (c) => fail(c, "bad_request", 413, { detail: "body too large" }) }));

  /** Shared guard for routes that spend model tokens. */
  const guard = (c: Context): Response | null => {
    if (!ctx.cfg.nebiusApiKey) return fail(c, "not_configured", 503);
    const { session, ip } = clientKey(c);
    if (!ctx.sessions.allow(session) || !ctx.ips.allow(ip)) return fail(c, "session_limit", 429);
    if (ctx.spend.exhausted()) return fail(c, "budget", 429);
    return null;
  };

  const parse = async <T>(c: Context, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: Response }> => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return { ok: false, res: fail(c, "bad_request", 400, { detail: "invalid JSON body" }) };
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
      const detail = result.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return { ok: false, res: fail(c, "bad_request", 400, { detail }) };
    }
    return { ok: true, data: result.data };
  };

  const modelFailure = (c: Context, err: unknown, route: string) => {
    const e = err instanceof ModelError ? err : null;
    log({ route, error: e?.kind ?? "internal", message: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) });
    if (e?.kind === "rate_limited") return fail(c, "rate_limited", 429, { retry_after_s: e.retryAfterSec ?? 5 });
    if (e?.kind === "not_configured") return fail(c, "not_configured", 503);
    return fail(c, "model_error", 502);
  };

  app.get("/health", async (c) => {
    const fastlane = await ctx.fastlane.check();
    const configured = Boolean(ctx.cfg.nebiusApiKey);
    const body: HealthResponse = {
      ok: true,
      lanes: {
        vision: { model: ctx.cfg.models.vision, configured },
        fast: { model: ctx.cfg.models.fast, configured },
        steps: { model: ctx.cfg.models.steps, configured },
        judge: { model: ctx.cfg.models.judge, configured, enabled: ctx.cfg.adjudication },
        fastlane: { model: ctx.cfg.fastlane?.model ?? null, status: fastlane },
        tavily: { configured: Boolean(ctx.cfg.tavilyApiKey) },
      },
      budget: ctx.spend.snapshot(),
    };
    return c.json(body);
  });

  app.post("/see", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const parsed = await parse(c, SeeRequest);
    if (!parsed.ok) return parsed.res;
    const req = parsed.data;
    try {
      const res = await see(ctx, req);
      log({ route: "see", skill: req.skill, mode: req.mode, status: res.status, flags: res.flags, ms: res.metrics.total_ms, cost_usd: res.metrics.cost_usd, calls: res.metrics.calls.length, frame: shortHash(req.frames[0]!) });
      return c.json(res);
    } catch (err) {
      return modelFailure(c, err, "see");
    }
  });

  app.post("/shape", async (c) => {
    const blocked = guard(c);
    if (blocked) return blocked;
    const parsed = await parse(c, ShapeRequest);
    if (!parsed.ok) return parsed.res;
    const req = parsed.data;
    const meter = new Meter(ctx.spend);
    if (req.mode === "standard") {
      const body: ShapeResponse = { ok: true, speech: req.sentences, source: "unchanged", metrics: meter.summary() };
      return c.json(body);
    }
    const shaped = await shapeEasy(ctx, meter, req.sentences, req.keep ?? []);
    const body: ShapeResponse = { ok: true, speech: shaped.speech, source: shaped.source, metrics: meter.summary() };
    log({ route: "shape", source: shaped.source, ms: body.metrics.total_ms, cost_usd: body.metrics.cost_usd });
    return c.json(body);
  });

  app.notFound((c) => fail(c, "bad_request", 404, { detail: "unknown route" }));
  app.onError((err, c) => modelFailure(c, err, "unhandled"));

  return app;
}

export type App = ReturnType<typeof createApp>;
