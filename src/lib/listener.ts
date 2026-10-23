// Push-to-talk with the browser's speech recognition. Some browsers send audio to
// their vendor's cloud for this; Settings says so. Typed input is always available.

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResultList {
  length: number;
  [index: number]: { isFinal: boolean; length: number; [index: number]: RecognitionAlternative };
}
interface RecognitionEvent {
  results: RecognitionResultList;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function listeningSupported(): boolean {
  return typeof window !== "undefined" && ctor() !== null;
}

export interface ListenHandlers {
  onText: (text: string) => void;
  onEnd: () => void;
  onError: (error: string) => void;
}

export class Listener {
  private rec: Recognition | null = null;
  private transcript = "";

  get active(): boolean {
    return this.rec !== null;
  }

  start(h: ListenHandlers): boolean {
    const C = ctor();
    if (!C) return false;
    this.cancel();
    const rec = new C();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    this.transcript = "";
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i]?.[0]?.transcript ?? "";
      this.transcript = text;
    };
    rec.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") h.onError(e.error);
    };
    rec.onend = () => {
      const text = this.transcript.trim();
      this.rec = null;
      if (text) h.onText(text);
      h.onEnd();
    };
    this.rec = rec;
    try {
      rec.start();
    } catch {
      this.rec = null;
      return false;
    }
    return true;
  }

  /** Release: stop listening and deliver what was heard. */
  stop(): void {
    this.rec?.stop();
  }

  cancel(): void {
    if (!this.rec) return;
    this.rec.onend = null;
    this.rec.abort();
    this.rec = null;
  }
}
