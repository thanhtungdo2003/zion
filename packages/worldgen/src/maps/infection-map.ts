import { DEFAULT_INFECTION_MAP, Rng, Surface, hashString, smoothstep, type InfectionMapDef } from '@zion/shared';
import { CAMP_ASSET } from '@zion/assets';
import type { CampPart } from '../camp';
import type { Structure } from '../structures';
import { Simplex2 } from '../noise';
import { ISLAND_ASSET } from './authored';
import { F13, friday13Spawns, friday13Street, friday13Structures } from './friday13';

/**
 * An Infection map built from its Studio definition: walled play area centred in the world,
 * ground from the seed (rolling hills inside, steep banks outside), the built-in town when the
 * map is based on it, every hand-placed part, and seeded grass, trees, bushes and rocks.
 */
interface Host { readonly config: { infection?: InfectionMapDef }; readonly worldSize: number; readonly registry?: { byNumericId(n: number): { bounds: { radius: number } } | undefined } }

/** Ground height inside the walls. */
export const INFECTION_GROUND = F13.ground;

/**
 * The Warehouse map model (asset 2700), centred on the map. Its floor sits `sink` m above the
 * model's lowest point (pits and a sunken dock); the terrain under its footprint drops below them.
 */
export const WAREHOUSE = { asset: 2700, sink: 3.94, halfX: 37.2, halfZ: 39.1 } as const;
/** Open floor spots in the yard and halls (centre-relative). */
export const WAREHOUSE_SPAWNS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 5.3, z: -1.4 }, { x: -32.7, z: 34.6 }, { x: -32.7, z: -31.4 }, { x: 33.3, z: 32.6 }, { x: -32.7, z: 2.6 }, { x: 11.3, z: -31.4 },
  { x: 33.3, z: 2.6 }, { x: -12.7, z: 18.6 }, { x: -10.7, z: -29.4 }, { x: 23.3, z: -15.4 }, { x: -8.7, z: 34.6 }, { x: 1.3, z: -17.4 },
  { x: -10.7, z: 0.6 }, { x: 19.3, z: 6.6 }, { x: -30.7, z: 18.6 }, { x: 33.3, z: 18.6 }, { x: 11.3, z: -11.4 }, { x: 23.3, z: -3.4 },
  { x: -20.7, z: -31.4 }, { x: -0.7, z: -27.4 }, { x: 7.3, z: 8.6 }, { x: 13.3, z: -21.4 }, { x: -4.7, z: -7.4 }, { x: -2.7, z: 6.6 },
];

interface Prepared {
  def: InfectionMapDef;
  centre: number;
  noise: Simplex2;
  grassNoise: Simplex2;
  /** Hand-placed buildings the ground is levelled under: centre, reach, base height. */
  pads: Array<{ x: number; z: number; r: number; y: number }>;
  padGrid: Map<string, Array<{ x: number; z: number; r: number; y: number }>>;
  sites: Structure[] | null;
  /** What the map adds besides the hand-placed parts (centre-relative), for the Studio preview. */
  layers: { wall: CampPart[]; nature: CampPart[] };
  /** Footprint radius of an uploaded map model (m, scaled). */
  modelRadius: number;
}
const cache = new WeakMap<object, Prepared>();
const PAD_CELL = 32;

/** Footprint radius of a placed model (buildings get a levelled pad). */
const radiusOf = (host: Host, asset: number) => host.registry?.byNumericId(asset)?.bounds.radius ?? 1;

export function infectionMapOf(host: Host): InfectionMapDef {
  return host.config.infection ?? DEFAULT_INFECTION_MAP;
}

function prepared(host: Host): Prepared {
  let p = cache.get(host);
  if (p) return p;
  const def = infectionMapOf(host), seed = hashString(def.seed);
  p = { def, centre: host.worldSize / 2, noise: new Simplex2(seed ^ 0x51ab), grassNoise: new Simplex2(seed ^ 0x9a55), pads: [], padGrid: new Map(), sites: null, layers: { wall: [], nature: [] }, modelRadius: def.base === 'model' && def.model ? radiusOf(host, def.model.asset) * def.model.scale * .9 : 0 };
  // Raw ground at the pad centres first, then the pads level it.
  for (const part of def.parts) {
    const r = radiusOf(host, part.asset) * part.scale;
    if (r < 2.5) continue;
    const x = p.centre + part.x, z = p.centre + part.z;
    const pad = { x, z, r, y: rawHeight(p, x, z) };
    p.pads.push(pad);
    for (let gx = Math.floor((x - r - 8) / PAD_CELL); gx <= Math.floor((x + r + 8) / PAD_CELL); gx++)
      for (let gz = Math.floor((z - r - 8) / PAD_CELL); gz <= Math.floor((z + r + 8) / PAD_CELL); gz++) {
        const key = `${gx}:${gz}`; let list = p.padGrid.get(key); if (!list) p.padGrid.set(key, list = []); list.push(pad);
      }
  }
  cache.set(host, p);
  return p;
}

/** Ground before building pads: hills inside the walls (none on the built-in town), banks outside. */
function rawHeight(p: Prepared, x: number, z: number): number {
  const { def, centre } = p, d = Math.max(Math.abs(x - centre), Math.abs(z - centre));
  // Under the Warehouse model the ground drops below its pits: the model's own floor is walked on.
  if (def.base === 'warehouse' && Math.abs(x - centre) < WAREHOUSE.halfX - .5 && Math.abs(z - centre) < WAREHOUSE.halfZ - .5) return INFECTION_GROUND - WAREHOUSE.sink - .6;
  // An uploaded map model replaces the ground under it: the terrain drops just below the model's
  // lowest point there, so its own floors are what is walked on (no gap, no old ground poking up).
  if (def.base === 'model' && def.model && Math.hypot(x - centre, z - centre) < p.modelRadius) return INFECTION_GROUND + Math.min(0, def.model.y) - .6;
  let h = INFECTION_GROUND + smoothstep(def.half + 3, def.half + 24, d) * def.terrain.banks + smoothstep(def.half + 24, def.half + 80, d) * def.terrain.banks * .4;
  if (def.terrain.hills > 0 && def.base !== 'model') {
    const town = def.base === 'friday13' ? 1 - smoothstep(F13.half - 6, F13.half + 6, d) : 0;
    const edge = 1 - smoothstep(def.half - 10, def.half - 1, d);
    h += (p.noise.noise(x * .012, z * .012) * 4.5 + p.noise.noise(x * .04 + 9, z * .04) * 1.2) * def.terrain.hills * edge * (1 - town);
  }
  return h;
}

export function infectionHeight(host: Host, x: number, z: number): number {
  const p = prepared(host);
  let h = rawHeight(p, x, z);
  for (const pad of p.padGrid.get(`${Math.floor(x / PAD_CELL)}:${Math.floor(z / PAD_CELL)}`) ?? []) {
    const d = Math.hypot(x - pad.x, z - pad.z);
    if (d < pad.r + 8) h += (pad.y - h) * (1 - smoothstep(pad.r, pad.r + 8, d));
  }
  return h;
}

const SURFACE: Record<InfectionMapDef['environment']['ground'], Surface> = { dirt: Surface.Dirt, grass: Surface.Grass, gravel: Surface.Gravel, sand: Surface.Sand, asphalt: Surface.Asphalt, snow: Surface.Snow };

export function infectionInside(host: Host, x: number, z: number): boolean {
  const p = prepared(host);
  return Math.max(Math.abs(x - p.centre), Math.abs(z - p.centre)) < p.def.half;
}

/** Ground surface: streets of the built-in town, patches of grass, the chosen ground. */
export function infectionSurface(host: Host, x: number, z: number, slope: number): Surface {
  const p = prepared(host), def = p.def;
  if (!infectionInside(host, x, z)) return slope > .9 ? Surface.Rock : Surface.DryGrass;
  if (def.base === 'friday13' && friday13Street(x, z)) return Surface.BrokenAsphalt;
  const g = (p.grassNoise.noise(x * .05, z * .05) + 1) / 2;
  if (g < def.environment.grass) return Surface.Grass;
  if (def.base === 'friday13' && def.environment.ground === 'dirt') return (x * 7 + z * 13) % 11 < 3 ? Surface.Mud : Surface.Dirt;
  return SURFACE[def.environment.ground];
}

const WALL_ASSET = { concrete: CAMP_ASSET['concrete-wall'], mossy: CAMP_ASSET['mossy-concrete-wall'], stone: CAMP_ASSET['large-stone-brick-wall'] } as const;

/** Everything placed on the map, as world-space sites. */
export function infectionStructures(host: Host): Structure[] {
  const p = prepared(host);
  if (p.sites) return p.sites;
  const { def, centre } = p, sites: Structure[] = [];
  let gid = 1500;
  if (def.base === 'friday13') sites.push(...friday13Structures(host));
  if (def.base === 'warehouse') sites.push({ kind: 'ruined_camp', x: centre, z: centre, y: INFECTION_GROUND - WAREHOUSE.sink, yaw: 0, radius: Math.hypot(WAREHOUSE.halfX, WAREHOUSE.halfZ), parts: [{ asset: WAREHOUSE.asset, x: 0, y: 0, z: 0, yaw: 0, scale: 1, group: 0 }], gid: gid++ });
  // An uploaded map model, centred, its lowest point `y` above the map's ground.
  if (def.base === 'model' && def.model) sites.push({ kind: 'ruined_camp', x: centre, z: centre, y: INFECTION_GROUND + def.model.y, yaw: 0, radius: Math.max(1, radiusOf(host, def.model.asset) * def.model.scale), parts: [{ asset: def.model.asset, x: 0, y: 0, z: 0, yaw: def.model.yaw, scale: def.model.scale, group: 0 }], gid: gid++ });
  // Perimeter wall: 4 m panels scaled up, all one fading group.
  // (A map model is the whole map: no generated wall round it.)
  if (def.terrain.wall !== 'none' && def.base !== 'model') {
    const parts: CampPart[] = [], step = 4 * def.terrain.wallScale, asset = WALL_ASSET[def.terrain.wall];
    for (let o = -def.half + step / 2; o <= def.half - step / 2 + .01; o += step) for (const side of [-1, 1]) {
      parts.push({ asset, x: o, y: 0, z: side * def.half, yaw: 0, scale: def.terrain.wallScale, group: 1 });
      parts.push({ asset, x: side * def.half, y: 0, z: o, yaw: Math.PI / 2, scale: def.terrain.wallScale, group: 1 });
    }
    sites.push({ kind: 'ruined_camp', x: centre, z: centre, y: INFECTION_GROUND, yaw: 0, radius: def.half * 1.5, parts, gid: gid++ });
    p.layers.wall = parts;
  }
  // Hand-placed parts: one site each so every piece stands on its own ground.
  for (const [i, part] of def.parts.entries()) {
    const x = centre + part.x, z = centre + part.z;
    sites.push({ kind: 'ruined_camp', x, z, y: infectionHeight(host, x, z), yaw: 0, radius: 1, parts: [{ asset: part.asset, x: 0, y: part.y, z: 0, yaw: part.yaw, scale: part.scale, group: i + 1 }], gid: gid++ });
  }
  // Seeded nature, clear of the streets, the placed parts and the spawn points.
  const rng = new Rng(hashString(`${def.seed}:nature`)), area = (2 * def.half - 8) ** 2 / 10_000;
  const taken = def.parts.map((part) => ({ x: centre + part.x, z: centre + part.z, r: radiusOf(host, part.asset) * part.scale + 1.5 }));
  if (def.base === 'model') taken.push({ x: centre, z: centre, r: p.modelRadius });
  if (def.base === 'friday13') for (const s of sites) if (s.radius < 60) taken.push({ x: s.x, z: s.z, r: s.radius * .9 });
  const spawns = [...infectionSpawns(host), ...infectionZombieSpawns(host)];
  const nature: CampPart[] = [];
  const scatter = (count: number, pick: () => number, scale: () => number, clearance: number) => {
    for (let n = 0, tries = 0; n < count && tries < count * 20; tries++) {
      const x = centre + (rng.next() * 2 - 1) * (def.half - 4), z = centre + (rng.next() * 2 - 1) * (def.half - 4);
      if (def.base === 'friday13' && friday13Street(x, z)) continue;
      if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + clearance)) continue;
      if (spawns.some((s) => Math.hypot(s.x - x, s.z - z) < 3)) continue;
      nature.push({ asset: pick(), x: x - centre, y: 0, z: z - centre, yaw: rng.next() * Math.PI * 2, scale: scale() });
      taken.push({ x, z, r: clearance });
      n++;
    }
  };
  const one = <T>(list: readonly T[]) => list[Math.floor(rng.next() * list.length)]!;
  const env = def.environment;
  scatter(Math.round(env.trees * area), () => rng.next() < env.deadTrees ? one([ISLAND_ASSET.deadTree, ISLAND_ASSET.deadPine]) : one([...ISLAND_ASSET.treeSmall, ...ISLAND_ASSET.treeBig, ISLAND_ASSET.pineMedium, ISLAND_ASSET.conifer]), () => .8 + rng.next() * .5, 3);
  scatter(Math.round(env.bushes * area), () => one(ISLAND_ASSET.bush), () => .7 + rng.next() * .6, 1.2);
  scatter(Math.round(env.rocks * area), () => one([...ISLAND_ASSET.stone, ...ISLAND_ASSET.rockMedium]), () => .6 + rng.next() * .8, 1.5);
  p.layers.nature = nature;
  if (nature.length) sites.push({ kind: 'ruined_camp', x: centre, z: centre, y: INFECTION_GROUND, yaw: 0, radius: def.half * 1.5, parts: nature, gid: gid++ });
  return p.sites = sites;
}

const toWorld = (host: Host, list: Array<{ x: number; z: number; y?: number }>) => {
  const c = host.worldSize / 2;
  return list.map((s) => ({ x: c + s.x, z: c + s.z, ...(s.y !== undefined ? { y: s.y } : {}) }));
};

/** Human spawn points (world): as authored, else the town's, else a ring round the middle. */
export function infectionSpawns(host: Host): Array<{ x: number; z: number; y?: number }> {
  const def = infectionMapOf(host);
  if (def.spawns.length) return toWorld(host, def.spawns);
  if (def.base === 'friday13') return friday13Spawns();
  if (def.base === 'warehouse') return toWorld(host, [...WAREHOUSE_SPAWNS]);
  const c = host.worldSize / 2, out: Array<{ x: number; z: number }> = [];
  for (let ring = 1; ring <= 3; ring++) for (let k = 0; k < ring * 6; k++) {
    const a = k / (ring * 6) * Math.PI * 2, r = ring / 3.4 * (def.half - 6);
    out.push({ x: c + Math.cos(a) * r, z: c + Math.sin(a) * r });
  }
  return out;
}

/** Where zombies rise again (world): as authored, else the human spawns. */
export function infectionZombieSpawns(host: Host): Array<{ x: number; z: number; y?: number }> {
  const def = infectionMapOf(host);
  return def.zombieSpawns.length ? toWorld(host, def.zombieSpawns) : infectionSpawns(host);
}

/** Studio preview: the wall and the seeded nature (centre-relative), besides the placed parts. */
export function infectionLayers(host: Host): { wall: CampPart[]; nature: CampPart[] } {
  infectionStructures(host);
  return prepared(host).layers;
}
