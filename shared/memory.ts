import { THRESHOLDS } from "./config.js";

// Device-only object memory. Events are append-only; trusted state is derived by a
// deterministic reducer. A model can propose an observation, but only this code
// decides whether it changes what Aloud will claim. Spoken answers come from fixed
// templates and always carry their status words.

export interface MemObject {
  id: string;
  label: string;
  aliases: string[];
  description: string;
  /** Up to three small JPEG data URLs, kept on the device only. */
  thumbs: string[];
  created_ts: number;
}

export interface MemPlace {
  id: string;
  name: string;
  thumb?: string;
  created_ts: number;
}

export type EventKind = "placed" | "seen" | "picked_up" | "missing";
export type EventSource = "user_said" | "vision";

export interface MemEvent {
  id: string;
  object_id: string;
  kind: EventKind;
  /** Human phrase for where, e.g. "on the hall shelf". Empty for picked_up. */
  location: string;
  place_id: string | null;
  ts: number;
  source: EventSource;
  /** Confidence that the event happened (vision) or 1 for the user's own words. */
  confidence: number;
  /** Vision match of the object against its enrolment thumbnails, when checked. */
  identity_confidence: number | null;
}

export type AnswerStatus = "confirmed" | "last_confirmed_only" | "unknown" | "ambiguous_object";

export interface FindAnswer {
  answer_status: AnswerStatus;
  speech: string;
  object_ids: string[];
}

/** MEMO-style promotion policy: weak perception never becomes trusted state. */
export function isTrusted(ev: MemEvent): boolean {
  const id = ev.identity_confidence ?? 0;
  switch (ev.kind) {
    case "placed":
      if (ev.source === "user_said") return id >= THRESHOLDS.trust;
      return id >= THRESHOLDS.trust && ev.confidence >= THRESHOLDS.trust;
    case "seen":
      return ev.source === "vision" && id >= THRESHOLDS.trust && ev.confidence >= THRESHOLDS.trust;
    case "picked_up":
      // The user saying they took it is enough to stop claiming the old place.
      return ev.source === "user_said" || ev.confidence >= THRESHOLDS.trust;
    case "missing":
      return ev.source === "vision" && ev.confidence >= THRESHOLDS.trust;
  }
}

export interface ObjectState {
  status: "confirmed_at_location" | "moved_since" | "unknown";
  /** Last trusted placement or sighting. */
  last: MemEvent | null;
  /** First trusted event after `last` that invalidated it. */
  invalidatedBy: MemEvent | null;
  /** Most recent untrusted sighting after `last`, if any. */
  weakSighting: MemEvent | null;
}

export function deriveState(objectId: string, events: MemEvent[]): ObjectState {
  const mine = events.filter((e) => e.object_id === objectId).sort((a, b) => a.ts - b.ts);
  let last: MemEvent | null = null;
  let invalidatedBy: MemEvent | null = null;
  let weakSighting: MemEvent | null = null;
  for (const ev of mine) {
    const trusted = isTrusted(ev);
    if ((ev.kind === "placed" || ev.kind === "seen") && trusted) {
      last = ev;
      invalidatedBy = null;
      weakSighting = null;
    } else if ((ev.kind === "picked_up" || ev.kind === "missing") && trusted) {
      if (last && !invalidatedBy) invalidatedBy = ev;
    } else if ((ev.kind === "placed" || ev.kind === "seen") && ev.location) {
      weakSighting = ev;
    }
  }
  const status = !last ? "unknown" : invalidatedBy ? "moved_since" : "confirmed_at_location";
  return { status, last, invalidatedBy, weakSighting };
}

const PLURAL_WORDS = new Set(["glasses", "sunglasses", "scissors", "headphones", "earbuds", "earphones", "keys", "pants", "trousers", "jeans", "gloves", "shoes", "socks", "tweezers", "pliers"]);

export function isPlural(label: string): boolean {
  const last = label.trim().toLowerCase().split(/\s+/).pop() ?? "";
  if (PLURAL_WORDS.has(last)) return true;
  return last.endsWith("s") && !last.endsWith("ss") && !last.endsWith("us") && !last.endsWith("is");
}

export interface TimeOptions {
  /** IANA time zone; defaults to the device's. */
  timeZone?: string;
}

function dayKey(ts: number, tz?: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ts);
}

/** "today at 10:42", "yesterday at 09:05", "on Monday at 18:30", "on 12 October at 07:00". */
export function whenPhrase(ts: number, now: number, opts: TimeOptions = {}): string {
  const tz = opts.timeZone;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(ts);
  const day = dayKey(ts, tz);
  if (day === dayKey(now, tz)) return `today at ${time}`;
  if (day === dayKey(now - 86_400_000, tz)) return `yesterday at ${time}`;
  if (now - ts < 6 * 86_400_000 && ts < now) {
    const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(ts);
    return `on ${weekday} at ${time}`;
  }
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "long" }).format(ts);
  return `on ${date} at ${time}`;
}

const FIND_FILLER =
  /\b(where|is|are|was|were|did|do|i|put|leave|left|find|look|looking|for|have|you|seen|can|could|help|me|locate|please|again|now|go|went)\b/g;

/** "where are my keys" -> "keys". Only for queries; labels keep every word. */
export function findQuery(utterance: string): string {
  return normalizeName(utterance).replace(FIND_FILLER, " ").replace(/\s+/g, " ").trim();
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’](s|re|ve|ll|d|m)\b/g, "")
    .replace(/\b(my|the|a|an|our|his|her|their)\b/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singular(word: string): string {
  if (PLURAL_WORDS.has(word) && word !== "keys") return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("es") && /(ch|sh|x|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function tokens(s: string): string[] {
  return normalizeName(s).split(" ").filter(Boolean).map(singular);
}

/**
 * Match a spoken object reference ("my keys", "car keys", "the wallet") against
 * enrolled objects. An exact label or alias wins; otherwise every query word must
 * appear in a candidate's label, alias or description head.
 */
export function matchObjects(query: string, objects: MemObject[]): MemObject[] {
  const q = tokens(query);
  if (q.length === 0) return [];
  const names = (o: MemObject) => [o.label, ...o.aliases];
  const exact = objects.filter((o) => names(o).some((n) => tokens(n).join(" ") === q.join(" ")));
  if (exact.length > 0) return exact;
  return objects.filter((o) => names(o).some((n) => {
    const t = new Set(tokens(n));
    return q.every((w) => t.has(w));
  }));
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function listAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Words that must survive any rewording of a find answer, per status. */
export const STATUS_TOKENS: Record<AnswerStatus, string[]> = {
  confirmed: ["confirmed"],
  last_confirmed_only: ["last confirmed", "haven't confirmed"],
  unknown: ["don't have a confirmed"],
  ambiguous_object: ["which one"],
};

export function keepsStatus(text: string, status: AnswerStatus): boolean {
  const t = text.toLowerCase().replace(/’/g, "'");
  return STATUS_TOKENS[status].every((tok) => t.includes(tok));
}

/** Answer "where is X" from local memory only. Works offline. */
export function answerFind(query: string, objects: MemObject[], events: MemEvent[], now: number, opts: TimeOptions = {}): FindAnswer {
  const asked = findQuery(query) || "that";
  const matches = matchObjects(asked, objects);
  if (matches.length > 1) {
    const n = NUMBER_WORDS[matches.length] ?? String(matches.length);
    return {
      answer_status: "ambiguous_object",
      speech: `I know ${n} that match "${asked}": ${listAnd(matches.map((m) => m.label))}. Which one?`,
      object_ids: matches.map((m) => m.id),
    };
  }
  const obj = matches[0];
  if (!obj) {
    const it = isPlural(asked) ? "them" : "it";
    return {
      answer_status: "unknown",
      speech: `I don't have a confirmed place for your ${asked}. I haven't learned ${it} yet. Point the camera at ${it} and say "remember this as my ${asked}".`,
      object_ids: [],
    };
  }
  const plural = isPlural(obj.label);
  const them = plural ? "them" : "it";
  const they = plural ? "they were" : "it was";
  const state = deriveState(obj.id, events);
  const weak = (ev: MemEvent) =>
    ev.source === "user_said"
      ? ` You told me ${they} ${ev.location} ${whenPhrase(ev.ts, now, opts)}, but I couldn't see ${them} to confirm.`
      : ` I may have seen ${them} ${ev.location} ${whenPhrase(ev.ts, now, opts)}, but I'm not sure.`;
  if (!state.last) {
    let speech = `I don't have a confirmed place for your ${obj.label}.`;
    speech += state.weakSighting ? weak(state.weakSighting) : ` Point the camera around and press Find to look for ${them}.`;
    return { answer_status: "unknown", speech, object_ids: [obj.id] };
  }
  const where = state.last.location || "where you last showed me";
  const when = whenPhrase(state.last.ts, now, opts);
  if (state.status === "moved_since" && state.invalidatedBy) {
    const inv = state.invalidatedBy;
    const reason =
      inv.kind === "picked_up"
        ? `but ${they} picked up afterward`
        : `but I didn't see ${them} there ${whenPhrase(inv.ts, now, opts)}`;
    return {
      answer_status: "last_confirmed_only",
      speech: `I last confirmed your ${obj.label} ${where} ${when}, ${reason}. I haven't confirmed ${them} anywhere since.`,
      object_ids: [obj.id],
    };
  }
  let speech = `Your ${obj.label}: ${where}, confirmed ${when}.`;
  if (state.weakSighting) speech += weak(state.weakSighting);
  return { answer_status: "confirmed", speech, object_ids: [obj.id] };
}

const PREPOSITIONS = ["next to", "on top of", "underneath", "under", "behind", "beside", "inside", "on", "in", "at", "by"];

/**
 * Offline fallback for "I'm putting my keys on the hall shelf".
 * Returns null when the sentence does not look like a placement.
 */
export function parsePlacement(utterance: string): { object: string; location: string } | null {
  const text = utterance.trim().replace(/[.!?]+$/, "");
  const verb = /\b(?:i'?m|i am|i'll|i will|i've|i have|just)?\s*(?:putting|put|placing|placed|leaving|leave|left|setting|dropping|dropped|hanging|hung|keeping|storing|stored)\s+(?:down\s+)?(.+)$/i.exec(text);
  // "My keys are on the kitchen counter now" states a placement too.
  const stated = /^(?:my |the |our )?([\p{L} ]+?)\s+(?:is|are)\s+(?:now\s+)?((?:on|in|under|next to|behind|beside|inside|by|at)\s.+?)(?:\s+now)?$/iu.exec(text);
  if (!verb?.[1] && stated?.[1] && stated[2] && !/^(where|what|which|who|how|is|are)\b/i.test(stated[1])) {
    return { object: stated[1].trim(), location: stated[2].trim() };
  }
  if (!verb?.[1]) return null;
  const rest = verb[1];
  const lower = rest.toLowerCase();
  let best: { index: number; prep: string } | null = null;
  for (const prep of PREPOSITIONS) {
    const re = new RegExp(`\\s${prep}\\s`, "i");
    const m = re.exec(` ${lower} `);
    if (m && (best === null || m.index < best.index)) best = { index: m.index, prep };
  }
  if (!best) return null;
  const object = rest.slice(0, best.index).replace(/\b(my|the|our)\b\s*/gi, "").trim().replace(/\s+down$/i, "");
  const location = rest.slice(best.index).trim();
  if (!object || !location) return null;
  return { object, location };
}

/** "on hall shelf" -> "on the hall shelf" unless it already has a determiner. */
export function locationPhrase(preposition: string, surface: string, place: string): string {
  const det = (s: string) => (/^(the|my|a|an|your|our)\s/i.test(s) ? s : `the ${s}`);
  const parts: string[] = [];
  const prep = preposition === "none" ? "" : preposition;
  if (surface) parts.push(`${prep || "on"} ${det(surface)}`);
  if (place) parts.push(`${surface ? "in" : prep || "in"} ${det(place)}`);
  return parts.join(" ").trim();
}
