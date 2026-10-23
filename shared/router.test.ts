import { describe, expect, it } from "vitest";
import { REFUSALS } from "./safety.js";
import { routeByRules, validateRoute } from "./router.js";

describe("routeByRules", () => {
  it.each([
    ["what's in front of me", "describe", {}],
    ["Read this", "read", {}],
    ["what is this", "what_is", {}],
    ["where are my keys?", "find", { object: "keys" }],
    ["Where did I put my car keys", "find", { object: "car keys" }],
    ["I'm putting my keys on the hall shelf", "remember_placement", { object: "keys", location: "on the hall shelf" }],
    ["I took my wallet", "picked_up", { object: "wallet" }],
    ["remember this as my house keys", "enrol_object", { label: "house keys" }],
    ["help me use this microwave", "appliance_help", { task: "use this microwave" }],
    ["how do I defrost bread", "appliance_help", { task: "defrost bread" }],
    ["help me tidy my room", "plan_task", { goal: "tidy my room" }],
    ["say that again", "repeat", {}],
    ["stop", "stop", {}],
    ["look harder", "look_harder", {}],
    ["what can you do", "help", {}],
  ])("%s -> %s", (utterance, skill, args) => {
    const d = routeByRules(utterance, ["keys", "wallet"]);
    expect(d.skill).toBe(skill);
    expect(d.args).toEqual(args);
    expect(d.outcome).toBe("success");
  });

  it("refuses unsafe requests before anything else", () => {
    const d = routeByRules("is it safe to cross now?");
    expect(d).toEqual({ outcome: "fatal", skill: "refuse", args: {}, speech: [REFUSALS.traffic] });
  });

  it("teaches the valid options when it doesn't understand", () => {
    const d = routeByRules("blorp");
    expect(d.outcome).toBe("fixable");
    expect(d.speech[0]).toContain("read this");
  });
});

describe("validateRoute", () => {
  it("asks which object, listing what it knows", () => {
    expect(validateRoute("find", {}, ["keys", "wallet"]).speech).toEqual(["Which object should I look for? I know: keys, wallet."]);
  });
  it("asks where, when a placement has no location", () => {
    const d = validateRoute("remember_placement", { object: "keys" });
    expect(d.outcome).toBe("fixable");
    expect(d.speech[0]).toBe("Where are you putting your keys? For example: on the hall shelf.");
  });
  it("trims and drops empty arguments", () => {
    expect(validateRoute("find", { object: "  keys. ", location: "" }).args).toEqual({ object: "keys" });
  });
});
