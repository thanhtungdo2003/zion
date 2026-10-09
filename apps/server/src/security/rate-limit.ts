/** Classic token bucket: `rate` tokens/second, capacity `burst`. Time is injectable for tests. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly rate: number,
    private readonly burst: number,
    now: number = Date.now(),
  ) {
    this.tokens = burst;
    this.last = now;
  }

  take(cost = 1, now: number = Date.now()): boolean {
    const elapsed = (now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate);
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/**
 * Fixed-window counter keyed by string (e.g. IP), with bounded memory. Used for connection-level
 * throttling (WebSocket upgrades) where a shared store is unnecessary.
 */
export class KeyedWindowLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 100_000,
  ) {}

  hit(key: string, now: number = Date.now()): boolean {
    let w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      if (!w && this.windows.size >= this.maxKeys) this.prune(now);
      w = { start: now, count: 0 };
      this.windows.set(key, w);
    }
    w.count++;
    return w.count <= this.limit;
  }

  prune(now: number = Date.now()): void {
    for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
    // Under a flood of distinct keys, drop the oldest half rather than grow without bound.
    if (this.windows.size >= this.maxKeys) {
      let i = 0;
      for (const k of this.windows.keys()) {
        if (i++ > this.maxKeys / 2) break;
        this.windows.delete(k);
      }
    }
  }
}

/** Counts concurrent things (connections) per key. */
export class ConcurrencyCounter {
  private readonly counts = new Map<string, number>();

  get(key: string): number {
    return this.counts.get(key) ?? 0;
  }

  inc(key: string): number {
    const v = this.get(key) + 1;
    this.counts.set(key, v);
    return v;
  }

  dec(key: string): void {
    const v = this.get(key) - 1;
    if (v <= 0) this.counts.delete(key);
    else this.counts.set(key, v);
  }
}
