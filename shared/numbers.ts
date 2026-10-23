import type { VisionItem } from "./schemas.js";

// Numbers (prices, amounts, phone numbers, dates, banknotes) are spoken as certain
// only when two frames taken ~400 ms apart give the same normalised value.

const CURRENCY = "$€£₦¥₹";
const TOKEN_RE = new RegExp(`[${CURRENCY}]?\\s?\\d(?:[\\d.,:/\\-]*\\d)?%?`, "g");
const PLAIN_DECIMAL_RE = /^\d+(\.\d+)?$/;
const THOUSANDS_RE = /^\d{1,3}(,\d{3})+(\.\d+)?$/;

/** Canonical form of one numeric token, e.g. "$1,250.50" -> "$1250.5", "555-1234" -> "5551234". */
export function canonicalNumber(token: string): string {
  const compact = token.replace(/\s+/g, "");
  const first = compact[0];
  const currency = first !== undefined && CURRENCY.includes(first) ? first : "";
  const percent = compact.endsWith("%") ? "%" : "";
  let body = compact.slice(currency ? 1 : 0, percent ? -1 : undefined);
  if (THOUSANDS_RE.test(body)) body = body.replace(/,/g, "");
  if (PLAIN_DECIMAL_RE.test(body)) return `${currency}${String(Number(body))}${percent}`;
  return `${currency}${body.replace(/[^\d]/g, "")}${percent}`;
}

export function numericTokens(text: string): string[] {
  return (text.match(TOKEN_RE) ?? []).map(canonicalNumber);
}

export function hasNumber(item: VisionItem): boolean {
  return item.kind === "number" || item.number_kind !== "none" || /\d/.test(item.content);
}

export interface FrameComparison {
  /** Indices into frame A whose numbers all appear in frame B. */
  agreed: number[];
  /** Indices into frame A with at least one number frame B did not confirm. */
  disputed: number[];
}

/**
 * Compare number-bearing items in frame A against all numbers seen in frame B.
 * Line splits can differ between frames, so B is pooled into one multiset.
 */
export function compareFrames(a: VisionItem[], b: VisionItem[]): FrameComparison {
  const pool = new Map<string, number>();
  for (const item of b) {
    for (const t of numericTokens(item.content)) pool.set(t, (pool.get(t) ?? 0) + 1);
  }
  const agreed: number[] = [];
  const disputed: number[] = [];
  a.forEach((item, index) => {
    if (!hasNumber(item)) return;
    const tokens = numericTokens(item.content);
    if (tokens.length === 0) {
      disputed.push(index);
      return;
    }
    const taken = new Map<string, number>();
    const ok = tokens.every((t) => {
      const used = taken.get(t) ?? 0;
      if ((pool.get(t) ?? 0) > used) {
        taken.set(t, used + 1);
        return true;
      }
      return false;
    });
    if (ok) {
      for (const [t, n] of taken) pool.set(t, (pool.get(t) ?? 0) - n);
      agreed.push(index);
    } else {
      disputed.push(index);
    }
  });
  return { agreed, disputed };
}

/** True when every number in `reading` appears in at least one of the two frame readings. */
export function readingIsGrounded(reading: string, frameA: string, frameB: string): boolean {
  const tokens = numericTokens(reading);
  if (tokens.length === 0) return false;
  const seen = new Set([...numericTokens(frameA), ...numericTokens(frameB)]);
  return tokens.every((t) => seen.has(t));
}
