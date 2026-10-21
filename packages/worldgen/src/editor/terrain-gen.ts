import { Surface, smoothstep } from '@zion/shared';
import { Simplex2 } from '../noise';
import { type Heightfield, seedNumber } from './heightfield';

export const TERRAIN_PRESETS = [
  { id: 'plains', name: 'Đồng bằng', maxHeight: 40, roughness: .35, detail: 4 },
  { id: 'hills', name: 'Đồi', maxHeight: 110, roughness: .5, detail: 5 },
  { id: 'mountains', name: 'Núi', maxHeight: 320, roughness: .62, detail: 6 },
  { id: 'valley', name: 'Thung lũng', maxHeight: 220, roughness: .55, detail: 5 },
  { id: 'island', name: 'Đảo', maxHeight: 180, roughness: .5, detail: 5 },
  { id: 'mixed', name: 'Hỗn hợp', maxHeight: 240, roughness: .55, detail: 6 },
] as const;
export type TerrainPreset = typeof TERRAIN_PRESETS[number]['id'];

export interface TerrainSettings {
  preset: TerrainPreset;
  seed: string;
  /** Map edge (m) and grid spacing (m). */
  size: number;
  cell: number;
  seaLevel: number;
  /** Relief above the base level (m). */
  maxHeight: number;
  /** 0..1: how much the small octaves count (persistence). */
  roughness: number;
  /** Number of noise octaves (1..8). */
  detail: number;
  /** Surround the land with sea (always on for the island preset). */
  seaEdge: boolean;
}

export const MAP_SIZES = [1024, 2048, 4096, 8192] as const;
/** Grid spacing per map size: always 1025² vertices (about 5 MB per map). */
export const cellFor = (size: number) => size / 1024;

export function defaultTerrainSettings(preset: TerrainPreset = 'island', seed = 'zion', size = 4096): TerrainSettings {
  const p = TERRAIN_PRESETS.find((t) => t.id === preset)!;
  return { preset, seed, size, cell: cellFor(size), seaLevel: 20, maxHeight: p.maxHeight, roughness: p.roughness, detail: p.detail, seaEdge: preset === 'island' };
}

export function validateTerrainSettings(s: TerrainSettings): string[] {
  const issues: string[] = [];
  if (!TERRAIN_PRESETS.some((p) => p.id === s.preset)) issues.push('Preset địa hình không hợp lệ.');
  if (!s.seed.trim() || s.seed.length > 64) issues.push('Seed phải có 1–64 ký tự.');
  if (!MAP_SIZES.includes(s.size as typeof MAP_SIZES[number])) issues.push(`Kích thước map phải là ${MAP_SIZES.join(', ')} m.`);
  if (!(s.cell >= 1 && s.cell <= 32) || !Number.isInteger(s.size / s.cell)) issues.push('Độ phân giải lưới không hợp lệ.');
  if (!(s.maxHeight >= 5 && s.maxHeight <= 800)) issues.push('Độ cao tối đa phải trong 5–800 m.');
  if (!(s.roughness >= 0 && s.roughness <= 1)) issues.push('Độ gồ ghề phải trong 0–1.');
  if (!(Number.isInteger(s.detail) && s.detail >= 1 && s.detail <= 8)) issues.push('Mật độ chi tiết phải là 1–8 lớp.');
  if (!(s.seaLevel >= 0 && s.seaLevel <= 200)) issues.push('Mực nước biển phải trong 0–200 m.');
  return issues;
}

/** Multi-octave noise sampler for one seed. */
export class TerrainNoise {
  private readonly base: Simplex2;
  private readonly warp: Simplex2;
  private readonly mask: Simplex2;
  constructor(seed: string) {
    this.base = new Simplex2(seedNumber(seed, 'terrain'));
    this.warp = new Simplex2(seedNumber(seed, 'terrain-warp'));
    this.mask = new Simplex2(seedNumber(seed, 'terrain-mask'));
  }
  fbm(x: number, z: number, octaves: number, persistence: number): number {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.base.noise(x * freq + o * 17.3, z * freq - o * 9.1) * amp;
      norm += amp; amp *= persistence; freq *= 2.03;
    }
    return sum / norm;
  }
  ridged(x: number, z: number, octaves: number, persistence: number): number {
    let sum = 0, amp = 1, freq = 1, norm = 0, weight = 1;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(this.base.noise(x * freq - o * 5.7, z * freq + o * 3.3));
      n *= n * weight; weight = Math.min(1, n * 1.6);
      sum += n * amp; norm += amp; amp *= persistence; freq *= 2.07;
    }
    return sum / norm;
  }
  warpOffset(x: number, z: number): [number, number] {
    return [this.warp.noise(x * .9, z * .9), this.warp.noise(x * .9 + 31.7, z * .9 - 12.4)];
  }
  low(x: number, z: number): number { return this.mask.noise(x, z); }
}

/** Normalised relief 0..1 (may dip below 0 for sea) at map coordinates u, v ∈ [0, 1]. */
export function reliefAt(n: TerrainNoise, s: TerrainSettings, u: number, v: number): number {
  // Feature sizes are in metres (a 4 km map holds four base wavelengths, a 1 km map one), and
  // octaves finer than a few grid cells are dropped: they would only be aliasing.
  const k = s.size / 4096, o = Math.max(1, Math.min(s.detail, Math.floor(Math.log2(1024 / k / (4 * s.cell)) ) + 1)), p = .3 + s.roughness * .4;
  const [wx, wz] = n.warpOffset(u * 2, v * 2);
  const x = (u * 4 + wx * .35) * k, z = (v * 4 + wz * .35) * k;
  let h: number;
  switch (s.preset) {
    case 'plains': h = .18 + n.fbm(x * .6, z * .6, o, p) * .25; break;
    case 'hills': h = .35 + n.fbm(x, z, o, p) * .55; break;
    case 'mountains': h = .08 + n.ridged(x * .8, z * .8, o, p) * .95; break;
    case 'valley': {
      // A winding valley floor where a low-frequency line crosses zero, ridges either side.
      const line = Math.abs(n.low(u * 1.6 + wx * .3, v * 1.6 + wz * .3));
      h = .12 + n.ridged(x * .7, z * .7, o, p) * .8 * smoothstep(.04, .45, line) + n.fbm(x * 2, z * 2, 3, .5) * .04;
      break;
    }
    case 'island': h = .22 + n.fbm(x * .8, z * .8, o, p) * .45 + n.ridged(x * .6, z * .6, Math.max(1, o - 1), p) * .45 * smoothstep(.1, .6, n.low(u * 2, v * 2) + .3); break;
    default: {
      const m = n.low(u * 1.4, v * 1.4) * .5 + .5;
      const plains = .15 + n.fbm(x * .6, z * .6, o, p) * .2, hills = .3 + n.fbm(x, z, o, p) * .45, peaks = .1 + n.ridged(x * .8, z * .8, o, p);
      h = m < .45 ? plains + (hills - plains) * smoothstep(.25, .45, m) : hills + (peaks - hills) * smoothstep(.55, .8, m);
    }
  }
  if (s.seaEdge || s.preset === 'island') {
    // Distance to the edge, wobbled so the coast is not a square.
    const edge = Math.min(u, v, 1 - u, 1 - v) + n.low(u * 3 + 7, v * 3 - 2) * .05;
    const cx = u - .5, cz = v - .5, radial = 1 - Math.hypot(cx, cz) * 2 + n.low(u * 2.5, v * 2.5) * .12;
    const land = s.preset === 'island' ? smoothstep(.0, .35, radial) : smoothstep(.02, .14, edge);
    h = h * land - (1 - land) * .12;
  } else if (h < .04) h = .04 * Math.exp((h - .04) * 6); // inland lows flatten out above the sea
  return h;
}

/** Fills `hf` row by row, yielding the fraction done (lets a worker report progress and cancel). */
export function* generateTerrain(s: TerrainSettings, hf: Heightfield): Generator<number, void> {
  const n = new TerrainNoise(s.seed), last = hf.cols - 1;
  for (let j = 0; j < hf.rows; j++) {
    for (let i = 0; i < hf.cols; i++) {
      const r = reliefAt(n, s, i / last, j / last);
      hf.heights[j * hf.cols + i] = r < 0 ? s.seaLevel + r * 120 : s.seaLevel + .8 + r * s.maxHeight;
    }
    if (j % 32 === 31) yield (j + 1) / hf.rows;
  }
  autoPaint(hf, s.seaLevel);
  yield 1;
}

/** Surfaces from height and slope: sand on the shore, rock on cliffs, snow on the peaks. */
export function autoPaint(hf: Heightfield, seaLevel: number, rect = { i0: 0, j0: 0, i1: hf.cols - 1, j1: hf.rows - 1 }): void {
  const c = hf.cell;
  for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
    const h = hf.get(i, j), rel = h - seaLevel;
    const slope = Math.hypot(hf.get(i + 1, j) - hf.get(i - 1, j), hf.get(i, j + 1) - hf.get(i, j - 1)) / (2 * c);
    let s: Surface;
    if (rel < 2.5) s = Surface.Sand;
    else if (slope > .9) s = Surface.Rock;
    else if (rel > 260) s = Surface.Snow;
    else if (slope > .55) s = rel > 120 ? Surface.Gravel : Surface.Dirt;
    else if (rel > 170) s = Surface.DryGrass;
    else s = ((i * 7 + j * 13) % 11 === 0 && slope > .3) ? Surface.Dirt : Surface.Grass;
    hf.surface[j * hf.cols + i] = s;
  }
}
