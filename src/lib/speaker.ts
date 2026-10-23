import { hasSpeakableText } from "../../shared/speech";

// Speech out. In "speak" mode Aloud's own voice reads sentences one at a time from a
// queue. In "screen_reader" mode Aloud stays silent and hands the text to an
// aria-live region, so VoiceOver or TalkBack does the speaking and nothing doubles.

export type AnswerMode = "speak" | "screen_reader";

export interface SpeakerOptions {
  mode: AnswerMode;
  rate: number;
  voiceURI: string | null;
}

export class Speaker {
  private queue: string[] = [];
  private current: SpeechSynthesisUtterance | null = null;
  private lastAnswer: string[] = [];
  private lastQueued = "";
  private options: SpeakerOptions = { mode: "speak", rate: 1, voiceURI: null };

  /** Receives text for the aria-live region. */
  onLive: (text: string) => void = () => {};
  onSpeakingChange: (speaking: boolean) => void = () => {};

  static supported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  setOptions(options: SpeakerOptions): void {
    this.options = options;
  }

  get mode(): AnswerMode {
    return this.options.mode;
  }

  /** iOS only lets speech start from a user gesture; call this from the first tap. */
  unlock(): void {
    if (!Speaker.supported() || this.options.mode !== "speak") return;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }

  /** Speak an answer. `remember` makes it the one "repeat" plays back. */
  say(sentences: string[], remember = true): void {
    const clean = sentences.map((s) => s.trim()).filter(hasSpeakableText);
    if (clean.length === 0) return;
    if (remember) this.lastAnswer = clean;
    if (this.options.mode === "screen_reader" || !Speaker.supported()) {
      this.onLive(clean.join(" "));
      return;
    }
    // Skip a sentence identical to the one queued right before it.
    for (const s of clean) {
      if (s === this.lastQueued) continue;
      this.queue.push(s);
      this.lastQueued = s;
    }
    this.lastQueued = "";
    this.pump();
  }

  repeat(): void {
    if (this.lastAnswer.length === 0) {
      this.say(["Nothing to repeat yet."], false);
      return;
    }
    this.stop();
    this.say(this.lastAnswer, false);
  }

  get last(): string[] {
    return this.lastAnswer;
  }

  stop(): void {
    this.queue = [];
    if (Speaker.supported()) window.speechSynthesis.cancel();
    if (this.current) {
      this.current = null;
      this.onSpeakingChange(false);
    }
  }

  private voice(): SpeechSynthesisVoice | null {
    if (!this.options.voiceURI) return null;
    return window.speechSynthesis.getVoices().find((v) => v.voiceURI === this.options.voiceURI) ?? null;
  }

  private pump(): void {
    if (this.current || this.queue.length === 0) return;
    const text = this.queue.shift()!;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = this.options.rate;
    u.lang = "en";
    const v = this.voice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    const next = () => {
      if (this.current !== u) return;
      this.current = null;
      if (this.queue.length === 0) this.onSpeakingChange(false);
      this.pump();
    };
    u.onend = next;
    u.onerror = next;
    // Keep a reference: some browsers drop callbacks on garbage-collected utterances.
    this.current = u;
    this.onSpeakingChange(true);
    window.speechSynthesis.speak(u);
  }
}

export function englishVoices(): SpeechSynthesisVoice[] {
  if (!Speaker.supported()) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
}
