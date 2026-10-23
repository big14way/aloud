import { useCallback, useState } from "react";
import type { AnswerMode } from "./speaker";

export interface Settings {
  answerMode: AnswerMode;
  rate: number;
  voiceURI: string | null;
  simpleMode: boolean;
  userName: string;
  earcons: boolean;
  haptics: boolean;
  showPreview: boolean;
  disclaimerAccepted: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  answerMode: "speak",
  rate: 1,
  voiceURI: null,
  simpleMode: false,
  userName: "",
  earcons: true,
  haptics: true,
  showPreview: true,
  disclaimerAccepted: false,
};

const KEY = "aloud.settings.v1";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function save(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or blocked storage: settings last for this visit only.
  }
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);
  return [settings, update];
}
