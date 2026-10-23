import { type NumberVerdict, render } from "../../shared/gates";
import { compareFrames } from "../../shared/numbers";
import type { VisionItem, VisionRead } from "../../shared/schemas";

// Offline reading with Tesseract.js on the device. The same gates apply as online:
// confidence wording, dropped low-confidence lines, and two-frame number agreement.

type TesseractWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;

let worker: Promise<TesseractWorker> | null = null;

function getWorker(): Promise<TesseractWorker> {
  worker ??= import("tesseract.js").then(({ createWorker }) => createWorker("eng"));
  worker.catch(() => {
    worker = null;
  });
  return worker;
}

/** Download the offline reader now (about 10 MB), so it works later without a network. */
export async function prepareOfflineReading(): Promise<boolean> {
  try {
    await getWorker();
    return true;
  } catch {
    return false;
  }
}

async function linesOf(image: string): Promise<VisionItem[]> {
  const w = await getWorker();
  const { data } = await w.recognize(image, {}, { blocks: true });
  const items: VisionItem[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        const text = line.text.replace(/\s+/g, " ").trim();
        if (!/[\p{L}\p{N}]/u.test(text)) continue;
        items.push({ kind: "text", content: text, confidence: line.confidence / 100, position_clock: 0, distance: "unknown", number_kind: "none" });
      }
    }
  }
  return items;
}

export async function readOffline(frames: string[]): Promise<{ speech: string[]; read: VisionRead }> {
  const [a, b] = await Promise.all(frames.slice(0, 2).map(linesOf));
  const items = a ?? [];
  const read: VisionRead = {
    image_quality: { blur: false, too_dark: false, glare: false, cut_off: "none" },
    can_answer: items.length > 0,
    camera_guidance: "",
    medicine_label: false,
    items,
  };
  const numbers = new Map<number, NumberVerdict>();
  if (b) for (const i of compareFrames(items, b).agreed) numbers.set(i, { source: "agreed" });
  const rendered = items.length === 0 ? { speech: ["I can't find any text. Try moving closer, or adding light."] } : render({ skill: "read", read, numbers });
  return { speech: ["Offline. Reading on this phone.", ...rendered.speech], read };
}
