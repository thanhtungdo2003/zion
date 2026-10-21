import { Rng, Surface, hashString } from '@zion/shared';

/**
 * An independent random stream per generation layer: the same seed and layer always give the
 * same numbers, and re-rolling props never moves the roads or the houses.
 */
export function stream(seed: string | number, layer: string): Rng {
  return new Rng(hashString(`${seed}::${layer}`));
}

export function seedNumber(seed: string | number, layer = 'base'): number {
  return hashString(`${seed}::${layer}`) >>> 0;
}

/** Surfaces the editor paints (a subset of the game's Surface enum, same ids). */
export const PAINT_SURFACES = [
  { id: Surface.Grass, name: 'Cỏ', color: [92, 122, 70] },
  { id: Surface.DryGrass, name: 'Cỏ khô', color: [146, 138, 86] },
  { id: Surface.ForestFloor, name: 'Đất rừng', color: [74, 88, 56] },
  { id: Surface.Dirt, name: 'Đất', color: [122, 100, 74] },
  { id: Surface.Mud, name: 'Bùn', color: [88, 74, 58] },
  { id: Surface.Sand, name: 'Cát', color: [196, 182, 138] },
  { id: Surface.Gravel, name: 'Sỏi', color: [130, 128, 120] },
  { id: Surface.Rock, name: 'Đá', color: [118, 116, 112] },
  { id: Surface.Snow, name: 'Tuyết', color: [228, 232, 236] },
] as const;
export const SURFACE_COLOR = new Map<number, readonly number[]>(PAINT_SURFACES.map((s) => [s.id, s.color]));

/** Rectangle of cells [i0, i1] × [j0, j1] (inclusive). */
export interface CellRect { i0: number; j0: number; i1: number; j1: number }

export function unionRect(a: CellRect | null, b: CellRect | null): CellRect | null {
  if (!a) return b; if (!b) return a;
  return { i0: Math.min(a.i0, b.i0), j0: Math.min(a.j0, b.j0), i1: Math.max(a.i1, b.i1), j1: Math.max(a.j1, b.j1) };
}

/**
 * The editable terrain: a regular grid of heights (m) and painted surfaces over a square map.
 * Vertex (i, j) sits at world (i·cell, j·cell); the map covers [0, size]².
 */
export class Heightfield {
  readonly cols: number;
  readonly rows: number;
  readonly heights: Float32Array;
  readonly surface: Uint8Array;

  constructor(readonly size: number, readonly cell: number, heights?: Float32Array, surface?: Uint8Array) {
    this.cols = this.rows = Math.round(size / cell) + 1;
    const n = this.cols * this.rows;
    this.heights = heights ?? new Float32Array(n);
    this.surface = surface ?? new Uint8Array(n);
    if (this.heights.length !== n || this.surface.length !== n) throw new Error(`Terrain data has ${this.heights.length} cells, expected ${n}`);
  }

  clone(): Heightfield { return new Heightfield(this.size, this.cell, this.heights.slice(), this.surface.slice()); }

  index(i: number, j: number): number { return j * this.cols + i; }
  clampI(i: number): number { return i < 0 ? 0 : i >= this.cols ? this.cols - 1 : i; }
  clampJ(j: number): number { return j < 0 ? 0 : j >= this.rows ? this.rows - 1 : j; }
  get(i: number, j: number): number { return this.heights[this.clampJ(j) * this.cols + this.clampI(i)]!; }

  /** Bilinear height at a world point (clamped to the map). */
  heightAt(x: number, z: number): number {
    const fx = Math.max(0, Math.min(this.cols - 1.0001, x / this.cell)), fz = Math.max(0, Math.min(this.rows - 1.0001, z / this.cell));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const k = j * this.cols + i, h = this.heights;
    const a = h[k]!, b = h[k + 1]!, c = h[k + this.cols]!, d = h[k + this.cols + 1]!;
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** Steepness at a world point: rise over run (0 = flat, 1 = 45°). */
  slopeAt(x: number, z: number): number {
    const e = this.cell;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }

  surfaceAt(x: number, z: number): number {
    return this.surface[this.clampJ(Math.round(z / this.cell)) * this.cols + this.clampI(Math.round(x / this.cell))]!;
  }

  /** Cells within `radius` of a world point. */
  rectAround(x: number, z: number, radius: number): CellRect {
    return {
      i0: this.clampI(Math.floor((x - radius) / this.cell)), i1: this.clampI(Math.ceil((x + radius) / this.cell)),
      j0: this.clampJ(Math.floor((z - radius) / this.cell)), j1: this.clampJ(Math.ceil((z + radius) / this.cell)),
    };
  }

  /** Copies of the heights and surfaces in a rectangle (for undo). */
  snapshot(r: CellRect): { rect: CellRect; heights: Float32Array; surface: Uint8Array } {
    const w = r.i1 - r.i0 + 1, hgt = r.j1 - r.j0 + 1;
    const heights = new Float32Array(w * hgt), surface = new Uint8Array(w * hgt);
    for (let j = 0; j < hgt; j++) {
      const k = (r.j0 + j) * this.cols + r.i0;
      heights.set(this.heights.subarray(k, k + w), j * w);
      surface.set(this.surface.subarray(k, k + w), j * w);
    }
    return { rect: { ...r }, heights, surface };
  }

  restore(s: { rect: CellRect; heights: Float32Array; surface: Uint8Array }): void {
    const r = s.rect, w = r.i1 - r.i0 + 1;
    for (let j = 0; j <= r.j1 - r.j0; j++) {
      const k = (r.j0 + j) * this.cols + r.i0;
      this.heights.set(s.heights.subarray(j * w, j * w + w), k);
      this.surface.set(s.surface.subarray(j * w, j * w + w), k);
    }
  }

  stats(): { min: number; max: number; mean: number } {
    let min = Infinity, max = -Infinity, sum = 0;
    for (const v of this.heights) { if (v < min) min = v; if (v > max) max = v; sum += v; }
    return { min, max, mean: sum / this.heights.length };
  }
}

/* -------------------------------------------------------------------- binary <-> base64 */

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(text: string): Uint8Array {
  const s = atob(text), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Heights travel as little-endian float32 bytes. */
export function encodeHeights(h: Float32Array): string {
  const copy = new Float32Array(h);
  return bytesToBase64(new Uint8Array(copy.buffer));
}
export function decodeHeights(text: string): Float32Array {
  const bytes = base64ToBytes(text);
  if (bytes.length % 4) throw new Error('Corrupt height data');
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4).slice();
}
