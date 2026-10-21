import { Surface, type Rng } from '@zion/shared';
import { SpatialGrid } from './geometry';
import type { BrushSettings } from './brushes';
import { brushWeight } from './brushes';
import type { Heightfield } from './heightfield';
import { waterLevelAt, type WaterData } from './water';

/** One hand-painted plant or rock: [asset, x, z, yaw, scale] (compact: maps hold tens of thousands). */
export type FloraItem = [number, number, number, number, number];
export const MAX_FLORA = 80000;

/** Every plant and rock model of the game's nature packs, by species (real asset ids). */
export const FLORA_SPECIES = [
  { id: 'broadleaf', name: 'Cây lá rộng', group: 'tree', assets: [2440, 2441, 2442, 2443, 2444] },
  { id: 'bigtree', name: 'Cây cổ thụ', group: 'tree', assets: [2445, 2446, 2447] },
  { id: 'forest', name: 'Cây rừng', group: 'tree', assets: [2600, 2601, 2602, 2603, 2604, 2605, 2606, 2607] },
  { id: 'oak', name: 'Sồi', group: 'tree', assets: [2608, 2609, 2610, 2611] },
  { id: 'pine', name: 'Thông', group: 'tree', assets: [2626, 2627, 2628, 2629, 2630, 2449, 2450] },
  { id: 'smallpine', name: 'Thông non', group: 'tree', assets: [2631, 2632, 2633, 2634, 2448] },
  { id: 'conifer', name: 'Tùng bách', group: 'tree', assets: [2451] },
  { id: 'palm', name: 'Chuối / nhiệt đới', group: 'tree', assets: [2473] },
  { id: 'dead', name: 'Cây chết', group: 'tree', assets: [2452, 2453] },
  { id: 'bush', name: 'Bụi cây', group: 'bush', assets: [2460, 2461, 2462] },
  { id: 'shrub', name: 'Cây bụi rừng', group: 'bush', assets: [2612, 2613, 2614, 2615, 2616, 2635] },
  { id: 'grass', name: 'Cỏ', group: 'grass', assets: [2640, 2641, 2642, 2644, 2645, 2646, 2647] },
  { id: 'meadow', name: 'Đồng cỏ hoa', group: 'grass', assets: [2650, 2651, 2648] },
  { id: 'reeds', name: 'Lau sậy', group: 'grass', assets: [2649, 2652] },
  { id: 'stone', name: 'Đá nhỏ', group: 'rock', assets: [2463, 2464, 2617, 2620, 2625] },
  { id: 'rock', name: 'Đá tảng', group: 'rock', assets: [2465, 2466, 2467, 2618, 2619, 2622, 2623] },
  { id: 'boulder', name: 'Đá lớn / vách', group: 'rock', assets: [2468, 2469, 2470, 2471, 2472] },
  // Blocky rocks (small, medium, large) per climate.
  { id: 'granite_blocks', name: 'Đá khối granite', group: 'rock', assets: [2760, 2761, 2762] },
  { id: 'sandstone_blocks', name: 'Đá khối sa thạch', group: 'rock', assets: [2763, 2764, 2765] },
  { id: 'basalt_blocks', name: 'Đá khối bazan', group: 'rock', assets: [2766, 2767, 2768] },
  { id: 'snow_blocks', name: 'Đá khối phủ tuyết', group: 'rock', assets: [2769, 2770, 2771] },
  { id: 'mossy_blocks', name: 'Đá khối phủ rêu', group: 'rock', assets: [2772, 2773, 2774] },
  { id: 'limestone_blocks', name: 'Đá khối vôi', group: 'rock', assets: [2775, 2776, 2777] },
] as const;
export type FloraSpecies = typeof FLORA_SPECIES[number]['id'];
export const floraGroup = new Map<number, string>(FLORA_SPECIES.flatMap((s) => s.assets.map((a) => [a, s.group] as [number, string])));

/** Painted biomes: a ground surface plus its plants and rocks, mixed in proportion. */
export const BIOMES = [
  { id: 'pine-forest', name: 'Rừng thông', surface: Surface.ForestFloor, density: .9, mix: [['pine', 5], ['smallpine', 3], ['shrub', 2], ['stone', .5], ['granite_blocks', .6]] },
  { id: 'broadleaf-forest', name: 'Rừng lá rộng', surface: Surface.ForestFloor, density: .9, mix: [['forest', 4], ['oak', 2], ['bigtree', 1], ['shrub', 3], ['grass', 2]] },
  { id: 'jungle', name: 'Rừng nhiệt đới', surface: Surface.JungleFloor, density: 1.2, mix: [['palm', 3], ['broadleaf', 3], ['bush', 4], ['reeds', 2], ['mossy_blocks', .7]] },
  { id: 'meadow', name: 'Đồng cỏ', surface: Surface.Grass, density: .7, mix: [['grass', 5], ['meadow', 4], ['bush', .6], ['broadleaf', .3]] },
  { id: 'scrub', name: 'Cây bụi khô', surface: Surface.DryGrass, density: .45, mix: [['bush', 3], ['dead', 1], ['stone', 2], ['grass', 2], ['sandstone_blocks', 1.2]] },
  { id: 'swamp', name: 'Đầm lầy', surface: Surface.Mud, density: .8, mix: [['reeds', 6], ['dead', 1.5], ['shrub', 2], ['mossy_blocks', .6]] },
  { id: 'rocky', name: 'Núi đá', surface: Surface.Rock, density: .35, mix: [['rock', 3], ['boulder', 1], ['stone', 3], ['conifer', .6], ['granite_blocks', 2], ['basalt_blocks', 1]] },
  { id: 'beach', name: 'Bãi cát', surface: Surface.Sand, density: .15, mix: [['palm', 1], ['stone', 2], ['reeds', .5], ['limestone_blocks', .8]] },
  { id: 'tundra', name: 'Tuyết', surface: Surface.Snow, density: .25, mix: [['conifer', 2], ['smallpine', 2], ['stone', 2], ['snow_blocks', 1.5]] },
] as const;
export type BiomeId = typeof BIOMES[number]['id'];

export interface FloraBrush {
  species: FloraSpecies[];
  /** Plants per 100 m² at the brush centre. */
  density: number;
  scaleMin: number;
  scaleMax: number;
  erase: boolean;
  biome: BiomeId;
}
export const DEFAULT_FLORA: FloraBrush = { species: ['broadleaf', 'bush'], density: .8, scaleMin: .8, scaleMax: 1.25, erase: false, biome: 'broadleaf-forest' };

const spacingOf = (group: string) => (group === 'tree' ? 4.5 : group === 'rock' ? 3 : group === 'bush' ? 2 : 1);
type Placed = { x: number; z: number; r: number };
export const floraGrid = (flora: readonly FloraItem[]) => {
  const g = new SpatialGrid<Placed>(16, (p) => p.r);
  for (const f of flora) g.insert({ x: f[1], z: f[2], r: spacingOf(floraGroup.get(f[0]) ?? 'tree') / 2 });
  return g;
};

/** Plants added by one brush dab (kept apart by kind, never in water, thinner at the brush edge). */
export function paintFlora(grid: SpatialGrid<Placed>, count: number, hf: Heightfield, water: WaterData, seaLevel: number, b: BrushSettings, mix: ReadonlyArray<readonly [string, number]>, fb: Pick<FloraBrush, 'density' | 'scaleMin' | 'scaleMax'>, x: number, z: number, rng: Rng): FloraItem[] {
  const out: FloraItem[] = [];
  const total = mix.reduce((a, [, w]) => a + w, 0);
  if (!total) return out;
  const tries = Math.min(400, Math.round(Math.PI * b.radius * b.radius / 100 * fb.density * .25) + 1);
  for (let k = 0; k < tries && count + out.length < MAX_FLORA; k++) {
    const a = rng.next() * Math.PI * 2, r = Math.sqrt(rng.next()) * b.radius, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (px < 0 || pz < 0 || px > hf.size || pz > hf.size || rng.next() > brushWeight(b, px - x, pz - z)) continue;
    let roll = rng.next() * total, id = mix[0]![0];
    for (const [s, w] of mix) if ((roll -= w) <= 0) { id = s; break; }
    const sp = FLORA_SPECIES.find((s) => s.id === id)!;
    const half = spacingOf(sp.group) / 2;
    if (grid.query(px, pz, half).length) continue;
    if (waterLevelAt(hf, water, seaLevel, px, pz) !== null || (sp.group === 'tree' && hf.slopeAt(px, pz) > .9)) continue;
    const asset = sp.assets[Math.floor(rng.next() * sp.assets.length)]!;
    const scale = Math.round((fb.scaleMin + rng.next() * (fb.scaleMax - fb.scaleMin)) * 100) / 100;
    out.push([asset, Math.round(px * 10) / 10, Math.round(pz * 10) / 10, Math.round(rng.next() * 628) / 100, scale]);
    grid.insert({ x: px, z: pz, r: half });
  }
  return out;
}

/** The flora left after erasing inside the brush (only the given species, if any). */
export function eraseFlora(flora: readonly FloraItem[], b: BrushSettings, x: number, z: number, only?: ReadonlySet<number>): FloraItem[] {
  return flora.filter((f) => brushWeight(b, f[1] - x, f[2] - z) <= .05 || (only !== undefined && !only.has(f[0])));
}
