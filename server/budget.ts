// Abuse and budget guard for the public demo. State is in memory, so on a
// serverless host each warm instance keeps its own counters: a best-effort cap,
// not an exact one. The daily cap is deliberately low to cover that.

export class SessionLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limitPerHour: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a request and returns false when the key is over its hourly limit. */
  allow(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((ts) => t - ts < 3_600_000);
    if (recent.length >= this.limitPerHour) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.prune(t);
    return true;
  }

  private prune(t: number): void {
    for (const [key, list] of this.hits) {
      if (list.every((ts) => t - ts >= 3_600_000)) this.hits.delete(key);
    }
  }
}

export class DailySpend {
  private day = "";
  private spent = 0;

  constructor(
    private readonly capUsd: number,
    private readonly now: () => number = Date.now,
  ) {}

  private roll(): void {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.spent = 0;
    }
  }

  add(usd: number): void {
    this.roll();
    this.spent += usd;
  }

  exhausted(): boolean {
    this.roll();
    return this.spent >= this.capUsd;
  }

  snapshot(): { day: string; spent_usd: number; cap_usd: number } {
    this.roll();
    return { day: this.day, spent_usd: Math.round(this.spent * 10000) / 10000, cap_usd: this.capUsd };
  }
}
