import type { VisionItem, VisionRead } from "../shared/schemas.js";
import { loadConfig, type ServerConfig } from "./env.js";

export const FRAME_A = "data:image/jpeg;base64,QUFB";
export const FRAME_B = "data:image/jpeg;base64,QkJC";
export const THUMB = "data:image/jpeg;base64,VFRU";

export function testConfig(overrides: Record<string, string> = {}): ServerConfig {
  return loadConfig({ NEBIUS_API_KEY: "test-key", DAILY_BUDGET_USD: "5", SESSION_LIMIT_PER_HOUR: "30", ...overrides });
}

const OK_QUALITY = { blur: false, too_dark: false, glare: false, cut_off: "none" as const };

export function visionJson(items: Partial<VisionItem>[], overrides: Partial<VisionRead> = {}): string {
  const read: VisionRead = {
    image_quality: OK_QUALITY,
    can_answer: true,
    camera_guidance: "",
    medicine_label: false,
    items: items.map((i) => ({ kind: "object", content: "", confidence: 0.9, position_clock: 0, distance: "unknown", number_kind: "none", ...i })),
    ...overrides,
  };
  return JSON.stringify(read);
}
