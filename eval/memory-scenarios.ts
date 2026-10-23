import { type AnswerStatus, type MemEvent, type MemObject, answerFind, keepsStatus } from "../shared/memory.js";

// Scripted memory sequences with the answer status each must produce. These run
// without any model: they test the reducer and templates that decide what Aloud claims.

const H = 3_600_000;
const NOW = Date.parse("2026-10-29T12:00:00Z");

const obj = (id: string, label: string, aliases: string[] = []): MemObject => ({ id, label, aliases, description: "", thumbs: [], created_ts: 0 });

const keys = obj("k", "house keys", ["keys"]);
const carKeys = obj("c", "car keys", ["keys"]);
const wallet = obj("w", "wallet");

let n = 0;
function ev(object_id: string, kind: MemEvent["kind"], hoursAgo: number, extra: Partial<MemEvent> = {}): MemEvent {
  return { id: `e${n++}`, object_id, kind, location: "", place_id: null, ts: NOW - hoursAgo * H, source: "user_said", confidence: 1, identity_confidence: null, ...extra };
}

const placedSeen = (id: string, h: number, location: string, identity = 0.9) => ev(id, "placed", h, { location, identity_confidence: identity });

export interface Scenario {
  name: string;
  objects: MemObject[];
  events: MemEvent[];
  query: string;
  expect: AnswerStatus;
  /** Words the answer must contain. */
  mustSay?: string[];
}

export const SCENARIOS: Scenario[] = [
  { name: "Place, camera confirms, then find", objects: [wallet], events: [placedSeen("w", 2, "on the hall shelf")], query: "where is my wallet", expect: "confirmed", mustSay: ["on the hall shelf"] },
  {
    name: "Place, then picked up, then find",
    objects: [wallet],
    events: [placedSeen("w", 3, "on the hall shelf"), ev("w", "picked_up", 1)],
    query: "where's my wallet",
    expect: "last_confirmed_only",
    mustSay: ["picked up afterward"],
  },
  {
    name: "Place, moved silently, camera checks the place",
    objects: [wallet],
    events: [placedSeen("w", 3, "on the hall shelf"), ev("w", "missing", 1, { source: "vision", confidence: 0.85, location: "on the hall shelf" })],
    query: "wallet",
    expect: "last_confirmed_only",
    mustSay: ["didn't see it there"],
  },
  {
    name: "Place without a camera match stays unconfirmed",
    objects: [wallet],
    events: [placedSeen("w", 2, "in the drawer", 0.4)],
    query: "where is my wallet",
    expect: "unknown",
    mustSay: ["You told me", "couldn't see it to confirm"],
  },
  {
    name: "Weak sighting elsewhere does not move trusted state",
    objects: [wallet],
    events: [placedSeen("w", 3, "on the hall shelf"), ev("w", "seen", 1, { source: "vision", confidence: 0.55, identity_confidence: 0.6, location: "in the kitchen" })],
    query: "wallet",
    expect: "confirmed",
    mustSay: ["on the hall shelf", "I may have seen it in the kitchen", "not sure"],
  },
  {
    name: "Picked up, then placed again somewhere new",
    objects: [wallet],
    events: [placedSeen("w", 5, "on the hall shelf"), ev("w", "picked_up", 4), placedSeen("w", 1, "in the kitchen drawer")],
    query: "wallet",
    expect: "confirmed",
    mustSay: ["in the kitchen drawer"],
  },
  { name: "Two sets of keys", objects: [keys, carKeys], events: [], query: "where are my keys", expect: "ambiguous_object", mustSay: ["house keys", "car keys", "Which one"] },
  { name: "Specific set of keys", objects: [keys, carKeys], events: [placedSeen("c", 1, "by the door")], query: "where are my car keys", expect: "confirmed", mustSay: ["by the door"] },
  { name: "Object never learned", objects: [wallet], events: [], query: "where are my glasses", expect: "unknown", mustSay: ["haven't learned"] },
  {
    name: "Confident vision sighting is trusted",
    objects: [wallet],
    events: [ev("w", "seen", 1, { source: "vision", confidence: 0.9, identity_confidence: 0.85, location: "on the desk" })],
    query: "wallet",
    expect: "confirmed",
  },
  {
    name: "Vision sighting with weak identity is not trusted",
    objects: [wallet],
    events: [ev("w", "seen", 1, { source: "vision", confidence: 0.9, identity_confidence: 0.65, location: "on the desk" })],
    query: "wallet",
    expect: "unknown",
    mustSay: ["I may have seen it on the desk"],
  },
  {
    name: "Low-confidence 'missing' does not overturn a confirmed place",
    objects: [wallet],
    events: [placedSeen("w", 3, "on the hall shelf"), ev("w", "missing", 1, { source: "vision", confidence: 0.5, location: "on the hall shelf" })],
    query: "wallet",
    expect: "confirmed",
  },
];

export interface ScenarioResult {
  name: string;
  expected: AnswerStatus;
  got: AnswerStatus;
  speech: string;
  pass: boolean;
}

export function runScenarios(): ScenarioResult[] {
  return SCENARIOS.map((s) => {
    const a = answerFind(s.query, s.objects, s.events, NOW, { timeZone: "UTC" });
    const said = (s.mustSay ?? []).every((w) => a.speech.includes(w));
    return { name: s.name, expected: s.expect, got: a.answer_status, speech: a.speech, pass: a.answer_status === s.expect && said && keepsStatus(a.speech, a.answer_status) };
  });
}
