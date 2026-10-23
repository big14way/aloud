import { describe, expect, it } from "vitest";
import { checkUtterance, looksLikeMedicine, makesTrafficClaim, mentionsPerson } from "./safety.js";

describe("checkUtterance", () => {
  it.each([
    "Is it safe to cross?",
    "can I cross now",
    "Is the road clear?",
    "are there cars coming",
    "is the light green",
    "has the signal turned green?",
    "what colour is the traffic light",
  ])("refuses traffic judgement: %s", (u) => expect(checkUtterance(u)).toBe("traffic"));

  it.each([
    "How many pills should I take?",
    "what's the dosage",
    "Can I take this medicine with food?",
    "is it safe to take two",
  ])("refuses dosing advice: %s", (u) => expect(checkUtterance(u)).toBe("dosing"));

  it.each([
    "Who is this?",
    "who's that",
    "Who is at the door?",
    "recognize this person",
    "how old is she",
    "is he angry",
    "what race is that",
  ])("refuses identifying people: %s", (u) => expect(checkUtterance(u)).toBe("identify_person"));

  it.each([
    "Who is this letter from?",
    "read this",
    "what's in front of me",
    "where are my keys",
    "help me use this microwave",
    "what is this",
  ])("allows ordinary requests: %s", (u) => expect(checkUtterance(u)).toBeNull());
});

describe("output checks", () => {
  it("spots people in descriptions", () => {
    expect(mentionsPerson("a woman smiling by the window")).toBe(true);
    expect(mentionsPerson("a poster of Elvis")).toBe(true);
    expect(mentionsPerson("a red mug")).toBe(false);
  });
  it("spots traffic-safety claims", () => {
    expect(makesTrafficClaim("The road is clear")).toBe(true);
    expect(makesTrafficClaim("It looks safe to cross")).toBe(true);
    expect(makesTrafficClaim("a pedestrian crossing ahead")).toBe(false);
    expect(makesTrafficClaim("a traffic light showing green")).toBe(true);
    expect(makesTrafficClaim("The light is green")).toBe(true);
    expect(makesTrafficClaim("a red man on the signal")).toBe(true);
    expect(makesTrafficClaim("a traffic light at 2 o'clock")).toBe(false);
    expect(makesTrafficClaim("a traffic light on the corner")).toBe(false);
  });
  it("spots medicine labels", () => {
    expect(looksLikeMedicine("Paracetamol 500 mg tablets")).toBe(true);
    expect(looksLikeMedicine("Take 2 capsules")).toBe(true);
    expect(looksLikeMedicine("Oat milk 1 litre")).toBe(false);
  });
});
