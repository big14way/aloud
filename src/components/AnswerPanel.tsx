import type { Metrics } from "../../shared/api";
import type { AnswerSource } from "../lib/controller";
import type { AnswerMode } from "../lib/speaker";

interface Props {
  text: string[];
  liveText: string;
  mode: AnswerMode;
  source: AnswerSource | null;
  metrics: Metrics | null;
  heard: string;
  simulatedSecondFrame: boolean;
}

const SOURCE_LABEL: Record<AnswerSource, string> = {
  live: "Live answer",
  saved: "Saved answer",
  offline: "Offline",
  on_device: "On this phone",
};

const LANE_NAME: Record<string, string> = {
  vision: "Super-VL",
  fast: "Lightning",
  steps: "Super",
  judge: "Ultra",
  fastlane: "Nano 4B",
};

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function AnswerPanel({ text, liveText, mode, source, metrics, heard, simulatedSecondFrame }: Props) {
  return (
    <section className="answer" aria-label="Last answer">
      {heard && <p className="heard">You said: “{heard}”</p>}
      <div className="answer-text">
        {text.length === 0 ? <p className="muted">Answers appear here and are spoken aloud.</p> : text.map((t, i) => <p key={i}>{t}</p>)}
      </div>
      {/* In screen-reader mode this region speaks through VoiceOver or TalkBack. */}
      <div className="sr-only" aria-live={mode === "screen_reader" ? "polite" : "off"} aria-atomic="true">
        {mode === "screen_reader" ? liveText : ""}
      </div>
      {(source || metrics) && (
        <details className="metrics">
          <summary>
            {source ? SOURCE_LABEL[source] : ""}
            {metrics ? ` · ${seconds(metrics.total_ms)} · $${metrics.cost_usd.toFixed(4)}` : ""}
          </summary>
          {simulatedSecondFrame && <p>Sample mode: the second frame for number checks is the same scene rendered with a small shift, like a moving hand.</p>}
          {metrics && (
            <ul>
              {metrics.calls.map((c, i) => (
                <li key={i}>
                  {LANE_NAME[c.lane] ?? c.lane} <code>{c.model}</code>: {seconds(c.latency_ms)}, {c.prompt_tokens} in / {c.completion_tokens} out
                  {c.reasoning_tokens ? ` (${c.reasoning_tokens} reasoning)` : ""}, ${c.cost_usd.toFixed(5)}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </section>
  );
}
