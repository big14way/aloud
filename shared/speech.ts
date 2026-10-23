// Sentence-chunked speech: text arrives in pieces; only complete sentences are
// released for speaking. Duplicate and punctuation-only segments are skipped, and
// the remainder is flushed at the end.

const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "st", "no", "vs", "etc", "e.g", "i.e", "approx", "dept", "ave", "rd"]);

function isAbbreviation(before: string): boolean {
  const word = before.split(/\s+/).pop()?.toLowerCase().replace(/^[("']+/, "") ?? "";
  return ABBREVIATIONS.has(word) || /^[a-z]$/i.test(word);
}

export function hasSpeakableText(s: string): boolean {
  return /[\p{L}\p{N}]/u.test(s);
}

function key(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export class SentenceChunker {
  private buffer = "";
  private lastKey = "";

  /** Add text; returns any sentences that are now complete. */
  push(text: string): string[] {
    this.buffer += text;
    const out: string[] = [];
    let start = 0;
    const re = /[.!?…]+["')\]]*(?=\s)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.buffer)) !== null) {
      const end = m.index + m[0].length;
      const candidate = this.buffer.slice(start, end);
      if (m[0].startsWith(".") && isAbbreviation(this.buffer.slice(start, m.index))) continue;
      this.emit(candidate, out);
      start = end;
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  /** Release whatever is left, even without closing punctuation. */
  flush(): string[] {
    const out: string[] = [];
    this.emit(this.buffer, out);
    this.buffer = "";
    return out;
  }

  reset(): void {
    this.buffer = "";
    this.lastKey = "";
  }

  private emit(raw: string, out: string[]): void {
    const sentence = raw.replace(/\s+/g, " ").trim();
    if (!hasSpeakableText(sentence)) return;
    const k = key(sentence);
    if (k === this.lastKey) return;
    this.lastKey = k;
    out.push(sentence);
  }
}

/** Split a finished text into speakable sentences with the same rules as streaming. */
export function chunkSentences(text: string): string[] {
  const c = new SentenceChunker();
  return [...c.push(text), ...c.flush()];
}
