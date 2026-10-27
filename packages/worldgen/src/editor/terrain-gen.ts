import { erodeGrid } from '../erosion';
import { Rng, Surface, smoothstep } from '@zion/shared';
import { Simplex2 } from '../noise';
import { type Heightfield, seedNumber } from './heightfield';

export const TERRAIN_PRESETS = [
  { id: 'tectonic', name: 'Kiến tạo (dãy núi thật)', maxHeight: 360, roughness: .55, detail: 6 },
  { id: 'plains', name: 'Đồng bằng', maxHeight: 40, roughness: .35, detail: 4 },
  { id: 'hills', name: 'Đồi', maxHeight: 110, roughness: .5, detail: 5 },
  { id: 'mountains', name: 'Núi', maxHeight: 320, roughness: .62, detail: 6 },
  { id: 'valley', name: 'Thung lũng', maxHeight: 220, roughness: .55, detail: 5 },
  { id: 'island', name: 'Đảo', maxHeight: 180, roughness: .5, detail: 5 },
  { id: 'mixed', name: 'Hỗn hợp', maxHeight: 240, roughness: .55, detail: 6 },
] as const;
export type TerrainPreset = typeof TERRAIN_PRESETS[number]['id'];

/** Battlefield climate: what the ground, plants and rocks look like, and where things grow. */
export const CLIMATES = [
  { id: 'temperate', name: 'Ôn đới', tint: [1, 1, 1] },
  { id: 'arid', name: 'Khô hạn', tint: [1.1, 1.02, .84] },
  { id: 'desert', name: 'Sa mạc', tint: [1.18, 1.04, .78] },
  { id: 'snow', name: 'Tuyết phủ', tint: [.94, 1, 1.1] },
  { id: 'tropical', name: 'Nhiệt đới', tint: [.95, 1.06, .92] },
] as const;
export type Climate = typeof CLIMATES[number]['id'];
export const climateTint = (c: Climate | undefined) => CLIMATES.find((x) => x.id === c)?.tint ?? CLIMATES[0].tint;

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
  climate?: Climate;
  /** 0..1: hydraulic erosion after uplift (carves valleys and gullies, fills basins). */
  erosion?: number;
}

export const MAP_SIZES = [1024, 2048, 4096, 8192] as const;
/** Grid spacing per map size: always 1025² vertices (about 5 MB per map). */
export const cellFor = (size: number) => size / 1024;

export function defaultTerrainSettings(preset: TerrainPreset = 'tectonic', seed = 'zion', size = 4096): TerrainSettings {
  const p = TERRAIN_PRESETS.find((t) => t.id === preset)!;
  return { preset, seed, size, cell: cellFor(size), seaLevel: 20, maxHeight: p.maxHeight, roughness: p.roughness, detail: p.detail, seaEdge: preset === 'island' || preset === 'tectonic', climate: 'temperate', erosion: .6 };
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
  if (s.erosion !== undefined && !(s.erosion >= 0 && s.erosion <= 1)) issues.push('Mức xói mòn phải trong 0–1.');
  return issues;
}

/**
 * Tectonic plates: a handful of plates with their own motion. Where two plates converge the
 * crust is pushed up into long mountain ranges along the boundary (with foothills either side);
 * where they pull apart a rift valley opens. Continental plates sit high, oceanic ones low.
 */
class Plates {
  readonly seeds: Array<{ x: number; z: number; vx: number; vz: number; base: number }> = [];
  constructor(seed: string, count: number, oceanic: number) {
    const rng = new Rng(seedNumber(seed, 'plates'));
    for (let i = 0; i < count; i++) {
      const a = rng.next() * Math.PI * 2;
      this.seeds.push({ x: rng.next() * 1.2 - .1, z: rng.next() * 1.2 - .1, vx: Math.cos(a), vz: Math.sin(a), base: rng.next() < oceanic ? -.15 : .18 + rng.next() * .14 });
    }
  }
  /**
   * Uplift along convergent boundaries (0..1), rifting (≤0) and the plate's base level. Every
   * pair of plates adds the ridge of its own boundary and the bases blend by closeness, so the
   * ground is continuous everywhere — also where three plates meet (taking only the two nearest
   * plates left walls hundreds of metres high where the second-nearest one changed).
   */
  sample(u: number, v: number): { uplift: number; base: number } {
    const d = this.d, seeds = this.seeds, count = seeds.length;
    let min = Infinity;
    for (let i = 0; i < count; i++) { d[i] = (seeds[i]!.x - u) ** 2 + (seeds[i]!.z - v) ** 2; if (d[i]! < min) min = d[i]!; }
    const w = .07;
    let uplift = 0, base = 0, weights = 0;
    for (let i = 0; i < count; i++) {
      const A = seeds[i]!, ei = d[i]! - min;
      // Bases: a soft nearest plate (a shelf ≈ 300 m wide on a 4 km map, not a seam).
      const wi = Math.exp(-((ei / .14) ** 2));
      base += A.base * wi; weights += wi;
      for (let j = i + 1; j < count; j++) {
        const B = seeds[j]!, nx = B.x - A.x, nz = B.z - A.z, nl = Math.hypot(nx, nz) || 1;
        // Distance to the i–j boundary where those two plates are the nearest (exact there), and
        // growing away from it: continuous across every cell switch.
        const dist = (ei + d[j]! - min) / (2 * nl);
        if (dist > w * 9) continue;
        const converge = ((A.vx - B.vx) * nx + (A.vz - B.vz) * nz) / nl * .5;
        const near = Math.exp(-((dist / w) ** 2)), wide = Math.exp(-((dist / (w * 3)) ** 2));
        uplift += converge > 0 ? converge * (near * .85 + wide * .3) : converge * near * .35;
      }
    }
    // Where ranges cross they rise a little more, not twice as high.
    return { uplift: Math.tanh(uplift / 1.1) * 1.1, base: base / weights };
  }
  private readonly d = new Float64Array(16);
}

/** Multi-octave noise sampler for one seed. */
export class TerrainNoise {
  private readonly base: Simplex2;
  private readonly warp: Simplex2;
  private readonly mask: Simplex2;
  readonly plates: Plates;
  constructor(seed: string, oceanic = .3) {
    this.base = new Simplex2(seedNumber(seed, 'terrain'));
    this.warp = new Simplex2(seedNumber(seed, 'terrain-warp'));
    this.mask = new Simplex2(seedNumber(seed, 'terrain-mask'));
    this.plates = new Plates(seed, 9, oceanic);
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
  const k = s.size / 4096, o = Math.max(1, Math.min(s.detail, Math.floor(Math.log2(1024 / k / (4 * s.cell))) + 1)), p = .3 + s.roughness * .4;
  const [wx, wz] = n.warpOffset(u * 2, v * 2);
  const x = (u * 4 + wx * .35) * k, z = (v * 4 + wz * .35) * k;
  // Warped plate coordinates: boundaries bend like real ranges instead of running straight.
  const plate = n.plates.sample(u + wx * .05, v + wz * .05);
  const range = (scale: number) => Math.max(0, plate.uplift) * (.45 + .55 * n.ridged(x * 1.6, z * 1.6, o, p)) * scale;
  let h: number;
  switch (s.preset) {
    case 'tectonic': {
      // Continents and ocean shelves from the plates, ranges where they collide, rolling
      // foothills between, a light fbm for the small relief.
      h = plate.base + range(1.05) + Math.min(0, plate.uplift) * .5 + n.fbm(x * 1.2, z * 1.2, o, p) * .09 + n.fbm(x * .35, z * .35, 3, .5) * .1;
      break;
    }
    case 'plains': h = .18 + n.fbm(x * .6, z * .6, o, p) * .25 + range(.15); break;
    case 'hills': h = .35 + n.fbm(x, z, o, p) * .45 + range(.35); break;
    case 'mountains': h = .1 + range(.9) + n.ridged(x * .8, z * .8, o, p) * .35; break;
    case 'valley': {
      // A winding valley floor where a low-frequency line crosses zero, ridges either side.
      const line = Math.abs(n.low(u * 1.6 + wx * .3, v * 1.6 + wz * .3));
      h = .12 + (n.ridged(x * .7, z * .7, o, p) * .6 + range(.5)) * smoothstep(.04, .45, line) + n.fbm(x * 2, z * 2, 3, .5) * .04;
      break;
    }
    case 'island': h = .22 + n.fbm(x * .8, z * .8, o, p) * .3 + range(.75); break;
    default: {
      const m = n.low(u * 1.4, v * 1.4) * .5 + .5;
      const plains = .15 + n.fbm(x * .6, z * .6, o, p) * .2, hills = .3 + n.fbm(x, z, o, p) * .45;
      h = (m < .45 ? plains + (hills - plains) * smoothstep(.25, .45, m) : hills) + range(.8);
    }
  }
  if (s.seaEdge || s.preset === 'island') {
    // Distance to the edge, wobbled so the coast is not a square.
    // (A soft minimum: a hard one leaves a straight crease running in from each corner.)
    const k = .03, edge = -k * Math.log(Math.exp(-u / k) + Math.exp(-v / k) + Math.exp(-(1 - u) / k) + Math.exp(-(1 - v) / k)) + n.low(u * 3 + 7, v * 3 - 2) * .05;
    const cx = u - .5, cz = v - .5, radial = 1 - Math.hypot(cx, cz) * 2 + n.low(u * 2.5, v * 2.5) * .12;
    const land = s.preset === 'island' ? smoothstep(.0, .35, radial) : smoothstep(.02, .14, edge);
    h = h * land - (1 - land) * .12;
  } else if (h < .04) h = .04 * Math.exp((h - .04) * 6); // inland lows flatten out above the sea
  return h;
}

/** Fills `hf` row by row, yielding the fraction done (lets a worker report progress and cancel). */
export function* generateTerrain(s: TerrainSettings, hf: Heightfield): Generator<number, void> {
  const n = new TerrainNoise(s.seed, s.seaEdge ? .35 : .1), last = hf.cols - 1;
  const erosion = s.erosion ?? 0;
  for (let j = 0; j < hf.rows; j++) {
    for (let i = 0; i < hf.cols; i++) {
      const r = reliefAt(n, s, i / last, j / last);
      hf.heights[j * hf.cols + i] = r < 0 ? s.seaLevel + r * 120 : s.seaLevel + .8 + r * s.maxHeight;
    }
    if (j % 32 === 31) yield (j + 1) / hf.rows * (erosion ? .5 : .95);
  }
  if (erosion > 0) for (const f of erodeTerrain(hf, s.seaLevel, erosion, s.seed)) yield .5 + f * .45;
  autoPaint(hf, s.seaLevel, s.climate);
  yield 1;
}

/**
 * Whole-map hydraulic erosion (droplets, after Beyer 2015) followed by a thermal pass: rain
 * carves gullies and valleys down the mountains, sediment settles into the basins and plains,
 * and slopes steeper than the talus angle crumble. Deterministic for the seed.
 */
export function* erodeTerrain(hf: Heightfield, seaLevel: number, amount: number, seed: string): Generator<number, void> {
  // The shared erosion (Gaussian brush, slope-capped carving, eight-way scree): the same as the
  // generated worlds use.
  erodeGrid({ cols: hf.cols, rows: hf.rows, cell: hf.cell, heights: hf.heights }, { seed: seedNumber(seed, 'erosion'), seaLevel: seaLevel - 2, density: .35 * amount, talus: .85, thermalPasses: 20 });
  yield 1;
}

/**
 * Surfaces from height, slope and climate: the shore, cliffs, scree, valley floors and peaks
 * look like the climate they are in (green temperate valleys, sandstone desert, snowfields…).
 */
export function autoPaint(hf: Heightfield, seaLevel: number, climate: Climate = 'temperate', rect = { i0: 0, j0: 0, i1: hf.cols - 1, j1: hf.rows - 1 }): void {
  const c = hf.cell, stats = hf.stats(), top = Math.max(30, stats.max - seaLevel);
  for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
    const h = hf.get(i, j), rel = h - seaLevel, alt = rel / top;
    const slope = Math.hypot(hf.get(i + 1, j) - hf.get(i - 1, j), hf.get(i, j + 1) - hf.get(i, j - 1)) / (2 * c);
    // Hollows (lower than their surroundings) hold moisture: greener, muddier.
    const around = (hf.get(i + 4, j) + hf.get(i - 4, j) + hf.get(i, j + 4) + hf.get(i, j - 4)) / 4, hollow = around - h > .6;
    const speck = (i * 7 + j * 13) % 11 === 0;
    let s: Surface;
    if (rel < 2.5) s = climate === 'snow' ? Surface.Gravel : climate === 'tropical' && hollow ? Surface.Mud : Surface.Sand;
    else if (slope > .9) s = climate === 'desert' || climate === 'arid' ? Surface.Sandstone : Surface.Rock;
    else switch (climate) {
      case 'desert': s = slope > .45 ? Surface.Sandstone : alt > .7 ? Surface.Rock : hollow && speck ? Surface.Gravel : Surface.Sand; break;
      case 'arid': s = slope > .5 ? (alt > .5 ? Surface.Rock : Surface.Sandstone) : hollow ? Surface.DryGrass : alt > .55 ? Surface.Gravel : speck ? Surface.Sand : Surface.Dirt; break;
      case 'snow': s = slope > .55 ? Surface.Rock : alt < .12 && hollow ? Surface.Gravel : Surface.Snow; break;
      case 'tropical': s = slope > .55 ? Surface.Dirt : hollow ? Surface.JungleFloor : alt > .75 ? Surface.Rock : Surface.Grass; break;
      default:
        if (alt > .82) s = Surface.Snow;
        else if (slope > .55) s = alt > .45 ? Surface.Gravel : Surface.Dirt;
        else if (alt > .6) s = Surface.DryGrass;
        else s = speck && slope > .3 ? Surface.Dirt : Surface.Grass;
    }
    hf.surface[j * hf.cols + i] = s;
  }
}
