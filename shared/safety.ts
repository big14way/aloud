// Forbidden claims. These checks run in code on every utterance and every model
// output, in addition to the system prompt. The prompt asks; the code enforces.

export type RefusalKind = "traffic" | "dosing" | "identify_person";

export const REFUSALS: Record<RefusalKind, string> = {
  traffic: "I can't judge traffic safety. Please rely on your cane, dog, or a crossing signal.",
  dosing:
    "I can't give dosing or medical advice. I can read the label word for word. Please confirm with a pharmacist.",
  identify_person: "I don't identify people or guess how they feel. I can tell you where a person is.",
};

export const PHARMACIST_NOTE = "Please confirm with a pharmacist.";

const TRAFFIC_INTENT = [
  /\b(safe|ok|okay|clear|fine)\b[^.?!]*\b(cross|crossing)\b/i,
  /\b(cross|crossing)\b[^.?!]*\b(safe|ok|okay|clear)\b/i,
  /\b(can|should|may)\s+i\s+(cross|go now|walk now|go across)\b/i,
  /\bis\s+(the\s+)?(road|street|traffic|way)\s+(clear|safe|empty)\b/i,
  /\b(any|are there)\s+(cars|traffic|vehicles)\s+coming\b/i,
  /\b(is|are|has)\s+(the\s+)?(traffic\s+|pedestrian\s+|crossing\s+|walk\s+)?(light|lights|signal|signals|sign|man)\s+(gone\s+|turned\s+|changed\s+)?(green|red|amber|on|lit|showing|changed)\b/i,
  /\bwhat\s+colou?r\s+is\s+(the\s+)?(traffic\s+|pedestrian\s+|crossing\s+)?(light|signal)\b/i,
];

const DOSING_INTENT = [
  /\bhow\s+(many|much)\b[^.?!]*\b(take|pills?|tablets?|capsules?|dose|doses|ml|mg|drops|spoons?)\b/i,
  /\bdos(e|es|age|ing)\b/i,
  /\b(can|should|may)\s+i\s+(take|give|use)\b[^.?!]*\b(pills?|tablets?|capsules?|medicine|medication|drug|this)\b/i,
  /\bis\s+(it|this)\s+safe\s+to\s+(take|swallow|drink|use)\b/i,
];

// "Who is this letter from?" is a reading question, not identification.
const NOT_A_PERSON = String.raw`(?!\s+(letter|parcel|package|card|note|message|bill|mail|envelope|email|from|for|addressed|written|signed|sent)\b)`;

const IDENTIFY_INTENT = [
  new RegExp(String.raw`\bwho\s+(is|are)\s+(this|that|he|she|they)\b${NOT_A_PERSON}`, "i"),
  new RegExp(String.raw`\bwho'?s\s+(this|that)\b${NOT_A_PERSON}`, "i"),
  /\bwho(\s+is|'s|\s+are)\s+(in|at|by|near|standing|sitting|there)\b/i,
  /\b(recogni[sz]e|identify)\s+(this\s+|that\s+)?(person|face|man|woman|him|her|them|people)\b/i,
  /\bhow\s+old\s+(is|are)\b/i,
  /\b(is|are|does|do)\s+(he|she|they|the\s+(person|man|woman))\s+(look\s+)?(happy|sad|angry|upset|sick|ill|pregnant|drunk|tired|scared)\b/i,
  /\bwhat\s+(mood|race|ethnicity|age|gender)\b/i,
  /\bwhat\s+is\s+(his|her|their)\s+(name|mood|age|race|ethnicity)\b/i,
];

/** Classify a spoken or typed request that Aloud must refuse without calling a model. */
export function checkUtterance(text: string): RefusalKind | null {
  if (TRAFFIC_INTENT.some((re) => re.test(text))) return "traffic";
  if (DOSING_INTENT.some((re) => re.test(text))) return "dosing";
  if (IDENTIFY_INTENT.some((re) => re.test(text))) return "identify_person";
  return null;
}

const PERSON_WORD =
  /\b(man|men|woman|women|person|people|boy|boys|girl|girls|child|children|kid|kids|baby|babies|toddler|guy|guys|lady|ladies|gentleman|someone|somebody|he|she|him|her|his|hers|face|faces|pedestrian|pedestrians|crowd)\b/i;

const NAMED_PERSON =
  /\b(named|called|looks like|resembles|is probably|appears to be|photo of|picture of|poster of|portrait of|face of)\s+[A-Z][a-z]+/;

/** True when a description mentions a person, so it must be rendered from the person template. */
export function mentionsPerson(content: string): boolean {
  return PERSON_WORD.test(content) || NAMED_PERSON.test(content);
}

const TRAFFIC_CLAIM = [
  /\b(safe|clear|okay|ok|fine)\s+to\s+(cross|walk|go)\b/i,
  /\b(no|zero)\s+(cars|traffic|vehicles)\b/i,
  /\btraffic\s+(is|has)\s+(clear|light|stopped|cleared)\b/i,
  /\b(road|street)\s+is\s+(clear|empty|safe)\b/i,
  /\byou\s+can\s+(cross|go|walk)\b/i,
  // A signal's colour or state is as good as a crossing judgement to someone who can't check it.
  /\b(traffic|pedestrian|crossing|walk)\s+(light|signal)s?\b[^.]*\b(green|red|amber|yellow|walk|go|stop|lit)\b/i,
  /\b(green|red|amber)\s+(light|man|signal|figure)\b/i,
  /\b(light|signal)\s+(is|shows|turns?|turned)\s+(green|red|amber|yellow)\b/i,
];

/** True when model text makes a traffic-safety judgement Aloud must never make. */
export function makesTrafficClaim(content: string): boolean {
  return TRAFFIC_CLAIM.some((re) => re.test(content));
}

const MEDICINE =
  /(\b\d+(\.\d+)?\s?(mg|mcg|µg|ml|iu)\b|\b(tablets?|capsules?|caplets?|dosage|doses?|prescription|rx|pharmac\w*|paracetamol|ibuprofen|acetaminophen|aspirin|antibiotics?|syrup|ointment|inhaler|insulin|suppositor\w*|lozenges?)\b)/i;

/** True when text looks like a medicine label or dosing instructions. */
export function looksLikeMedicine(content: string): boolean {
  return MEDICINE.test(content);
}

const DOSING_ADVICE = [
  /\byou\s+(should|can|may|must)\s+take\b/i,
  /\btake\s+(one|two|three|\d+)\b[^.]*\b(now|today|every|twice|daily)\b/i,
  /\b(it\s+is|it's)\s+safe\s+to\s+(take|use)\b/i,
];

/** True when model text gives dosing advice instead of reading verbatim. */
export function givesDosingAdvice(content: string): boolean {
  return DOSING_ADVICE.some((re) => re.test(content));
}
