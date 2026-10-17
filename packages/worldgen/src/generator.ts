import {
  Biome,
  CHUNK_SIZE,
  PROPS_MAX_LOD,
  Rng,
  Surface,
  clamp01,
  hashCombine,
  hashString,
  lodStep,
  lodVerts,
  quantizeHeight,
  smoothstep,
  type ChunkData,
  type PropInstance,
} from '@zion/shared';
import type { AssetRegistry } from '@zion/assets';
import { parseWorldConfig, type WorldConfig, type WorldConfigInput } from './config';
import { WorldFields, makeBaseSample, type BaseSample } from './fields';
import { Hydrology, type RiverQuery } from './hydrology';
import { CAMP_PAD, CAMP_BLEND, campDistance, campChunkProps, findCampSite, type CampSite } from './camp';
import { scatterChunkProps } from './scatter';
import { STRUCTURE_BLEND, insideStructure, structureChunkProps, structuresNear } from './structures';
import { RoadNetwork } from './roads';
import { authoredWorld } from './maps/authored';
import { F13, friday13Height, friday13Spawns, friday13Street } from './maps/friday13';

export const enum WaterKind {
  None = 0,
  River = 1,
  Lake = 2,
  Sea = 3,
}

/** Everything known about one terrain column. */
export interface ColumnSample {
  height: number;
  /** Inland water surface (rivers/lakes) or NaN. Sea is implicit: height < seaLevel. */
  water: number;
  waterKind: WaterKind;
  temperature: number;
  humidity: number;
  /** 0..1 strength of river influence (1 = in channel). */
  river: number;
  base: BaseSample;
  roadDistance: number;
  roadHeight: number;
  roadAlong: number;
  roadBridge: boolean;
  roadHalfWidth: number;
  roadBridgeEnd: number;
  roadPaved: boolean;
}

export function makeColumnSample(): ColumnSample {
  return {
    height: 0,
    water: Number.NaN,
    waterKind: WaterKind.None,
    temperature: 0,
    humidity: 0,
    river: 0,
    base: makeBaseSample(),
    roadDistance: Infinity,
    roadHeight: 0,
    roadAlong: 0,
    roadBridge: false,
    roadHalfWidth: 2.4,
    roadBridgeEnd: Infinity,
    roadPaved: false,
  };
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Deterministic seed-based world generator. Construction runs global hydrology once; afterwards
 * any chunk at any LOD can be generated independently and in any order with identical results.
 */
export class WorldGenerator {
  readonly config: WorldConfig;
  readonly camp: CampSite | null = null;
  readonly worldSize: number;
  readonly seaLevel: number;
  readonly fields: WorldFields;
  readonly hydrology: Hydrology;
  private readonly rq: RiverQuery = { dist: 0, halfWidth: 0, surface: 0, depth: 0 };
  private readonly scratch = makeColumnSample();
  private roadNetwork: RoadNetwork | null = null;
  get roads(): RoadNetwork | null {
    if (this.config.generatorVersion < 3 || this.rawTerrain) return null;
    return this.roadNetwork ??= new RoadNetwork(this);
  }

  constructor(
    input: WorldConfigInput,
    readonly registry: AssetRegistry,
  ) {
    this.config = parseWorldConfig(input);
    this.worldSize = this.config.sizeChunks * CHUNK_SIZE;
    this.seaLevel = this.config.seaLevel;
    this.fields = new WorldFields(this.config.seed, this.worldSize, this.config.generatorVersion >= 3 ? .42 : 1);
    this.hydrology = new Hydrology(this.fields, this.worldSize, this.seaLevel);
    if ((this.config.mode ?? 'survival') === 'survival' && this.config.generatorVersion >= 2) this.camp = findCampSite(this);
    this.rawTerrain = false;
  }

  /**
   * True while terrain is probed for site selection (camp, structures): structure pads are not
   * applied then, so choosing a site never depends on structures themselves.
   */
  rawTerrain = true;

  get seed(): number {
    return this.config.seed;
  }

  /** One-way derived seed for cosmetic client effects (never reveals the world seed). */
  get cosmeticSeed(): number {
    return hashCombine(this.config.seed, hashString('cosmetic'));
  }

  /* --------------------------------- column sampling -------------------------------------- */

  sampleColumn(x: number, z: number, out: ColumnSample = makeColumnSample()): ColumnSample {
    if (this.config.mode === 'infection') {
      this.fields.base(x, z, out.base);
      out.height = friday13Height(x, z); out.water = NaN; out.waterKind = WaterKind.None;
      out.river = 0; out.temperature = .45; out.humidity = .6;
      out.roadDistance = Infinity; out.roadBridge = false; out.roadPaved = false;
      return out;
    }
    if (this.config.mode === 'battle-royale') {
      const roads = this.roads, world = authoredWorld(this);
      this.fields.base(x, z, out.base);
      // Districts sit on levelled pads that blend into the natural ground.
      const height = world.levelled(x, z);
      out.height = height; out.water = NaN; out.waterKind = height < this.seaLevel ? WaterKind.Sea : WaterKind.None;
      out.river = 0; out.temperature = .6; out.humidity = .5;
      out.roadDistance = Infinity; out.roadBridge = false; out.roadPaved = false;
      if (roads) { roads.query(x, z, out); out.height += (out.roadHeight - out.height) * roads.blend(out); }
      return out;
    }
    const roads = this.roads;
    const b = this.fields.base(x, z, out.base);
    const sea = this.seaLevel;
    const macro = sea + b.rel;
    const rq = this.rq;
    const hasRiver = this.hydrology.riverAt(x, z, rq);
    const lake = this.hydrology.lakeLevelNear(x, z);

    let river = 0;
    if (hasRiver) {
      const bank = 3 + rq.halfWidth * 0.8;
      river = 1 - smoothstep(rq.halfWidth, rq.halfWidth + bank + 4, rq.dist);
    }
    const damp = (1 - river) * (lake === lake ? 0.25 : 1);
    let h = macro + this.fields.detail(x, z, b.mountain) * damp;

    let water = Number.NaN;
    let kind = WaterKind.None;
    if (hasRiver) {
      const hw = rq.halfWidth;
      const surf = rq.surface;
      const bank = 3 + hw * 0.8;
      if (rq.dist < hw) {
        const u = rq.dist / hw;
        const bed = surf - 0.15 - rq.depth * (1 - u * u);
        if (bed < h) h = bed;
      } else if (rq.dist < hw + bank) {
        const t = smoothstep(0, 1, (rq.dist - hw) / bank);
        const target = surf - 0.15 + (h - (surf - 0.15)) * t;
        if (target < h) h = target;
      }
      if (rq.dist < hw + 1.5 && surf > h) {
        water = surf;
        kind = WaterKind.River;
      }
    }
    if (lake === lake && lake > h && !(water >= lake)) {
      water = lake;
      kind = WaterKind.Lake;
    }
    if (kind === WaterKind.None && h < sea) kind = WaterKind.Sea;

    out.roadDistance = Infinity; out.roadHeight = 0; out.roadAlong = 0;
    out.roadBridge = false; out.roadHalfWidth = 2.4; out.roadBridgeEnd = Infinity;
    out.roadPaved = false;
    if (roads) {
      roads.query(x, z, out);
      h += (out.roadHeight - h) * roads.blend(out);
      // Dry abutments ease under the deck, avoiding a vertical heightfield edge at its lip.
      // Wet columns keep their original riverbed and water surface.
      if (out.roadBridge && out.roadBridgeEnd < 4 && h > (Number.isFinite(water) ? water : sea) + .15) {
        const improved = this.config.generatorVersion >= 6;
        // Stay a few centimetres below the quantized deck so its flat collider wins ray ties.
        const target = out.roadHeight - (improved ? .04 : .15 * out.roadBridgeEnd);
        const across = improved ? 1 - smoothstep(out.roadHalfWidth, out.roadHalfWidth + 2, out.roadDistance) : 1;
        h += (target - h) * (1 - smoothstep(2, 4, out.roadBridgeEnd)) * across;
      }
      if (h >= sea && (!Number.isFinite(water) || h >= water + .05)) { water = NaN; kind = WaterKind.None; }
    }

    if (this.camp) {
      const d = campDistance(this.camp, x, z);
      if (d < CAMP_PAD + CAMP_BLEND) {
        const blend = 1 - smoothstep(CAMP_PAD, CAMP_PAD + CAMP_BLEND, d);
        h += (this.camp.y - h) * blend;
        if (d <= CAMP_PAD) { water = Number.NaN; kind = WaterKind.None; river = 0; }
      }
    }
    // Abandoned structures sit on levelled pads that blend into the surrounding ground.
    if (!this.rawTerrain) {
      for (const s of structuresNear(this, x, z, STRUCTURE_BLEND)) {
        const d = Math.hypot(x - s.x, z - s.z);
        const blend = 1 - smoothstep(s.radius, s.radius + STRUCTURE_BLEND, d);
        h += (s.y - h) * blend;
      }
    }
    out.height = h;
    out.water = water;
    out.waterKind = kind;
    out.river = river;
    out.temperature = clamp01(b.tempBase - (Math.max(0, h - sea - 8) / 260) * 0.55);
    out.humidity = clamp01(b.humBase + 0.22 * this.hydrology.proximityAt(x, z));
    return out;
  }

  heightAt(x: number, z: number): number {
    return this.sampleColumn(x, z, this.scratch).height;
  }

  /** Biome for a sampled column. `slope` is rise/run. */
  classifyBiome(s: ColumnSample, slope: number): Biome {
    const rel = s.height - this.seaLevel;
    if (s.water === s.water && s.water > s.height) return s.waterKind === WaterKind.Lake ? Biome.Lake : Biome.River;
    if (rel < 0) return Biome.Ocean;
    const b = s.base;
    if (rel > 165 || (b.mountain > 0.55 && rel > 80) || (b.mountain > 0.35 && slope > 1.1 && rel > 40)) {
      return rel > 215 || (rel > 140 && s.temperature < 0.14) ? Biome.SnowPeaks : Biome.Mountain;
    }
    if (b.c < 0.07 && rel < 3.5 && s.river < 0.3) return Biome.Coast;
    if (b.swamp > 0.45 && rel < 7) return Biome.Swamp;
    const T = s.temperature;
    const H = s.humidity;
    if (T < 0.34) return H > 0.36 ? Biome.SpruceForest : Biome.Plains;
    if (T < 0.6) return H > 0.5 ? Biome.Forest : Biome.Plains;
    if (H < 0.4) return Biome.Desert;
    if (H < 0.58) return Biome.Plains;
    return Biome.Jungle;
  }

  classifySurface(s: ColumnSample, biome: Biome, slope: number, x: number, z: number): Surface {
    const rel = s.height - this.seaLevel;
    switch (biome) {
      case Biome.Ocean:
        return rel > -3 ? Surface.Sand : Surface.Seabed;
      case Biome.River:
        return Surface.Gravel;
      case Biome.Lake:
        return s.water - s.height < 1.2 ? Surface.Sand : Surface.Mud;
      default:
        break;
    }
    if (slope > 1.05 && biome !== Biome.Desert) return Surface.Rock;
    // River banks: gravel / dirt just above the waterline.
    if (s.river > 0.55) {
      return this.fields.patchNoise(x, z) > 0 ? Surface.Gravel : Surface.Dirt;
    }
    const patch = this.fields.patchNoise(x, z);
    switch (biome) {
      case Biome.SnowPeaks:
        return slope > 0.8 ? Surface.Rock : Surface.Snow;
      case Biome.Mountain:
        if (slope > 0.6) return Surface.Rock;
        if (rel > 150 || patch > 0.35) return Surface.Gravel;
        return s.temperature < 0.3 ? Surface.ForestFloor : Surface.Grass;
      case Biome.Coast:
        return slope > 0.5 ? Surface.Rock : Surface.Sand;
      case Biome.Desert:
        return slope > 0.42 ? Surface.Sandstone : patch > 0.55 ? Surface.Dirt : Surface.Sand;
      case Biome.Swamp:
        return patch > 0.1 ? Surface.Mud : Surface.Grass;
      case Biome.Jungle:
        return slope > 0.7 ? Surface.Dirt : Surface.JungleFloor;
      case Biome.SpruceForest:
        if (slope > 0.7) return Surface.Rock;
        return s.temperature < 0.1 && patch > -0.2 ? Surface.Snow : patch > 0.45 ? Surface.Grass : Surface.ForestFloor;
      case Biome.Forest:
        if (slope > 0.7) return Surface.Dirt;
        return patch > 0.15 ? Surface.Grass : Surface.ForestFloor;
      case Biome.Plains:
      default:
        if (slope > 0.7) return Surface.Dirt;
        return s.humidity < 0.38 || s.temperature > 0.62 ? Surface.DryGrass : patch > 0.6 ? Surface.Dirt : Surface.Grass;
    }
  }

  /** Slope (rise/run) at (x,z) using two extra samples at `step` metres. */
  slopeAt(x: number, z: number, h: number, step = 1): number {
    const hx = this.sampleColumn(x + step, z, this.scratch).height;
    const hz = this.sampleColumn(x, z + step, this.scratch).height;
    const gx = (hx - h) / step;
    const gz = (hz - h) / step;
    return Math.sqrt(gx * gx + gz * gz);
  }

  /* --------------------------------- chunk generation ------------------------------------- */

  inWorld(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.config.sizeChunks && cz < this.config.sizeChunks;
  }

  generateChunk(cx: number, cz: number, lod: number): ChunkData {
    const n = lodVerts(lod);
    const step = lodStep(lod);
    const N = n + 2;
    const ox = cx * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;
    const hf = new Float64Array(N * N);
    const heights = new Uint16Array(N * N);
    const water = new Uint16Array(n * n);
    const biome = new Uint8Array(n * n);
    const surface = new Uint8Array(n * n);
    const temperature = new Uint8Array(n * n);
    const humidity = new Uint8Array(n * n);
    const cols: ColumnSample[] = new Array<ColumnSample>(n * n);
    const battle = this.config.mode === 'battle-royale' ? authoredWorld(this) : null;

    for (let j = -1; j <= n; j++) {
      for (let i = -1; i <= n; i++) {
        const inner = i >= 0 && j >= 0 && i < n && j < n;
        const s = inner ? makeColumnSample() : this.scratch;
        this.sampleColumn(ox + i * step, oz + j * step, s);
        const k = (j + 1) * N + (i + 1);
        hf[k] = s.height;
        heights[k] = quantizeHeight(s.height);
        if (inner) cols[j * n + i] = s;
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const s = cols[j * n + i]!;
        const k = (j + 1) * N + (i + 1);
        const gx = (hf[k + 1]! - hf[k - 1]!) / (2 * step);
        const gz = (hf[k + N]! - hf[k - N]!) / (2 * step);
        const slope = Math.sqrt(gx * gx + gz * gz);
        const x = ox + i * step;
        const z = oz + j * step;
        if (this.config.mode === 'infection') {
          const idx = j * n + i, inside = Math.max(Math.abs(x - F13.centre), Math.abs(z - F13.centre)) < F13.half;
          biome[idx] = inside ? Biome.Plains : Biome.Mountain;
          surface[idx] = friday13Street(x, z) ? Surface.BrokenAsphalt : inside ? ((x * 7 + z * 13) % 11 < 3 ? Surface.Mud : Surface.Dirt) : slope > .9 ? Surface.Rock : Surface.DryGrass;
          temperature[idx] = Math.round(s.temperature * 255); humidity[idx] = Math.round(s.humidity * 255); water[idx] = 0;
          continue;
        }
        const b = battle ? battle.biome(s.height, slope, x, z) : this.classifyBiome(s, slope);
        const idx = j * n + i;
        biome[idx] = b;
        surface[idx] = this.camp && campDistance(this.camp, x, z) <= CAMP_PAD
          ? (Math.abs(x - this.camp.x) < 5 || Math.abs(z - this.camp.z - 30) < 3 ? Surface.Gravel : Surface.Dirt)
          : battle ? this.roads?.surface(s, x, z) ?? battle.surface(s.height, slope, x, z, battle.near(x, z, 0)[0])
          // From v7 a town's main street is paved right through it.
          : (this.config.generatorVersion >= 7 ? this.roads?.surface(s, x, z) : null) ?? (insideStructure(this, x, z, 0) ? Surface.Dirt : this.roads?.surface(s, x, z) ?? this.classifySurface(s, b, slope, x, z));
        temperature[idx] = Math.round(s.temperature * 255);
        humidity[idx] = Math.round(s.humidity * 255);
        water[idx] = s.water === s.water ? quantizeHeight(s.water) : 0;
      }
    }

    const props: PropInstance[] = lod > PROPS_MAX_LOD || this.config.mode === 'infection' ? [] : battle ? battle.chunkProps(cx, cz, (x, z) => {
      const g = this.sampleColumn(x, z, this.scratch), height = g.height, road = g.roadDistance - (g.roadHalfWidth ?? 2.4);
      return { height, slope: this.slopeAt(x, z, height, 1.5), road };
    }) : scatterChunkProps(this, cx, cz);
    if (this.camp && lod <= PROPS_MAX_LOD) props.push(...campChunkProps(this.camp, cx, cz));
    if (lod <= PROPS_MAX_LOD) props.push(...structureChunkProps(this, cx, cz));
    if (lod <= PROPS_MAX_LOD) props.push(...this.roads?.chunkProps(cx, cz) ?? []);
    return {
      cx,
      cz,
      lod,
      verts: n,
      heights,
      water,
      biome,
      surface,
      temperature,
      humidity,
      props,
      cosmeticSeed: hashCombine(this.cosmeticSeed, (cx & 0xffff) | (cz << 16)),
    };
  }

  /* ------------------------------------- spawns ------------------------------------------- */

  /**
   * Deterministic list of candidate spawn points on walkable, dry, low land, spread apart.
   * The server re-validates each against collision before use.
   */
  findSpawnPoints(count: number, minSpacing = 180): SpawnPoint[] {
    if (this.config.mode === 'infection') return friday13Spawns().slice(0, count).map((p) => ({ ...p, y: friday13Height(p.x, p.z) }));
    const rng = new Rng(hashCombine(this.seed, hashString('spawn')));
    const out: SpawnPoint[] = [];
    const s = makeColumnSample();
    const margin = this.worldSize * 0.08;
    const ok = new Set<Biome>([Biome.Plains, Biome.Forest, Biome.Coast, Biome.SpruceForest, Biome.Jungle]);
    for (let attempt = 0; attempt < 20000 && out.length < count; attempt++) {
      const x = margin + rng.next() * (this.worldSize - 2 * margin);
      const z = margin + rng.next() * (this.worldSize - 2 * margin);
      this.sampleColumn(x, z, s);
      const rel = s.height - this.seaLevel;
      if (rel < 1.5 || rel > 70 || s.water === s.water) continue;
      const slope = this.slopeAt(x, z, s.height);
      if (slope > 0.3) continue;
      if (!ok.has(this.classifyBiome(s, slope))) continue;
      if (out.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < minSpacing * minSpacing)) continue;
      out.push({ x, y: s.height, z });
    }
    return out;
  }
}
