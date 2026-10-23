// Earcons made with the Web Audio API: no recorded or third-party sounds.

type Ctx = AudioContext;

export class Earcons {
  private ctx: Ctx | null = null;
  private loop: number | null = null;
  private paused = false;
  enabled = true;

  /** Must be called from a user gesture on iOS before any sound can play. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    void this.ctx.resume().catch(() => {});
  }

  private tone(freq: number, start: number, dur: number, gain = 0.12, type: OscillatorType = "sine"): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Shutter-like click on capture. */
  capture(): void {
    this.tone(1800, 0, 0.035, 0.1, "square");
    this.tone(900, 0.04, 0.05, 0.08, "square");
  }

  /** Soft pulse every second while waiting for an answer. Paused while speaking. */
  startThinking(): void {
    this.stopThinking();
    const pulse = () => {
      if (!this.paused) this.tone(440, 0, 0.18, 0.04);
    };
    pulse();
    this.loop = window.setInterval(pulse, 1000);
  }

  stopThinking(): void {
    if (this.loop !== null) window.clearInterval(this.loop);
    this.loop = null;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  done(): void {
    this.tone(660, 0, 0.12, 0.08);
    this.tone(880, 0.12, 0.16, 0.08);
  }

  error(): void {
    this.tone(220, 0, 0.25, 0.1, "triangle");
  }

  listening(): void {
    this.tone(520, 0, 0.08, 0.08);
    this.tone(780, 0.09, 0.1, 0.08);
  }
}
