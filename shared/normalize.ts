import type { VisionItem, VisionRead } from "./schemas.js";

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function clampClock(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 12) return 0;
  return n;
}

/** Clamp model-reported numbers into range and trim strings. Never trust raw ranges. */
export function normalizeRead(read: VisionRead): VisionRead {
  return {
    ...read,
    camera_guidance: read.camera_guidance.trim(),
    items: read.items
      .map(
        (item): VisionItem => ({
          ...item,
          content: item.content.trim(),
          confidence: clamp01(item.confidence),
          position_clock: clampClock(item.position_clock),
        }),
      )
      .filter((item) => item.content.length > 0),
  };
}
