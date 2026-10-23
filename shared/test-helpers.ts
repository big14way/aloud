import type { VisionItem, VisionRead } from "./schemas.js";

export function item(partial: Partial<VisionItem> & Pick<VisionItem, "content">): VisionItem {
  return {
    kind: "object",
    confidence: 0.9,
    position_clock: 0,
    distance: "unknown",
    number_kind: "none",
    ...partial,
  };
}

export function read(items: VisionItem[], overrides: Partial<VisionRead> = {}): VisionRead {
  return {
    image_quality: { blur: false, too_dark: false, glare: false, cut_off: "none" },
    can_answer: true,
    camera_guidance: "",
    medicine_label: false,
    items,
    ...overrides,
  };
}
