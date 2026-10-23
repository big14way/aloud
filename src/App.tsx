import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { HealthResponse } from "../shared/api";
import { AnswerPanel } from "./components/AnswerPanel";
import { BigButton } from "./components/BigButton";
import { Disclaimer } from "./components/Disclaimer";
import { MemoryPanel } from "./components/MemoryPanel";
import { SamplesPanel } from "./components/SamplesPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { api } from "./lib/api";
import { Controller, HELP_TEXT } from "./lib/controller";
import { useSettings } from "./lib/settings";

type Panel = "settings" | "memory" | "samples" | null;

export function App() {
  const [settings, update] = useSettings();
  const [controller] = useState(() => new Controller(settings));
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const [panel, setPanel] = useState<Panel>(null);
  const [liveText, setLiveText] = useState("");
  const [typed, setTyped] = useState("");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const typeBox = useRef<HTMLInputElement>(null);

  useEffect(() => controller.applySettings(settings), [controller, settings]);

  // Screen-reader mode: clear then set, so the same answer twice is announced twice.
  useEffect(() => {
    controller.speaker.onLive = (text) => {
      setLiveText("");
      window.setTimeout(() => setLiveText(text), 60);
    };
  }, [controller]);

  useEffect(() => {
    void api.health().then((r) => r.ok && setHealth(r.data));
  }, []);

  // Privacy and battery: release the camera whenever the app is not visible.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") controller.stopCamera();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [controller]);

  const talk = useCallback(() => {
    controller.unlock();
    if (!controller.startListening()) {
      typeBox.current?.focus();
      controller.say(["Voice input isn't available here. Type your request in the box."]);
    }
  }, [controller]);

  // Keyboard and Bluetooth clicker shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (panel || !settings.disclaimerAccepted || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select")) return;
      const onButton = Boolean(target.closest("button"));
      const run = (fn: () => unknown) => {
        e.preventDefault();
        controller.unlock();
        void fn();
      };
      switch (e.key) {
        case " ":
        case "Enter":
          if (!onButton) run(() => controller.primary());
          break;
        case "PageDown":
        case "ArrowRight":
        case "MediaPlayPause":
          run(() => controller.primary());
          break;
        case "PageUp":
        case "ArrowLeft":
          run(() => controller.repeat());
          break;
        case "r":
        case "R":
          run(() => controller.look("read"));
          break;
        case "w":
        case "W":
          run(() => controller.look("what_is"));
          break;
        case "f":
        case "F":
          run(() => controller.findButton());
          break;
        case "m":
        case "M":
        case "t":
        case "T":
          run(talk);
          break;
        case "l":
        case "L":
          run(() => controller.lookHarder());
          break;
        case "h":
        case "H":
          run(() => controller.say(HELP_TEXT));
          break;
        case "c":
        case "C":
          run(() => controller.cancelFlow());
          break;
        case "s":
        case "S":
        case "Escape":
          run(() => controller.stop());
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller, panel, settings.disclaimerAccepted, talk]);

  const quick = (fn: () => unknown) => () => {
    controller.unlock();
    void fn();
  };

  const notConfigured = health !== null && !health.lanes.vision.configured;

  return (
    <div className={`app${settings.simpleMode ? " simple" : ""}`}>
      <div className="stage" aria-hidden="true">
        {state.sample ? (
          <img className="preview" src={`/samples/${state.sample.file}`} alt="" />
        ) : (
          <video ref={(v) => controller.camera.attach(v)} className={`preview${settings.showPreview ? "" : " invisible"}`} muted playsInline autoPlay />
        )}
      </div>

      <header className="top">
        <h1>Aloud</h1>
        {settings.simpleMode && <span className="badge">Simple mode</span>}
        {state.sample && <span className="badge">Sample: {state.sample.title}</span>}
        <nav aria-label="Panels">
          <button type="button" className="ghost" onClick={() => setPanel("samples")}>
            Samples
          </button>
          <button type="button" className="ghost" onClick={() => setPanel("memory")}>
            My things
          </button>
          <button type="button" className="ghost" onClick={() => setPanel("settings")}>
            Settings
          </button>
        </nav>
      </header>

      {notConfigured && (
        <p className="banner" role="status">
          This server has no model key yet. Sample photos will use saved answers.
        </p>
      )}

      <main className="main">
        <BigButton
          label={controller.primaryLabel()}
          hint="Tap. Double-tap to repeat. Hold to talk."
          busy={state.busy}
          listening={state.listening}
          onTap={() => void controller.primary()}
          onDoubleTap={() => controller.repeat()}
          onHoldStart={talk}
          onHoldEnd={() => controller.stopListening()}
        />

        <div className="quick" role="group" aria-label="Skills">
          <button type="button" onClick={quick(() => controller.look("read"))}>
            Read <kbd>R</kbd>
          </button>
          <button type="button" onClick={quick(() => controller.look("what_is"))}>
            What is this <kbd>W</kbd>
          </button>
          <button type="button" onClick={quick(() => controller.findButton())}>
            Find <kbd>F</kbd>
          </button>
          <button type="button" onClick={quick(talk)} aria-pressed={state.listening}>
            {state.listening ? "Listening…" : "Talk"} <kbd>T</kbd>
          </button>
          <button type="button" onClick={quick(() => controller.repeat())}>
            Repeat
          </button>
          <button type="button" onClick={quick(() => controller.stop())}>
            Stop <kbd>S</kbd>
          </button>
          {state.pending && state.pending.type !== "check" && (
            <button type="button" className="danger" onClick={quick(() => controller.cancelFlow())}>
              Cancel <kbd>C</kbd>
            </button>
          )}
        </div>

        <form
          className="type-box"
          onSubmit={(e) => {
            e.preventDefault();
            const text = typed.trim();
            if (!text) return;
            controller.unlock();
            setTyped("");
            void controller.handleUtterance(text);
          }}
        >
          <label htmlFor="type-input" className="sr-only">
            Type a request
          </label>
          <input
            id="type-input"
            ref={typeBox}
            type="text"
            value={typed}
            placeholder="Or type: where are my keys"
            autoComplete="off"
            enterKeyHint="send"
            onChange={(e) => setTyped(e.target.value)}
          />
          <button type="submit">Send</button>
        </form>

        <AnswerPanel
          text={state.lastText}
          liveText={liveText}
          mode={settings.answerMode}
          source={state.lastSource}
          metrics={state.lastMetrics}
          heard={state.heard}
          simulatedSecondFrame={state.simulatedSecondFrame}
        />
      </main>

      {panel === "settings" && (
        <SettingsPanel settings={settings} update={update} onClose={() => setPanel(null)} onTestVoice={() => controller.say(["This is how Aloud sounds."])} />
      )}
      {panel === "memory" && <MemoryPanel controller={controller} version={state.memoryVersion} onClose={() => setPanel(null)} />}
      {panel === "samples" && <SamplesPanel current={state.sample} onPick={(s) => void controller.useSample(s)} onClose={() => setPanel(null)} />}
      {!settings.disclaimerAccepted && (
        <Disclaimer
          onAccept={() => {
            update({ disclaimerAccepted: true });
            controller.unlock();
            controller.say(["Welcome to Aloud.", ...HELP_TEXT]);
          }}
        />
      )}
    </div>
  );
}
