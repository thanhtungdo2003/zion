/**
 * Deterministic integer hashing and PRNG built exclusively on 32-bit integer math (Math.imul,
 * shifts, xor). Output is identical on every JS engine and platform, which is a hard requirement
 * for seed-based world generation.
 */

/** Final avalanche mix (lowbias32 by Chris Wellons). */
export function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hashCombine(a: number, b: number): number {
  return mix32((a ^ Math.imul(b | 0, 0x9e3779b1)) + 0x632be5ab);
}

export function hash2(seed: number, x: number, z: number): number {
  return hashCombine(hashCombine(seed, x), z);
}

export function hash3(seed: number, x: number, y: number, z: number): number {
  return hashCombine(hashCombine(hashCombine(seed, x), y), z);
}

/** FNV-1a over UTF-16 code units, finalised with mix32. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h);
}

/** Map a u32 hash to [0, 1). */
export function hashToUnit(h: number): number {
  return (h >>> 0) / 4294967296;
}

/** mulberry32 PRNG — small state, good statistical quality for gameplay/worldgen use. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  nextU32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick() from empty array');
    return items[this.int(items.length)]!;
  }
}
