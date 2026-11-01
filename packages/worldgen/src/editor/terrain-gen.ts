import { erodeGrid } from '../erosion';
import { Surface } from '@zion/shared';
import { type Heightfield, seedNumber } from './heightfield';
import { buildHydrology } from './hydro';
import { LANDFORM_STYLES, buildLandform } from './landform';
import { rasterizeWater, type WaterData } from './water';

export const TERRAIN_PRESETS = [
  { id: 'tectonic', name: 'Địa chất (dãy núi, sông ngòi thật)', maxHeight: 360, roughness: .55, detail: 6 },
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
 * Fills `hf` (heights and surfaces) and, when `out` is given, the lakes and rivers that drain it,
 * yielding the fraction done (lets a worker report progress and cancel). The landform comes from
 * a geological model (landform.ts: outline, ranges, stream-power erosion), is worn by rain
 * (droplets) and scree, and is drained (hydro.ts: basins, lakes, rivers cut into the ground):
 * terrain and water are one data set, and the game receives both.
 */
export function* generateTerrain(s: TerrainSettings, hf: Heightfield, out?: { water?: WaterData; lakes?: number; rivers?: number }): Generator<number, void> {
  const island = s.seaEdge || s.preset === 'island';
  const style = LANDFORM_STYLES[s.preset] ?? LANDFORM_STYLES.tectonic!;
  // (Without a sea the land drains off the map's edges, kept well above the sea level.)
  const input = { seed: s.seed, size: s.size, seaLevel: island ? s.seaLevel : s.seaLevel + 8, maxHeight: s.maxHeight, roughness: s.roughness, detail: s.detail, island, style };
  for (const f of buildLandform(input, hf)) yield f * .5;
  const erosion = s.erosion ?? 0;
  if (erosion > 0) for (const f of erodeTerrain(hf, s.seaLevel, erosion, s.seed)) yield .5 + f * .2;
  // Lakes: as many as asked (an automatic map's count), else one to three by seed.
  const lakes = out?.lakes ?? 1 + seedNumber(s.seed, 'lakes') % 3;
  const hydro = buildHydrology(hf, { seed: s.seed, seaLevel: s.seaLevel, maxHeight: s.maxHeight, minLakes: lakes, maxLakes: lakes + 2, maxRivers: out?.rivers });
  let r = hydro.next();
  while (!r.done) { yield .7 + r.value * .25; r = hydro.next(); }
  if (out) out.water = r.value.water;
  autoPaint(hf, s.seaLevel, s.climate, undefined, r.value.water);
  yield 1;
}

/**
 * Whole-map hydraulic erosion (droplets, after Beyer 2015) followed by a thermal pass: rain
 * carves gullies and valleys down the mountains, sediment settles into the basins and plains,
 * and slopes steeper than the talus angle crumble. Deterministic for the seed.
 */
export function* erodeTerrain(hf: Heightfield, seaLevel: number, amount: number, seed: string): Generator<number, void> {
  // The shared erosion (Gaussian brush, slope-capped carving, eight-way scree): the same as the
  // generated worlds use. The valleys already come from the landform; the droplets add rills and
  // gullies of a few metres, so a fine grid (small map) gets fewer of them per cell.
  erodeGrid({ cols: hf.cols, rows: hf.rows, cell: hf.cell, heights: hf.heights }, { seed: seedNumber(seed, 'erosion'), seaLevel: seaLevel - 2, density: .25 * amount * Math.min(1, hf.cell / 4), talus: .85, thermalPasses: 20 });
  yield 1;
}

/**
 * Surfaces from height, slope, water and climate: beaches on the gentle shores and rock on the
 * steep ones, gravel beds and muddy banks along the rivers, sand and mud in the lakes, scree
 * below the cliffs, and the climate's own cover elsewhere (green temperate valleys, sandstone
 * desert, snowfields…).
 */
export function autoPaint(hf: Heightfield, seaLevel: number, climate: Climate = 'temperate', rect = { i0: 0, j0: 0, i1: hf.cols - 1, j1: hf.rows - 1 }, water?: WaterData): void {
  const c = hf.cell, stats = hf.stats(), top = Math.max(30, stats.max - seaLevel);
  // 2: under a lake or river, 1: on its banks (within ~3 m).
  let wet: Uint8Array | null = null;
  if (water && (water.lakes.length || water.rivers.length)) {
    const { level } = rasterizeWater(hf, water), reach = Math.max(1, Math.round(3 / c));
    wet = new Uint8Array(level.length);
    for (let k = 0; k < level.length; k++) if (level[k]! > hf.heights[k]!) wet[k] = 2;
    for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
      const k = j * hf.cols + i;
      if (wet[k]) continue;
      for (let dj = -reach; dj <= reach && !wet[k]; dj++) for (let di = -reach; di <= reach; di++) if (wet[hf.clampJ(j + dj) * hf.cols + hf.clampI(i + di)] === 2) { wet[k] = 1; break; }
    }
  }
  for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
    const k = j * hf.cols + i, h = hf.get(i, j), rel = h - seaLevel, alt = rel / top;
    const slope = Math.hypot(hf.get(i + 1, j) - hf.get(i - 1, j), hf.get(i, j + 1) - hf.get(i, j - 1)) / (2 * c);
    // Hollows (lower than their surroundings) hold moisture: greener, muddier.
    const around = (hf.get(i + 4, j) + hf.get(i - 4, j) + hf.get(i, j + 4) + hf.get(i, j - 4)) / 4, hollow = around - h > .6;
    const speck = (i * 7 + j * 13) % 11 === 0;
    let s: Surface;
    if (wet?.[k] === 2) s = slope > .5 ? Surface.Rock : climate === 'snow' ? Surface.Gravel : (i * 3 + j * 5) % 7 < 4 ? Surface.Gravel : Surface.Mud;
    else if (wet?.[k] === 1) s = slope > .7 ? Surface.Rock : climate === 'desert' ? Surface.Sand : climate === 'snow' ? Surface.Gravel : speck ? Surface.Gravel : Surface.Mud;
    else if (rel < 2.5) s = slope > .45 ? Surface.Rock : climate === 'snow' ? Surface.Gravel : climate === 'tropical' && hollow ? Surface.Mud : Surface.Sand;
    else if (slope > .9) s = climate === 'desert' || climate === 'arid' ? Surface.Sandstone : Surface.Rock;
    // Scree: loose stone at the foot of the faces.
    else if (slope > .62 && alt > .3) s = climate === 'desert' || climate === 'arid' ? Surface.Sandstone : climate === 'snow' ? Surface.Rock : Surface.Gravel;
    else switch (climate) {
      case 'desert': s = slope > .45 ? Surface.Sandstone : alt > .7 ? Surface.Rock : hollow && speck ? Surface.Gravel : Surface.Sand; break;
      case 'arid': s = slope > .5 ? (alt > .5 ? Surface.Rock : Surface.Sandstone) : hollow ? Surface.DryGrass : alt > .55 ? Surface.Gravel : speck ? Surface.Sand : Surface.Dirt; break;
      case 'snow': s = slope > .55 ? Surface.Rock : alt < .12 && hollow ? Surface.Gravel : Surface.Snow; break;
      case 'tropical': s = slope > .55 ? Surface.Dirt : hollow ? Surface.JungleFloor : alt > .75 ? Surface.Rock : Surface.Grass; break;
      default:
        if (alt > .82 && slope < .7) s = Surface.Snow;
        else if (alt > .7) s = slope > .4 ? Surface.Rock : Surface.Gravel;
        else if (slope > .55) s = alt > .45 ? Surface.Gravel : Surface.Dirt;
        else if (alt > .55) s = Surface.DryGrass;
        else s = speck && slope > .3 ? Surface.Dirt : Surface.Grass;
    }
    hf.surface[k] = s;
  }
}
