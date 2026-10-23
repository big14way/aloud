// One press = one or two still frames. No continuous video leaves the phone.

export const FRAME_LONG_SIDE = 1024;
export const FRAME_QUALITY = 0.7;
export const SECOND_FRAME_GAP_MS = 400;

function canvasFor(w: number, h: number, longSide: number): { canvas: HTMLCanvasElement; width: number; height: number } {
  const scale = Math.min(1, longSide / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, width, height };
}

/** Draw a source into a JPEG data URL with the long side capped. */
export function encodeFrame(source: CanvasImageSource, w: number, h: number, longSide = FRAME_LONG_SIDE, quality = FRAME_QUALITY): string {
  const { canvas, width, height } = canvasFor(w, h, longSide);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image ${src.slice(0, 40)}`));
    img.src = src;
  });
}

/** Small thumbnail kept on the device for memory enrolment. */
export async function thumbnail(dataUrl: string, longSide = 256): Promise<string> {
  const img = await loadImage(dataUrl);
  return encodeFrame(img, img.naturalWidth, img.naturalHeight, longSide, 0.75);
}

/**
 * Sample-photo mode has one photo, but Read needs two frames. The second is the
 * same photo shifted and rescaled slightly, like a hand moving between frames.
 * The UI says so whenever it is used.
 */
export async function simulatedSecondFrame(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const { canvas, width, height } = canvasFor(w, h, FRAME_LONG_SIDE);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  const dx = Math.round(w * 0.02);
  const dy = Math.round(h * 0.015);
  ctx.drawImage(img, dx, dy, w - dx * 2, h - dy * 2, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", FRAME_QUALITY);
}

export class Camera {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;

  attach(video: HTMLVideoElement | null): void {
    this.video = video;
    if (video && this.stream && video.srcObject !== this.stream) {
      video.srcObject = this.stream;
      void video.play().catch(() => {});
    }
  }

  get active(): boolean {
    return this.stream !== null && this.stream.getVideoTracks().some((t) => t.readyState === "live");
  }

  static supported(): boolean {
    return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  /** Ask for the back camera. Resolves false when there is no camera or permission is refused. */
  async start(): Promise<boolean> {
    if (this.active) return true;
    if (!Camera.supported()) return false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
    } catch {
      this.stream = null;
      return false;
    }
    if (this.video) {
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});
    }
    return true;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  private async waitForFrame(): Promise<HTMLVideoElement> {
    const v = this.video;
    if (!v) throw new Error("No video element");
    for (let i = 0; i < 40 && (v.readyState < 2 || v.videoWidth === 0); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (v.videoWidth === 0) throw new Error("Camera has no picture yet");
    return v;
  }

  async capture(): Promise<string> {
    const v = await this.waitForFrame();
    return encodeFrame(v, v.videoWidth, v.videoHeight);
  }

  /** Two frames ~400 ms apart, for reads that contain numbers. */
  async captureTwo(gapMs = SECOND_FRAME_GAP_MS): Promise<[string, string]> {
    const first = await this.capture();
    await new Promise((r) => setTimeout(r, gapMs));
    return [first, await this.capture()];
  }
}
