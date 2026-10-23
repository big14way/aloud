import { useEffect, useState } from "react";
import { prepareOfflineReading } from "../lib/ocr";
import type { Settings } from "../lib/settings";
import { englishVoices } from "../lib/speaker";
import { Dialog } from "./Dialog";

interface Props {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  onClose: () => void;
  onTestVoice: () => void;
}

export function SettingsPanel({ settings, update, onClose, onTestVoice }: Props) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(englishVoices);
  const [offline, setOffline] = useState<"idle" | "loading" | "ready" | "failed">("idle");

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const refresh = () => setVoices(englishVoices());
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, []);

  return (
    <Dialog title="Settings" onClose={onClose}>
      <fieldset>
        <legend>How answers are spoken</legend>
        <label className="choice">
          <input type="radio" name="answerMode" checked={settings.answerMode === "speak"} onChange={() => update({ answerMode: "speak" })} />
          Speak aloud with Aloud's voice
        </label>
        <label className="choice">
          <input type="radio" name="answerMode" checked={settings.answerMode === "screen_reader"} onChange={() => update({ answerMode: "screen_reader" })} />
          Use my screen reader (VoiceOver or TalkBack reads the answers)
        </label>
      </fieldset>

      <label className="field">
        Speech rate: {settings.rate.toFixed(1)}
        <input type="range" min={0.6} max={1.8} step={0.1} value={settings.rate} onChange={(e) => update({ rate: Number(e.target.value) })} />
      </label>

      <label className="field">
        Voice
        <select value={settings.voiceURI ?? ""} onChange={(e) => update({ voiceURI: e.target.value || null })}>
          <option value="">Default voice</option>
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={onTestVoice}>
        Test voice
      </button>

      <label className="choice">
        <input type="checkbox" checked={settings.simpleMode} onChange={(e) => update({ simpleMode: e.target.checked })} />
        Simple mode: short sentences, one step at a time
      </label>

      <label className="field">
        Your name (used in simple mode)
        <input type="text" value={settings.userName} maxLength={40} autoComplete="given-name" onChange={(e) => update({ userName: e.target.value })} />
      </label>

      <label className="choice">
        <input type="checkbox" checked={settings.earcons} onChange={(e) => update({ earcons: e.target.checked })} />
        Sounds for capture, thinking and done
      </label>
      <label className="choice">
        <input type="checkbox" checked={settings.haptics} onChange={(e) => update({ haptics: e.target.checked })} />
        Vibrate on capture (Android)
      </label>
      <label className="choice">
        <input type="checkbox" checked={settings.showPreview} onChange={(e) => update({ showPreview: e.target.checked })} />
        Show the camera picture on screen
      </label>

      <h3>Offline reading</h3>
      <p>Reading text works without internet once the on-device reader is downloaded (about 10 MB).</p>
      <button
        type="button"
        disabled={offline === "loading" || offline === "ready"}
        onClick={async () => {
          setOffline("loading");
          setOffline((await prepareOfflineReading()) ? "ready" : "failed");
        }}
      >
        {offline === "ready" ? "Offline reading is ready" : offline === "loading" ? "Downloading…" : "Download offline reading"}
      </button>
      {offline === "failed" && <p role="alert">The download failed. Check the connection and try again.</p>}

      <h3>Privacy</h3>
      <p>
        Your object memory stays on this phone. Aloud's server stores no images or audio. Pictures are sent to Nemotron models on Nebius Token Factory only when you press, and Nebius
        advertises zero-retention inference. Voice input uses your browser's speech recognition, which some browsers process in their maker's cloud. You can type instead.
      </p>
    </Dialog>
  );
}
