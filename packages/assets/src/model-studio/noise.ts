/**
 * Deterministic noise for the Model Studio: tileable 2D gradient noise and cellular (Worley)
 * noise for textures (a texture tiles when every lattice coordinate wraps at its period), and 3D
 * gradient noise for shaping meshes (rocks). Pure functions of their seed: the server exporting a
 * model and the browser previewing it compute the same pixels and vertices.
 */

export function hash(seed: number, x: number, y = 0, z = 0): number {
  let h = (seed | 0) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
/** 0..1 */
export const hash01 = (seed: number, x: number, y = 0, z = 0) => hash(seed, x, y, z) / 4294967296;

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const mod = (a: number, n: number) => ((a % n) + n) % n;

function grad2(seed: number, ix: number, iy: number, dx: number, dy: number): number {
  const a = hash01(seed, ix, iy) * Math.PI * 2;
  return Math.cos(a) * dx + Math.sin(a) * dy;
}

/** Gradient noise ≈ −1..1, tiling every `period` units in x and y. */
export function noise2(seed: number, x: number, y: number, period: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const p = Math.max(1, Math.round(period));
  const i0 = mod(x0, p), i1 = mod(x0 + 1, p), j0 = mod(y0, p), j1 = mod(y0 + 1, p);
  const u = fade(fx), v = fade(fy);
  const a = grad2(seed, i0, j0, fx, fy), b = grad2(seed, i1, j0, fx - 1, fy);
  const c = grad2(seed, i0, j1, fx, fy - 1), d = grad2(seed, i1, j1, fx - 1, fy - 1);
  return ((a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v) * 1.41;
}

/** Fractal noise ≈ −1..1 over `octaves`, tileable at `period` (each octave doubles it). */
export function fbm2(seed: number, x: number, y: number, period: number, octaves = 4, gain = .5): number {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(seed + o * 101, x * f, y * f, period * f) * amp;
    norm += amp; amp *= gain; f *= 2;
  }
  return sum / norm;
}

/**
 * Cellular noise tiling at `period` cells: distance to the nearest and second-nearest feature
 * point and the nearest cell's id (0..1), for stones, cobbles and cracks.
 */
export function cells2(seed: number, x: number, y: number, period: number, jitter = .9): { f1: number; f2: number; id: number } {
  const p = Math.max(1, Math.round(period));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = x0 + dx, cy = y0 + dy, ix = mod(cx, p), iy = mod(cy, p);
    const px = cx + .5 + (hash01(seed, ix, iy, 1) - .5) * jitter, py = cy + .5 + (hash01(seed, ix, iy, 2) - .5) * jitter;
    const d = Math.hypot(px - x, py - y);
    if (d < f1) { f2 = f1; f1 = d; id = hash01(seed, ix, iy, 3); } else if (d < f2) f2 = d;
  }
  return { f1, f2, id };
}

function grad3(seed: number, ix: number, iy: number, iz: number, dx: number, dy: number, dz: number): number {
  const h = hash(seed, ix, iy, iz);
  const t = (h & 0xffff) / 0xffff * 2 - 1, a = (h >>> 16) / 0xffff * Math.PI * 2, r = Math.sqrt(1 - t * t);
  return r * Math.cos(a) * dx + r * Math.sin(a) * dy + t * dz;
}

/** 3D gradient noise ≈ −1..1. */
export function noise3(seed: number, x: number, y: number, z: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), fx = x - x0, fy = y - y0, fz = z - z0;
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const g = (i: number, j: number, k: number) => grad3(seed, x0 + i, y0 + j, z0 + k, fx - i, fy - j, fz - k);
  return l(l(l(g(0, 0, 0), g(1, 0, 0), u), l(g(0, 1, 0), g(1, 1, 0), u), v), l(l(g(0, 0, 1), g(1, 0, 1), u), l(g(0, 1, 1), g(1, 1, 1), u), v), w) * 1.6;
}

export function fbm3(seed: number, x: number, y: number, z: number, octaves = 4, gain = .5): number {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) { sum += noise3(seed + o * 131, x * f, y * f, z * f) * amp; norm += amp; amp *= gain; f *= 2.03; }
  return sum / norm;
}

/** A small seeded random stream (mulberry32). */
export class Random {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0 || 1; }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  int(a: number, b: number): number { return Math.floor(this.range(a, b + 1)); }
  pick<T>(list: readonly T[]): T { return list[Math.floor(this.next() * list.length)]!; }
}

/** A seed number from any text (project ids, prompts). */
export function seedOf(text: string | number): number {
  if (typeof text === 'number') return text >>> 0;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
