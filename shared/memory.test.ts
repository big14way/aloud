import { describe, expect, it } from "vitest";
import {
  answerFind,
  deriveState,
  findQuery,
  isPlural,
  isTrusted,
  keepsStatus,
  locationPhrase,
  matchObjects,
  parsePlacement,
  whenPhrase,
  type MemEvent,
  type MemObject,
} from "./memory.js";

const TZ = { timeZone: "UTC" };
const T = (iso: string) => Date.parse(iso);
const NOW = T("2026-10-29T12:00:00Z");

const keys: MemObject = { id: "k", label: "house keys", aliases: ["keys"], description: "brass ring, red tag", thumbs: [], created_ts: 0 };
const carKeys: MemObject = { id: "c", label: "car keys", aliases: ["keys"], description: "black fob", thumbs: [], created_ts: 0 };
const wallet: MemObject = { id: "w", label: "wallet", aliases: [], description: "brown leather", thumbs: [], created_ts: 0 };

let n = 0;
function ev(p: Partial<MemEvent> & Pick<MemEvent, "kind" | "ts">): MemEvent {
  return { id: `e${n++}`, object_id: "w", location: "", place_id: null, source: "user_said", confidence: 1, identity_confidence: null, ...p };
}

describe("promotion policy", () => {
  it("trusts the user's placement only when vision matched the object", () => {
    expect(isTrusted(ev({ kind: "placed", ts: 0, identity_confidence: 0.85 }))).toBe(true);
    expect(isTrusted(ev({ kind: "placed", ts: 0, identity_confidence: 0.5 }))).toBe(false);
    expect(isTrusted(ev({ kind: "placed", ts: 0, identity_confidence: null }))).toBe(false);
  });
  it("needs both identity and event confidence for a vision sighting", () => {
    expect(isTrusted(ev({ kind: "seen", ts: 0, source: "vision", confidence: 0.9, identity_confidence: 0.9 }))).toBe(true);
    expect(isTrusted(ev({ kind: "seen", ts: 0, source: "vision", confidence: 0.6, identity_confidence: 0.9 }))).toBe(false);
  });
});

describe("answerFind", () => {
  const placed = ev({ kind: "placed", ts: T("2026-10-29T10:42:00Z"), location: "on the hall shelf", identity_confidence: 0.9 });

  it("confirmed: gives the place and the time", () => {
    const a = answerFind("where is my wallet", [wallet], [placed], NOW, TZ);
    expect(a.answer_status).toBe("confirmed");
    expect(a.speech).toBe("Your wallet: on the hall shelf, confirmed today at 10:42.");
  });

  it("last_confirmed_only: keeps both halves when it was picked up", () => {
    const picked = ev({ kind: "picked_up", ts: T("2026-10-29T11:00:00Z") });
    const a = answerFind("wallet", [wallet], [placed, picked], NOW, TZ);
    expect(a.answer_status).toBe("last_confirmed_only");
    expect(a.speech).toBe("I last confirmed your wallet on the hall shelf today at 10:42, but it was picked up afterward. I haven't confirmed it anywhere since.");
    expect(keepsStatus(a.speech, a.answer_status)).toBe(true);
  });

  it("last_confirmed_only: when the camera checked the place and it was gone", () => {
    const missing = ev({ kind: "missing", ts: T("2026-10-29T11:30:00Z"), source: "vision", confidence: 0.85 });
    const a = answerFind("wallet", [wallet], [placed, missing], NOW, TZ);
    expect(a.speech).toBe("I last confirmed your wallet on the hall shelf today at 10:42, but I didn't see it there today at 11:30. I haven't confirmed it anywhere since.");
  });

  it("a weak sighting elsewhere does not change trusted state, but is mentioned honestly", () => {
    const weak = ev({ kind: "seen", ts: T("2026-10-29T11:15:00Z"), source: "vision", confidence: 0.55, identity_confidence: 0.6, location: "in the kitchen" });
    const a = answerFind("wallet", [wallet], [placed, weak], NOW, TZ);
    expect(a.answer_status).toBe("confirmed");
    expect(a.speech).toBe("Your wallet: on the hall shelf, confirmed today at 10:42. I may have seen it in the kitchen today at 11:15, but I'm not sure.");
  });

  it("unknown: an unconfirmed placement is reported as the user's words, not as fact", () => {
    const said = ev({ kind: "placed", ts: T("2026-10-28T09:05:00Z"), location: "in the drawer", identity_confidence: 0.4 });
    const a = answerFind("wallet", [wallet], [said], NOW, TZ);
    expect(a.answer_status).toBe("unknown");
    expect(a.speech).toBe("I don't have a confirmed place for your wallet. You told me it was in the drawer yesterday at 09:05, but I couldn't see it to confirm.");
  });

  it("unknown: an object that was never enrolled", () => {
    const a = answerFind("my glasses", [wallet], [], NOW, TZ);
    expect(a.answer_status).toBe("unknown");
    expect(a.speech).toContain("I don't have a confirmed place for your glasses. I haven't learned them yet.");
  });

  it("ambiguous_object: asks which one", () => {
    const a = answerFind("where are my keys", [keys, carKeys, wallet], [], NOW, TZ);
    expect(a.answer_status).toBe("ambiguous_object");
    expect(a.speech).toBe('I know two that match "keys": house keys and car keys. Which one?');
  });

  it("a later trusted placement replaces the old one", () => {
    const moved = ev({ kind: "placed", ts: T("2026-10-29T11:40:00Z"), location: "in the kitchen drawer", identity_confidence: 0.8 });
    const picked = ev({ kind: "picked_up", ts: T("2026-10-29T11:00:00Z") });
    const a = answerFind("wallet", [wallet], [placed, picked, moved], NOW, TZ);
    expect(a.speech).toBe("Your wallet: in the kitchen drawer, confirmed today at 11:40.");
  });

  it("spoken status words are checked", () => {
    expect(keepsStatus("Your wallet is on the shelf.", "confirmed")).toBe(false);
    expect(keepsStatus("I last confirmed it there. I haven’t confirmed it since.", "last_confirmed_only")).toBe(true);
  });
});

describe("matching and parsing", () => {
  it("strips question words from find queries", () => {
    expect(findQuery("Where did I put my car keys?")).toBe("car keys");
    expect(findQuery("have you seen the wallet")).toBe("wallet");
    expect(findQuery("where's my wallet?")).toBe("wallet");
    expect(findQuery("Where’re my keys")).toBe("keys");
  });
  it("matches labels, aliases and plurals", () => {
    expect(matchObjects("house key", [keys, carKeys]).map((o) => o.id)).toEqual(["k"]);
    expect(matchObjects("my car keys", [keys, carKeys]).map((o) => o.id)).toEqual(["c"]);
    expect(matchObjects("the wallet", [keys, wallet]).map((o) => o.id)).toEqual(["w"]);
  });
  it("parses placements", () => {
    expect(parsePlacement("I'm putting my keys on the hall shelf")).toEqual({ object: "keys", location: "on the hall shelf" });
    expect(parsePlacement("I left my wallet in the car.")).toEqual({ object: "wallet", location: "in the car" });
    expect(parsePlacement("put the remote down next to the TV")).toEqual({ object: "remote", location: "next to the TV" });
    expect(parsePlacement("where did I put my keys")).toBeNull();
  });
  it("builds location phrases", () => {
    expect(locationPhrase("on", "shelf", "hall")).toBe("on the shelf in the hall");
    expect(locationPhrase("in", "top drawer", "")).toBe("in the top drawer");
    expect(locationPhrase("none", "", "kitchen")).toBe("in the kitchen");
  });
  it("knows plural object names", () => {
    expect(isPlural("house keys")).toBe(true);
    expect(isPlural("glasses")).toBe(true);
    expect(isPlural("wallet")).toBe(false);
    expect(isPlural("bus pass")).toBe(false);
  });
});

describe("whenPhrase", () => {
  it("uses today, yesterday, weekday, then date", () => {
    expect(whenPhrase(T("2026-10-29T10:42:00Z"), NOW, TZ)).toBe("today at 10:42");
    expect(whenPhrase(T("2026-10-28T23:59:00Z"), NOW, TZ)).toBe("yesterday at 23:59");
    expect(whenPhrase(T("2026-10-26T08:00:00Z"), NOW, TZ)).toBe("on Monday at 08:00");
    expect(whenPhrase(T("2026-10-12T07:00:00Z"), NOW, TZ)).toBe("on 12 October at 07:00");
  });
});

describe("deriveState", () => {
  it("is unknown with no events", () => {
    expect(deriveState("w", []).status).toBe("unknown");
  });
});
