import {
  type Biome,
  CHUNK_SIZE,
  Rng,
  hash3,
  lerp,
  quantizeHeight,
  quantizeLocal,
  quantizeRotation,
  quantizeScale,
  smoothstep,
  type PropInstance,
} from '@zion/shared';
import { CAMP_ASSET, type AssetDefinition, type PlacementLayer } from '@zion/assets';
import { makeColumnSample, type ColumnSample, type WorldGenerator } from './generator';
import { insideStructure } from './structures';
import { ISLAND_ASSET } from './maps/authored';
import { FLORA_ASSET, fromStand, standValue } from './flora';

/**
 * Placement layers, processed in order. Each layer scatters at most one candidate per world-aligned
 * grid cell. Because cells are aligned to the *world* (not the chunk) and each cell's RNG is keyed
 * by (seed, cell, layer), results are independent of chunk boundaries, LOD and generation order.
 *
 * Future layers (settlements, roads, military bases) plug in before natural scatter and reserve
 * footprints that natural layers must avoid.
 */
interface LayerSpec {
  layer: PlacementLayer;
  cell: number;
  salt: number;
}

const LAYERS: readonly LayerSpec[] = [
  { layer: 'decor', cell: 16, salt: 0x44 },
  { layer: 'rocks', cell: 7, salt: 0x33 },
  { layer: 'trees', cell: 4, salt: 0x11 },
  { layer: 'shrubs', cell: 3, salt: 0x22 },
];

const MAX_ACCEPT = 0.95;

interface Candidate {
  x: number;
  z: number;
  sample: ColumnSample;
  slope: number;
  biome: Biome;
  /** Lazily computed: is any water within `r` metres? */
  waterWithin: (r: number) => boolean;
}

export function scatterChunkProps(gen: WorldGenerator, cx: number, cz: number): PropInstance[] {
  const out: PropInstance[] = [];
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;
  const seed = gen.seed;
  const sample = makeColumnSample();
  const probe = makeColumnSample();
  const weights: number[] = [];
  // Only imported models: procedural trees, bushes and rocks are swapped for the island's.
  const flora = true;

  for (const spec of LAYERS) {
    const assets = gen.registry.layer(spec.layer);
    if (assets.length === 0) continue;
    const cell = spec.cell;
    const gx0 = Math.floor(ox / cell);
    const gx1 = Math.floor((ox + CHUNK_SIZE - 1e-6) / cell);
    const gz0 = Math.floor(oz / cell);
    const gz1 = Math.floor((oz + CHUNK_SIZE - 1e-6) / cell);
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const rng = new Rng(hash3(seed, gx, gz, spec.salt));
        const x = (gx + 0.1 + 0.8 * rng.next()) * cell;
        const z = (gz + 0.1 + 0.8 * rng.next()) * cell;
        if (x < ox || x >= ox + CHUNK_SIZE || z < oz || z >= oz + CHUNK_SIZE) continue;
        if (x < 4 || z < 4 || x > gen.worldSize - 4 || z > gen.worldSize - 4) continue;

        if (gen.camp && Math.max(Math.abs(x - gen.camp.x), Math.abs(z - gen.camp.z)) < 60) continue;
        // Nothing grows inside abandoned buildings and compounds.
        if (insideStructure(gen, x, z)) continue;
        gen.sampleColumn(x, z, sample);
        // Leave the carriageway clear; only low shrubs/decor may grow on the verge.
        if (sample.roadDistance < sample.roadHalfWidth + (spec.layer === 'trees' || spec.layer === 'rocks' ? 3.1 : .3)) continue;
        if (sample.height < gen.seaLevel - 1.5) continue; // open sea: nothing grows
        const slope = gen.slopeAt(x, z, sample.height);
        const biome = gen.classifyBiome(sample, slope);
        const nearWaterHint = sample.river > 0 || sample.height - gen.seaLevel < 4 || sample.water === sample.water;
        const cand: Candidate = {
          x,
          z,
          sample,
          slope,
          biome,
          waterWithin: (r: number) => {
            if (hasWater(gen, sample)) return true;
            if (!nearWaterHint && !lakeNearby(gen, x, z)) return false;
            if (r <= 0) return false;
            for (const [dx, dz] of PROBES) {
              gen.sampleColumn(x + dx * r, z + dz * r, probe);
              if (hasWater(gen, probe)) return true;
            }
            return false;
          },
        };

        const cluster = smoothstep(-0.4, 0.4, gen.fields.clusterNoise(x, z)) * 1.5;
        let total = 0;
        weights.length = 0;
        for (const a of assets) {
          const w = assetWeight(gen, a, cand, cluster);
          weights.push(w);
          total += w;
        }
        if (total <= 0) continue;
        const roll = rng.next();
        if (roll >= Math.min(total, MAX_ACCEPT)) continue;
        let pick = assets.length - 1;
        let acc = 0;
        const target = (roll / Math.min(total, MAX_ACCEPT)) * total;
        for (let k = 0; k < assets.length; k++) {
          acc += weights[k]!;
          if (target < acc) {
            pick = k;
            break;
          }
        }
        const def = assets[pick]!;
        const rule = def.placement!;
        const scale = lerp(rule.scale[0], rule.scale[1], rng.next());
        const rotY = rng.next() * Math.PI * 2;
        if (flora && def.model.kind === 'procedural') {
          // The same prepared trees, bushes and rocks as the battle-royale island.
          const swap = islandFlora(def.numericId, rng.next(), rng.next(), standValue(seed, x, z));
          // No imported counterpart (cactus, reeds): nothing grows there.
          if (!swap || (swap.thin && rng.next() < swap.thin)) continue;
          out.push({ asset: swap.asset, lx: quantizeLocal(x - ox), lz: quantizeLocal(z - oz), yq: quantizeHeight(sample.height - swap.sink), rot: quantizeRotation(rotY), scale: quantizeScale(swap.scale) });
          continue;
        }
        out.push({
          asset: def.numericId,
          lx: quantizeLocal(x - ox),
          lz: quantizeLocal(z - oz),
          yq: quantizeHeight(sample.height - rule.sink * scale),
          rot: quantizeRotation(rotY),
          scale: quantizeScale(scale),
        });
      }
    }
  }
  if (gen.config.generatorVersion >= 2) placeAmmoCaches(gen, ox, oz, sample, out);
  return out;
}

/**
 * The island model standing in for a procedural survival asset: species by the procedural kind
 * (conifers for spruce, broadleaves for oak…), sizes like the island's. `thin` drops a share of
 * candidates, since the island trees are fuller than the procedural ones.
 */
function islandFlora(id: number, species: number, size: number, stand: number): { asset: number; scale: number; sink: number; thin?: number } | null {
  // Species follow the local stand (neighbours mostly alike); size picks young or mature growth.
  const pick = (list: readonly number[]) => fromStand(list, stand, species);
  const tree = (asset: number) => ({ asset, scale: .75 + size * .5, sink: .25, thin: .35 });
  const young = size < .32;
  const conifers = young ? [ISLAND_ASSET.pineSmall, ...FLORA_ASSET.pineYoung] : [ISLAND_ASSET.pineMedium, ...FLORA_ASSET.pine, ISLAND_ASSET.pineBig, ISLAND_ASSET.conifer];
  const broadleaf = young ? [...ISLAND_ASSET.treeSmall, ...FLORA_ASSET.oakYoung] : [...ISLAND_ASSET.treeBig, ...FLORA_ASSET.forestTree, ...FLORA_ASSET.oakMature];
  // Undergrowth gathers under the canopy; boulders lie half buried.
  const shrubs = [...ISLAND_ASSET.bush, ...FLORA_ASSET.shrub, FLORA_ASSET.sapling];
  switch (id) {
    case 1: return tree(pick(conifers));
    case 2: case 4: case 7: return tree(pick(broadleaf));
    case 3: return tree(pick([...ISLAND_ASSET.treeSmall, ...FLORA_ASSET.oakYoung]));
    case 5: return tree(ISLAND_ASSET.banana);
    case 6: return tree(species < .5 ? ISLAND_ASSET.deadTree : ISLAND_ASSET.deadPine);
    case 9: return { asset: pick(shrubs), scale: .7 + size * .5, sink: .1 };
    case 10: return { asset: pick(shrubs), scale: .55 + size * .35, sink: .1, thin: .3 };
    case 20: return { asset: pick([...ISLAND_ASSET.stone, ...FLORA_ASSET.rockSmall]), scale: .6 + size * .6, sink: .3 };
    case 21: return { asset: pick([...ISLAND_ASSET.rockMedium, ...FLORA_ASSET.rockMedium]), scale: .6 + size * .6, sink: .45 };
    case 22: return { asset: pick([...ISLAND_ASSET.rockBig, ...FLORA_ASSET.rockBig]), scale: .6 + size * .5, sink: .55 };
    default: return null;
  }
}

/** One ammo cache station per world cell (at most), on dry, flat ground away from the camp. */
const CACHE_CELL = 192;
const CACHE_SALT = 0x5a;

function placeAmmoCaches(gen: WorldGenerator, ox: number, oz: number, sample: ColumnSample, out: PropInstance[]): void {
  const gx0 = Math.floor(ox / CACHE_CELL), gx1 = Math.floor((ox + CHUNK_SIZE - 1e-6) / CACHE_CELL);
  const gz0 = Math.floor(oz / CACHE_CELL), gz1 = Math.floor((oz + CHUNK_SIZE - 1e-6) / CACHE_CELL);
  for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
    const rng = new Rng(hash3(gen.seed, gx, gz, CACHE_SALT));
    if (rng.next() > 0.7) continue;
    const x = (gx + 0.2 + 0.6 * rng.next()) * CACHE_CELL;
    const z = (gz + 0.2 + 0.6 * rng.next()) * CACHE_CELL;
    const rotY = rng.next() * Math.PI * 2;
    if (x < ox || x >= ox + CHUNK_SIZE || z < oz || z >= oz + CHUNK_SIZE) continue;
    if (x < 16 || z < 16 || x > gen.worldSize - 16 || z > gen.worldSize - 16) continue;
    if (gen.camp && Math.max(Math.abs(x - gen.camp.x), Math.abs(z - gen.camp.z)) < 80) continue;
    if (insideStructure(gen, x, z, 4)) continue;
    gen.sampleColumn(x, z, sample);
    if (sample.roadDistance < sample.roadHalfWidth + 3.1) continue;
    if (sample.height < gen.seaLevel + 1 || hasWater(gen, sample) || gen.slopeAt(x, z, sample.height) > 0.35) continue;
    out.push({
      asset: CAMP_ASSET['zion-ammo-cache-station'],
      lx: quantizeLocal(x - ox),
      lz: quantizeLocal(z - oz),
      yq: quantizeHeight(sample.height),
      rot: quantizeRotation(rotY),
      scale: quantizeScale(1),
    });
  }
}

const PROBES: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.7071, 0.7071],
  [-0.7071, -0.7071],
];

function hasWater(gen: WorldGenerator, s: ColumnSample): boolean {
  return (s.water === s.water && s.water > s.height) || s.height < gen.seaLevel;
}

function lakeNearby(gen: WorldGenerator, x: number, z: number): boolean {
  const l = gen.hydrology.lakeLevelNear(x, z);
  return l === l;
}

function assetWeight(gen: WorldGenerator, def: AssetDefinition, c: Candidate, cluster: number): number {
  const rule = def.placement;
  if (!rule) return 0;
  const base = rule.biomes[c.biome] ?? 0;
  if (base <= 0) return 0;
  if (c.slope > rule.maxSlope) return 0;
  const rel = c.sample.height - gen.seaLevel;
  if (rel < rule.minAltitude || rel > rule.maxAltitude) return 0;
  const t = c.sample.temperature;
  if (t < rule.temperature[0] || t > rule.temperature[1]) return 0;
  if (rule.nearWater) {
    if (!c.waterWithin(rule.waterClearance)) return 0;
    // Shore plants may stand in shallow water but not deep water.
    const depth = c.sample.water === c.sample.water ? c.sample.water - c.sample.height : gen.seaLevel - c.sample.height;
    if (depth > 0.6) return 0;
  } else if (c.waterWithin(rule.waterClearance)) {
    return 0;
  }
  return base * lerp(1, cluster, rule.clustering);
}
