import { CHUNK_SIZE, Rng, Surface, Biome, hash3, smoothstep, quantizeHeight, quantizeLocal, quantizeRotation, quantizeScale, type PropInstance } from '@zion/shared';
import { BATTLE_ASSET, BRIDGE_ASSET, BUILDING_ASSET, CAMP_ASSET } from '@zion/assets';
import type { CampPart } from '../camp';
import type { Structure } from '../structures';
import { Simplex2 } from '../noise';
import { importedRoofAccess } from '../imported-buildings';
import { ISLAND, type AuthoredMap, type MapZone, type Point } from './island';
import { battleTower as guardTower, modularBuilding } from '../battle-map';

/** Prepared island assets (see apps/web/scripts/prepare-world-assets.mjs). */
export const ISLAND_ASSET = {
  // The TVA pack (2431) holds a row of pylon variants, not one pylon; poles use the camp utility pole.
  pylonTower: 2430, pylonHFrame: CAMP_ASSET['utility-pole'], crane: 2432,
  treeSmall: [2440, 2441, 2442, 2443, 2444], treeBig: [2445, 2446, 2447],
  pineSmall: 2448, pineMedium: 2449, pineBig: 2450, conifer: 2451, deadPine: 2452, deadTree: 2453,
  bush: [2460, 2461, 2462], stone: [2463, 2464], rockMedium: [2465, 2466, 2467], rockBig: [2468, 2469, 2470], cliff: [2471, 2472],
  banana: 2473,
} as const;

/** Where the cables hang on each pylon kind: height and offsets along the cross-arm. */
const PYLON = {
  tower: { asset: ISLAND_ASSET.pylonTower, height: 26.5, arms: [-3.4, 0, 3.4], armAxis: 'x' as const, scale: 1 },
  hframe: { asset: ISLAND_ASSET.pylonHFrame, height: 8.4, arms: [-1.9, 0, 1.9], armAxis: 'x' as const, scale: 1.5 },
};

export interface Pylon { x: number; z: number; yaw: number; kind: 'tower' | 'hframe' }
export interface PowerCable { kind: 'tower' | 'hframe'; points: Array<[number, number, number]> }
export interface MapArea { id: string; name: string; kind: MapZone['kind']; x: number; z: number; radius: number }

interface Host { readonly worldSize: number; readonly seaLevel: number; readonly seed: number; heightAt(x: number, z: number): number }

type GroundStructure = Structure & { ground?: Surface };

/**
 * A hand-authored map: terrain from a coastline and hills, a fixed road network, planned
 * districts built from the asset kit, a power grid and natural vegetation.
 */
export class AuthoredWorld {
  private readonly noise: Simplex2;
  private readonly forestNoise: Simplex2;
  private sites: GroundStructure[] | null = null;
  private readonly grid = new Map<string, GroundStructure[]>();
  private pylonList: Pylon[] | null = null;
  private readonly pylonChunks = new Map<string, PropInstance[]>();

  constructor(readonly map: AuthoredMap, readonly host: Host) {
    this.noise = new Simplex2(host.seed ^ 0x15a7d);
    this.forestNoise = new Simplex2(host.seed ^ 0xf0e57);
  }

  /* ------------------------------------------------------------------------------ terrain */

  /** Signed distance to the coastline: positive inland, negative at sea (m). */
  coastDistance(x: number, z: number): number {
    const poly = this.map.coast;
    let inside = false, best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, az] = poly[j]!, [bx, bz] = poly[i]!;
      if ((bz > z) !== (az > z) && x < (ax - bx) * (z - bz) / (az - bz) + bx) inside = !inside;
      const dx = ax - bx, dz = az - bz, len = dx * dx + dz * dz;
      const t = len ? Math.max(0, Math.min(1, ((x - bx) * dx + (z - bz) * dz) / len)) : 0;
      best = Math.min(best, Math.hypot(x - bx - dx * t, z - bz - dz * t));
    }
    // A gentle wobble keeps long straight edges from looking ruled.
    const wobble = this.noise.noise(x * .006, z * .006) * 22 + this.noise.noise(x * .025 + 40, z * .025) * 6;
    return (inside ? best : -best) + wobble;
  }

  /** Natural ground height before districts and roads level it. */
  terrain(x: number, z: number): number {
    const sea = this.host.seaLevel, d = this.coastDistance(x, z);
    if (d < 0) return sea - Math.min(34, 1.5 + -d * .09);
    let h = sea + .6 + 13 * smoothstep(0, 320, d) + 10 * smoothstep(250, 900, d);
    const inland = smoothstep(30, 260, d);
    for (const hill of this.map.hills) {
      const r2 = (x - hill.x) ** 2 + (z - hill.z) ** 2, s = hill.radius / 1.8;
      if (r2 < hill.radius * hill.radius * 4) h += hill.height * Math.exp(-r2 / (2 * s * s)) * inland;
    }
    // Rocky ridges on the high ground.
    const ridge = 1 - Math.abs(this.noise.noise(x * .0032 + 11, z * .0032 - 5));
    h += ridge * ridge * 38 * smoothstep(sea + 60, sea + 150, h);
    // Rolling detail grows away from the beaches.
    h += (this.noise.noise(x * .004, z * .004) * 7 + this.noise.noise(x * .013, z * .013) * 2.4 + this.noise.noise(x * .05, z * .05) * .6) * smoothstep(20, 400, d);
    return h;
  }

  /* --------------------------------------------------------------------------- districts */

  structures(): Structure[] {
    if (this.sites) return this.sites;
    const sites = this.sites = buildDistricts(this.map, this);
    for (const s of sites) {
      const r = s.radius + 20;
      for (let gx = Math.floor((s.x - r) / 64); gx <= Math.floor((s.x + r) / 64); gx++)
        for (let gz = Math.floor((s.z - r) / 64); gz <= Math.floor((s.z + r) / 64); gz++) {
          const key = `${gx}:${gz}`; let list = this.grid.get(key); if (!list) this.grid.set(key, list = []); list.push(s);
        }
    }
    return sites;
  }

  /** Distance from (x, z) to a site's pad (0 inside); rectangular pads follow the site yaw. */
  padDistance(s: Structure, x: number, z: number): number {
    const dx = x - s.x, dz = z - s.z;
    if (!s.halfX || !s.halfZ) return Math.max(0, Math.hypot(dx, dz) - s.radius);
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), lx = dx * c - dz * sn, lz = dx * sn + dz * c;
    return Math.hypot(Math.max(0, Math.abs(lx) - s.halfX), Math.max(0, Math.abs(lz) - s.halfZ));
  }

  /** Sites whose pad (plus `extra`) reaches (x, z). */
  near(x: number, z: number, extra = 0): GroundStructure[] {
    this.structures();
    const list = extra > 20 ? this.sites! : this.grid.get(`${Math.floor(x / 64)}:${Math.floor(z / 64)}`);
    if (!list) return [];
    return list.filter(s => this.padDistance(s, x, z) <= extra);
  }

  /** Natural ground levelled by the district pads that reach it. */
  levelled(x: number, z: number): number {
    let height = this.terrain(x, z);
    for (const site of this.near(x, z, 16)) height += (site.y - height) * (1 - smoothstep(0, 16, this.padDistance(site, x, z)));
    return height;
  }

  areas(): MapArea[] { return this.map.zones.map(({ id, name, kind, x, z, radius }) => ({ id, name, kind, x, z, radius })); }

  /* ---------------------------------------------------------------------------- the grid */

  pylons(): Pylon[] {
    if (this.pylonList) return this.pylonList;
    const out: Pylon[] = [];
    for (const line of this.map.power) {
      for (const [x, z, dx, dz] of along(line.points, line.spacing)) {
        const yaw = Math.atan2(dx, dz);
        out.push({ x, z, yaw, kind: line.kind });
      }
    }
    for (const p of out) {
      const def = PYLON[p.kind];
      const y = this.host.heightAt(p.x, p.z) - .1;
      const cx = Math.floor(p.x / CHUNK_SIZE), cz = Math.floor(p.z / CHUNK_SIZE), key = `${cx}:${cz}`;
      let list = this.pylonChunks.get(key); if (!list) this.pylonChunks.set(key, list = []);
      list.push({ asset: def.asset, lx: quantizeLocal(p.x - cx * CHUNK_SIZE), lz: quantizeLocal(p.z - cz * CHUNK_SIZE), yq: quantizeHeight(y), rot: quantizeRotation(p.yaw), scale: quantizeScale(def.scale) });
    }
    return this.pylonList = out;
  }

  /** Three conductors per line, attached at each pylon's cross-arm. */
  cables(): PowerCable[] {
    const pylons = this.pylons(), out: PowerCable[] = [];
    let index = 0;
    for (const line of this.map.power) {
      const count = along(line.points, line.spacing).length, run = pylons.slice(index, index + count);
      index += count;
      const def = PYLON[line.kind];
      for (const arm of def.arms) out.push({
        kind: line.kind,
        points: run.map(p => {
          const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
          // Local x → (cos, -sin); local z → (sin, cos).
          const [ox, oz] = def.armAxis === 'x' ? [arm * c, -arm * s] : [arm * s, arm * c];
          return [p.x + ox, this.host.heightAt(p.x, p.z) + def.height, p.z + oz];
        }),
      });
    }
    return out;
  }

  /* ---------------------------------------------------------------------------- surfaces */

  biome(height: number, slope: number, x: number, z: number): Biome {
    const rel = height - this.host.seaLevel;
    if (rel < 0) return Biome.Ocean;
    const d = this.coastDistance(x, z);
    if (d < 28 && rel < 4) return Biome.Coast;
    if (rel > 150 || (rel > 95 && slope > .7)) return Biome.Mountain;
    return this.forestDensity(x, z) > .45 ? (rel > 90 ? Biome.SpruceForest : Biome.Forest) : Biome.Plains;
  }

  surface(height: number, slope: number, x: number, z: number, site: GroundStructure | undefined): Surface {
    const rel = height - this.host.seaLevel;
    if (rel < -2.5) return Surface.Seabed;
    if (site?.ground !== undefined) {
      if (site.ground === Surface.Asphalt) {
        const patch = this.noise.noise(x * .09, z * .09);
        return patch > .45 ? Surface.MossyAsphalt : patch < -.5 ? Surface.BrokenAsphalt : Surface.Asphalt;
      }
      return site.ground;
    }
    if (site) return this.noise.noise(x * .2, z * .2) > .2 ? Surface.Dirt : Surface.Grass;
    const d = this.coastDistance(x, z);
    if (d < 26 && rel < 4) return slope > .6 ? Surface.Rock : Surface.Sand;
    if (slope > .95) return Surface.Rock;
    if (slope > .6) return rel > 80 ? Surface.Gravel : Surface.Dirt;
    const patch = this.noise.noise(x * .03 + 7, z * .03 - 3);
    if (rel > 140) return patch > 0 ? Surface.Gravel : Surface.DryGrass;
    if (this.forestDensity(x, z) > .5) return patch > .3 ? Surface.Grass : Surface.ForestFloor;
    return patch > .5 ? Surface.DryGrass : patch < -.6 ? Surface.Dirt : Surface.Grass;
  }

  /** 0..1: how wooded a spot is. */
  forestDensity(x: number, z: number): number {
    let woods = 0;
    // Woods edges are torn up by noise, so stands are irregular rather than round.
    const edge = this.forestNoise.noise(x * .008, z * .008) * .35;
    for (const f of this.map.forests) woods = Math.max(woods, 1 - smoothstep(f.radius * .35, f.radius * 1.1, Math.hypot(x - f.x, z - f.z) * (1 + edge)));
    const n = this.forestNoise.noise(x * .0045, z * .0045) * .45 + this.forestNoise.noise(x * .021, z * .021) * .22;
    return Math.max(0, Math.min(1, woods * .8 + n + .18));
  }

  /* ------------------------------------------------------------------------- vegetation */

  /** Trees, bushes and rocks for one chunk, plus the pylons standing in it. */
  chunkProps(cx: number, cz: number, ground: (x: number, z: number) => { height: number; slope: number; road: number }): PropInstance[] {
    this.pylons();
    const out: PropInstance[] = [...(this.pylonChunks.get(`${cx}:${cz}`) ?? [])];
    const sea = this.host.seaLevel, ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
    const rng = new Rng(hash3(this.host.seed, cx, cz, 0x15a));
    const put = (asset: number, x: number, y: number, z: number, yaw: number, scale: number) =>
      out.push({ asset, lx: quantizeLocal(x - ox), lz: quantizeLocal(z - oz), yq: quantizeHeight(y), rot: quantizeRotation(yaw), scale: quantizeScale(scale) });
    const pick = <T>(list: readonly T[]) => list[Math.floor(rng.next() * list.length)]!;
    const clear = (x: number, z: number, margin: number, road: number, roadMargin: number) =>
      this.near(x, z, margin).length === 0 && road > roadMargin && !this.pylonList!.some(p => Math.abs(p.x - x) < 9 && Math.abs(p.z - z) < 9);
    // Trees on a jittered 8 m lattice; density from the forest map.
    for (let gz = 0; gz < CHUNK_SIZE; gz += 6.4) for (let gx = 0; gx < CHUNK_SIZE; gx += 6.4) {
      const x = ox + gx + rng.next() * 5.6, z = oz + gz + rng.next() * 5.6, roll = rng.next(), species = rng.next(), size = rng.next(), turn = rng.next() * Math.PI * 2;
      const density = this.forestDensity(x, z);
      if (roll > density * density * 1.25) continue;
      const g = ground(x, z), rel = g.height - sea;
      if (rel < 2 || g.slope > 1.1 || !clear(x, z, 5, g.road, 7)) continue;
      const coast = this.coastDistance(x, z);
      let asset: number;
      if (coast < 90) asset = species < .5 ? ISLAND_ASSET.banana : pick(ISLAND_ASSET.treeSmall);
      else if (rel > 110) asset = species < .4 ? ISLAND_ASSET.conifer : species < .8 ? ISLAND_ASSET.pineBig : ISLAND_ASSET.pineMedium;
      else if (rel > 60) asset = species < .5 ? ISLAND_ASSET.pineMedium : species < .7 ? ISLAND_ASSET.pineBig : pick(ISLAND_ASSET.treeBig);
      else asset = species < .45 ? pick(ISLAND_ASSET.treeSmall) : species < .75 ? pick(ISLAND_ASSET.treeBig) : species < .92 ? ISLAND_ASSET.pineSmall : (species < .96 ? ISLAND_ASSET.deadTree : ISLAND_ASSET.deadPine);
      put(asset, x, g.height - .25, z, turn, .75 + size * .5);
    }
    // Undergrowth and boulders on a coarser lattice.
    for (let gz = 0; gz < CHUNK_SIZE; gz += 11) for (let gx = 0; gx < CHUNK_SIZE; gx += 11) {
      const x = ox + gx + rng.next() * 10, z = oz + gz + rng.next() * 10, roll = rng.next(), kind = rng.next(), size = rng.next(), turn = rng.next() * Math.PI * 2;
      const g = ground(x, z), rel = g.height - sea;
      if (rel < 1 || !clear(x, z, 3, g.road, 5)) continue;
      if (g.slope > .55 || (rel > 120 && roll < .25)) {
        if (roll < .55) put(kind < .6 ? pick(ISLAND_ASSET.rockMedium) : kind < .9 ? pick(ISLAND_ASSET.stone) : pick(ISLAND_ASSET.rockBig), x, g.height - .4, z, turn, .6 + size * .6);
      } else if (roll < this.forestDensity(x, z) * .5 + .08) {
        put(kind < .85 ? pick(ISLAND_ASSET.bush) : pick(ISLAND_ASSET.stone), x, g.height - .1, z, turn, .7 + size * .5);
      }
    }
    return out;
  }
}

/** Evenly spaced stations along a polyline: [x, z, direction x, direction z]. */
function along(points: readonly Point[], spacing: number): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1]!, [bx, bz] = points[i]!, len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
    for (let t = carry; t <= len; t += spacing) out.push([ax + dx * t, az + dz * t, dx, dz]);
    carry = (spacing - ((len - carry) % spacing)) % spacing;
  }
  const [lx, lz] = points[points.length - 1]!, last = out[out.length - 1];
  if (!last || Math.hypot(last[0] - lx, last[1] - lz) > spacing * .4) {
    const [px, pz] = points[points.length - 2]!, len = Math.hypot(lx - px, lz - pz);
    out.push([lx, lz, (lx - px) / len, (lz - pz) / len]);
  }
  return out;
}

/* ------------------------------------------------------------------------------ districts */

/** Site-local building kit: every part placed relative to the site centre. */
class Kit {
  readonly parts: CampPart[] = [];
  private group = 1;
  put(asset: number, x: number, z: number, y = 0, yaw = 0, scale = 1, group = 0): void { this.parts.push({ asset, x, y, z, yaw, scale, group }); }
  /** A building model with its own fade group. */
  house(asset: number, x: number, z: number, yaw = 0, scale = 1): void { this.put(asset, x, z, .08, yaw, scale, this.group++); }
  /** The enterable modular block (stairs, doors, loot crates), `floors` storeys above ground. */
  block(x: number, z: number, floors: number, unfinished = false): void { modularBuilding(this.parts, x, z, floors, this.group++, unfinished); }
  tower(x: number, z: number, water = false): void { guardTower(this.parts, x, z, this.group++, water); }
  /** A straight wall of 4 m concrete sections, leaving `gaps` (indices) open. */
  wall(ax: number, az: number, bx: number, bz: number, asset: number = CAMP_ASSET['concrete-wall'], step = 4, gaps: number[] = []): void {
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / step)), yaw = Math.atan2(-(bz - az), bx - ax);
    for (let i = 0; i < n; i++) if (!gaps.includes(i)) this.put(asset, ax + (bx - ax) * (i + .5) / n, az + (bz - az) * (i + .5) / n, 0, yaw);
  }
  rect(cx: number, cz: number, hx: number, hz: number, asset: number = CAMP_ASSET['concrete-wall'], step = 4, gate?: 'n' | 's' | 'e' | 'w'): void {
    const gap = (len: number) => { const n = Math.round(len / step), m = Math.floor(n / 2); return [m - 1, m]; };
    this.wall(cx - hx, cz - hz, cx + hx, cz - hz, asset, step, gate === 'n' ? gap(hx * 2) : []);
    this.wall(cx - hx, cz + hz, cx + hx, cz + hz, asset, step, gate === 's' ? gap(hx * 2) : []);
    this.wall(cx - hx, cz - hz, cx - hx, cz + hz, asset, step, gate === 'w' ? gap(hz * 2) : []);
    this.wall(cx + hx, cz - hz, cx + hx, cz + hz, asset, step, gate === 'e' ? gap(hz * 2) : []);
  }
}

function buildDistricts(map: AuthoredMap, world: AuthoredWorld): GroundStructure[] {
  const sites: GroundStructure[] = [];
  const sea = world.host.seaLevel;
  let gid = 1;
  type Size = number | readonly [number, number];
  /** A district site: circular (radius) or rectangular ([half x, half z]) levelled pad. */
  const site = (kind: Structure['kind'], x: number, z: number, size: Size, kit: Kit, options: { ground?: Surface; level?: number; yaw?: number } = {}) => {
    const [hx, hz] = typeof size === 'number' ? [0, 0] : size;
    const radius = typeof size === 'number' ? size : Math.hypot(hx, hz);
    const level = options.level ?? Math.max(sea + 1.6, world.terrain(x, z));
    sites.push({
      kind, x, z, y: level, yaw: options.yaw ?? 0, radius, parts: importedRoofAccess(kit.parts), gid: gid++,
      ...(hx ? { halfX: hx, halfZ: hz } : {}), ...(options.ground !== undefined ? { ground: options.ground } : {}),
    });
  };
  /** Timber jetty built off the sea bed, so its levelling never fills the water around it. */
  const jetty = (x: number, z: number, length: number, width: number, deckAbove: number, kind: Structure['kind']) => {
    const kit = new Kit(), bed = world.terrain(x, z), deck = sea + deckAbove - bed;
    for (let dz = -length / 2 + 1; dz <= length / 2 - 1; dz += 2) for (let dx = -width / 2 + 1; dx <= width / 2 - 1; dx += 2) kit.put(BRIDGE_ASSET.woodenDeck, dx, dz, deck);
    for (let dz = -length / 2 + 2; dz <= length / 2 - 2; dz += 10) for (const dx of [-width / 2 + .4, width / 2 - .4]) kit.put(BATTLE_ASSET.balconyPost, dx, dz, deck - 3.2);
    sites.push({ kind, x, z, y: bed, yaw: 0, radius: 1, parts: kit.parts, gid: gid++ });
  };
  const zone = (id: string) => map.zones.find(z => z.id === id)!;
  const rng = new Rng(0x15a1d);

  /* --- Harbour: quay with cranes over the basin, container yard, warehouses, fuel farm, jetties. */
  {
    const quay = new Kit();
    for (const dx of [-70, -10, 50]) quay.put(ISLAND_ASSET.crane, dx, 52, .1, -Math.PI / 2);
    // Container yard: stacks two or three high with lanes for vehicles.
    for (let row = 0; row < 5; row++) for (let col = 0; col < 10; col++) {
      if (col === 5 || row === 2) continue;
      const x = -78 + col * 16, z = -44 + row * 8;
      const height = 1 + Math.floor(rng.next() * 3);
      for (let level = 0; level < height; level++) {
        const roll = rng.next();
        quay.put(roll < .45 ? BATTLE_ASSET.containerRed : roll < .85 ? BATTLE_ASSET.containerGreen : BUILDING_ASSET.container, x, z, level ? level * 2.62 + .05 : 0);
      }
    }
    for (const x of [-90, -45, 0, 45, 90]) quay.put(CAMP_ASSET['straight-lamp-post'], x, 34);
    quay.wall(-100, 63, 100, 63, CAMP_ASSET['concrete-wall-panel'], 5, [9, 10, 19, 20, 29, 30]);
    site('port', 2100, 3235, [104, 64], quay, { ground: Surface.Asphalt, level: sea + 3 });

    const sheds = new Kit();
    for (const [x, z] of [[-24, -22], [-24, 8], [-24, 38]] as const) sheds.house(BUILDING_ASSET.barrackLong, x, z, 0, 1.6);
    sheds.house(BUILDING_ASSET.barn, 18, -18, Math.PI / 2, 1.5); sheds.house(BUILDING_ASSET.barn, 18, 20, Math.PI / 2, 1.5);
    sheds.block(-2, -52, 1);
    for (let i = 0; i < 6; i++) sheds.put(CAMP_ASSET['rusty-oil-barrel'], 34 + (i % 3) * 1.3, -42 + Math.floor(i / 3) * 1.3);
    site('port', 1935, 3175, [42, 62], sheds, { ground: Surface.Asphalt, level: sea + 3 });

    const fuel = new Kit();
    for (const [x, z] of [[-20, -22], [4, -22], [-20, 4], [4, 4]] as const) fuel.house(BUILDING_ASSET.tank, x, z, 0, 2);
    fuel.house(BUILDING_ASSET.generator, 26, -10, Math.PI / 2, 1.2);
    fuel.block(24, 22, 2);
    fuel.rect(-2, -2, 38, 40, CAMP_ASSET['iron-fence'], 2.25, 'w');
    site('port', 2272, 3175, [42, 44], fuel, { ground: Surface.Gravel, level: sea + 3 });

    const office = new Kit();
    office.block(-14, 0, 3); office.block(16, 4, 1);
    office.house(BUILDING_ASSET.trailer, 2, -18);
    office.put(CAMP_ASSET['military-lamp-post'], 0, 14);
    site('port', 2185, 3080, [30, 22], office, { ground: Surface.Asphalt });

    jetty(1990, 3335, 46, 6, 2.6, 'port'); jetty(2150, 3335, 46, 6, 2.6, 'port');
  }

  /* --- Town: a 4 × 4 grid of 80 m blocks around the high street. */
  {
    type Block = (k: Kit, flip: number) => void;
    const apartment: Block = k => { k.house(BUILDING_ASSET.apartment, 0, -6); k.put(CAMP_ASSET['straight-lamp-post'], -20, 24); k.put(CAMP_ASSET['straight-lamp-post'], 20, 24); };
    const flats: Block = (k, f) => { k.block(-17, -12 * f, 2); k.block(17, -12 * f, 1); k.house(BUILDING_ASSET.house, -18, 22 * f, Math.PI / 2); k.house(BUILDING_ASSET.houseSmall, 16, 22 * f); };
    const favelas: Block = (k, f) => { k.house(BUILDING_ASSET.favela, -18, -16 * f, f > 0 ? 0 : Math.PI); k.house(BUILDING_ASSET.favela, 16, -16 * f, f > 0 ? 0 : Math.PI);
      for (const x of [-24, -20.8, -17.6]) k.house(BUILDING_ASSET.slumRoom, x, 18 * f); k.house(BUILDING_ASSET.slumCorner, -14.4, 18 * f); k.block(16, 16 * f, 1); };
    const houses: Block = (k, f) => { k.house(BUILDING_ASSET.houseLarge, -16, -14 * f); k.house(BUILDING_ASSET.houseLarge, 16, -14 * f, Math.PI);
      k.house(BUILDING_ASSET.house, -20, 20 * f, Math.PI / 2); k.house(BUILDING_ASSET.houseSmall, 0, 22 * f); k.house(BUILDING_ASSET.houseSmall, 18, 20 * f, 1.2); };
    const square: Block = k => { k.tower(-18, -16, true); k.block(18, -14, 2);
      for (const [x, z] of [[-14, 10], [6, 10], [-14, 26], [6, 26]] as const) k.put(CAMP_ASSET['straight-lamp-post'], x, z);
      k.house(BUILDING_ASSET.bench, -4, 12); k.house(BUILDING_ASSET.bench, -4, 24, Math.PI); k.house(BUILDING_ASSET.houseSmall, 22, 20); };
    const market: Block = (k, f) => { for (let i = 0; i < 4; i++) k.put(i % 2 ? BATTLE_ASSET.containerGreen : BATTLE_ASSET.containerRed, -22 + i * 9, -18 * f, 0, Math.PI / 2);
      k.house(BUILDING_ASSET.trailer, 18, -18 * f); k.block(-16, 16 * f, 2); k.house(BUILDING_ASSET.barrack, 18, 18 * f, 0, 1.3); };
    const school: Block = k => { k.block(-16, -10, 3); k.block(16, -10, 3); k.house(BUILDING_ASSET.fence, 0, 26); k.house(BUILDING_ASSET.fence, -10, 26); k.house(BUILDING_ASSET.fence, 10, 26); };
    const plan: Block[][] = [
      [houses, flats, favelas, houses],
      [favelas, apartment, square, flats],
      [market, school, apartment, favelas],
      [houses, flats, market, houses],
    ];
    plan.forEach((row, j) => row.forEach((block, i) => {
      const kit = new Kit(), x = 1860 + i * 80, z = 2560 + j * 80;
      block(kit, j % 2 ? -1 : 1);
      site('town', x, z, [33, 33], kit);
    }));
    // Outskirts along the approach roads.
    const homes: Array<[number, number, number, number]> = [
      [BUILDING_ASSET.houseSmall, 1750, 2560, .4], [BUILDING_ASSET.house, 1700, 2500, .5], [BUILDING_ASSET.favela, 2200, 2470, 2.6],
      [BUILDING_ASSET.houseLarge, 1950, 2905, 0], [BUILDING_ASSET.houseSmall, 2100, 2920, 3.1], [BUILDING_ASSET.house, 1780, 2880, 1.2],
      [BUILDING_ASSET.houseLarge, 2200, 2700, 1.6], [BUILDING_ASSET.house, 1750, 2760, 1.6],
    ];
    for (const [asset, x, z, yaw] of homes) { const k = new Kit(); k.house(asset, 0, 0, yaw); site('house_small', x, z, 14, k); }
  }

  /* --- Military base: walled compound on the northern shoulder of the spine. */
  {
    const base = new Kit();
    base.rect(0, 0, 112, 80, CAMP_ASSET['concrete-wall'], 4, 's');
    for (const [x, z] of [[-108, -76], [108, -76], [-108, 76], [108, 76]] as const) base.tower(x, z);
    for (let i = 0; i < 5; i++) for (const z of [-58, -40]) base.house(BUILDING_ASSET.barrack, -86 + i * 15, z, 0, 1.3);
    base.house(BUILDING_ASSET.barrackLarge, 48, -50, 0, 1.3); base.house(BUILDING_ASSET.barrackLarge, 78, -50, 0, 1.3);
    base.block(-70, 6, 3); base.block(-40, 6, 1); base.block(-70, 40, 1);
    base.house(BUILDING_ASSET.barrackLong, 36, 0, Math.PI / 2, 1.5); base.house(BUILDING_ASSET.barrackLong, 56, 0, Math.PI / 2, 1.5);
    base.put(CAMP_ASSET['rusty-old-helicopter'], 82, 36, 0, .6, .7);
    base.put(CAMP_ASSET['old-rusty-tank'], 10, 46, 0, 0, .5); base.put(CAMP_ASSET['old-rusty-tank'], 30, 46, 0, .2, .5);
    for (const x of [-12, -8, 8, 12]) base.put(CAMP_ASSET['sandbag-wall'], x, 70);
    for (const [x, z] of [[-96, 56], [-88, 66], [-78, 58]] as const) base.put(CAMP_ASSET['field-tent'], x, z);
    for (let i = 0; i < 6; i++) base.put(i % 2 ? BATTLE_ASSET.containerGreen : BUILDING_ASSET.container, -20 + i * 7, -68, 0, Math.PI / 2);
    for (const [x, z] of [[-40, 60], [0, 30], [40, -20], [-20, -20], [60, 50]] as const) base.put(CAMP_ASSET['military-lamp-post'], x, z);
    site('factory', zone('base').x, zone('base').z, [116, 84], base, { ground: Surface.Gravel });
    for (const [x, z] of [[1930, 1440], [2180, 1950]] as const) {
      const cp = new Kit();
      cp.tower(0, 0); for (const dx of [-14, -11]) cp.put(CAMP_ASSET['sandbag-wall'], dx, 6);
      cp.put(CAMP_ASSET['field-tent'], -2, -12);
      site('watchtower', x + 20, z, [14, 14], cp, { ground: Surface.Gravel });
    }
  }

  /* --- Thermal power station on the east coast. */
  {
    const plant = new Kit();
    plant.rect(0, 0, 100, 84, CAMP_ASSET['iron-fence'], 2.25, 'w');
    plant.house(BUILDING_ASSET.houseLarge, -20, -26, 0, 2);
    plant.house(BUILDING_ASSET.barn, 24, -28, 0, 2);
    plant.put(BATTLE_ASSET.chimney, 54, -52); plant.put(BATTLE_ASSET.chimney, 70, -52);
    for (const [x, z] of [[-74, -56], [-54, -56], [-74, -34], [-54, -34]] as const) plant.house(BUILDING_ASSET.tank, x, z, 0, 2);
    for (let i = 0; i < 6; i++) plant.house(BUILDING_ASSET.generator, -40 + i * 9, 24, 0, 1.2);
    for (let i = 0; i < 8; i++) plant.put(CAMP_ASSET['small-transformer'], 34 + (i % 4) * 5, 18 + Math.floor(i / 4) * 6);
    for (const [x, z] of [[38, 46], [56, 46], [74, 46]] as const) plant.put(ISLAND_ASSET.pylonHFrame, x, z, 0, Math.PI / 2, 1.5);
    for (const [x, z] of [[-74, 40], [-62, 56], [-80, 60]] as const) plant.put(ISLAND_ASSET.rockMedium[0], x, z, 0, 0, 1.6);
    plant.block(-74, 0, 2); plant.block(76, 0, 1); plant.block(0, 60, 1);
    site('power_plant', zone('plant').x, zone('plant').z, [104, 88], plant, { ground: Surface.Gravel });
  }

  /* --- Airfield: runway (a road), apron with hangars and a control tower. */
  {
    const apron = new Kit();
    apron.house(BUILDING_ASSET.barn, -24, -40, Math.PI / 2, 2); apron.house(BUILDING_ASSET.barn, -24, 0, Math.PI / 2, 2);
    apron.house(BUILDING_ASSET.barrackLarge, 34, -44, 0, 1.3);
    apron.tower(36, 8); apron.block(36, 34, 2);
    apron.put(CAMP_ASSET['rusty-old-helicopter'], 6, 42, 0, .5, .7);
    for (const [x, z] of [[-40, 44], [-28, 44]] as const) apron.house(BUILDING_ASSET.tank, x, z, 0, 1.5);
    apron.house(BUILDING_ASSET.trailer, 4, -56); apron.house(BUILDING_ASSET.trailer, 14, -56);
    for (let i = 0; i < 4; i++) apron.put(BATTLE_ASSET.containerRed, -52, -52 + i * 7);
    site('factory', 980, 1950, [58, 62], apron, { ground: Surface.Asphalt });
  }

  /* --- Villages, farm, radar, substation, lighthouse. */
  {
    const fishing = new Kit();
    fishing.house(BUILDING_ASSET.favela, -26, -18); fishing.house(BUILDING_ASSET.houseSmall, 4, -24, .3);
    fishing.block(28, -12, 1);
    for (const x of [-30, -26.8]) fishing.house(BUILDING_ASSET.slumRoom, x, 18);
    fishing.house(BUILDING_ASSET.house, 2, 20, Math.PI / 2); fishing.house(BUILDING_ASSET.houseSmall, 26, 24, 2.8);
    site('hamlet', zone('fishing').x, zone('fishing').z, [40, 36], fishing);
    jetty(1180, 3520, 54, 4, 2.2, 'hamlet');

    const farm = new Kit();
    farm.block(-22, -18, 2); farm.house(BUILDING_ASSET.barn, 22, -18); farm.house(BUILDING_ASSET.barnWide, -22, 12);
    farm.block(22, 10, 1, true); farm.tower(0, -20, true);
    for (let x = -24; x <= 24; x += 8) {
      farm.put(BATTLE_ASSET.farmBed, x, 36, .02);
      for (let z = 30; z <= 42; z += 3) farm.put(BATTLE_ASSET.crop, x, z, .1, rng.next() * Math.PI);
    }
    farm.wall(-34, 48, 34, 48, CAMP_ASSET['wooden-fence'], 4);
    site('farm', zone('highland').x, zone('highland').z, [40, 50], farm);

    const radar = new Kit();
    radar.put(ISLAND_ASSET.pylonTower, 0, 0, 0, 0, 1.1);
    radar.tower(-16, 10); radar.house(BUILDING_ASSET.barrack, 14, 12, 0, 1.3);
    for (const x of [-8, -4, 0, 4]) radar.put(CAMP_ASSET['sandbag-wall'], x, 22);
    site('watchtower', zone('radar').x, zone('radar').z, 28, radar, { ground: Surface.Gravel });

    const sub = new Kit();
    sub.rect(0, 0, 28, 24, CAMP_ASSET['iron-fence'], 2.25, 'w');
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) sub.put(ISLAND_ASSET.pylonHFrame, -12 + i * 12, -8 + j * 14, 0, Math.PI / 2, 1.5);
    for (let i = 0; i < 6; i++) sub.put(CAMP_ASSET['small-transformer'], -14 + i * 5.5, 4);
    sub.house(BUILDING_ASSET.barrack, 14, 16, 0, 1.3); sub.house(BUILDING_ASSET.generator, -16, 16);
    site('factory', zone('substation').x, zone('substation').z, [30, 26], sub, { ground: Surface.Gravel });

    const hamlet = new Kit();
    hamlet.block(-18, -16, 2); hamlet.house(BUILDING_ASSET.favela, 18, -16);
    hamlet.house(BUILDING_ASSET.slumRoom, -18, 16); hamlet.house(BUILDING_ASSET.slumCorner, -14.8, 16); hamlet.house(BUILDING_ASSET.houseSmall, 18, 16);
    site('hamlet', zone('eastvillage').x, zone('eastvillage').z, [32, 30], hamlet);

    const light = new Kit();
    light.tower(0, 0); light.put(BATTLE_ASSET.waterTank, 0, 0, 10.8, 0, .6);
    light.house(BUILDING_ASSET.barrack, 14, 6, Math.PI / 2, 1.3); light.block(-16, 10, 1);
    site('watchtower', zone('lighthouse').x, zone('lighthouse').z, 26, light);
  }

  // Lone shelters along the coast roads give early loot outside the districts.
  const lone: Array<[number, number, 'block' | 'tower']> = [
    [1520, 3150, 'block'], [880, 2900, 'block'], [700, 2400, 'tower'], [2700, 880, 'block'], [3220, 1300, 'tower'],
    [1450, 2330, 'block'], [2620, 2160, 'tower'], [3420, 2400, 'block'], [1060, 1600, 'block'], [2600, 1650, 'block'],
  ];
  for (const [x, z, kind] of lone) {
    const k = new Kit();
    if (kind === 'block') k.block(0, 0, 1); else k.tower(0, 0);
    site(kind === 'block' ? 'house_small' : 'watchtower', x + 22, z - 22, 15, k);
  }
  return sites;
}

const worlds = new WeakMap<object, AuthoredWorld>();
/** The authored map of a battle generator (one per generator instance). */
export function authoredWorld(host: Host): AuthoredWorld {
  let world = worlds.get(host);
  if (!world) worlds.set(host, world = new AuthoredWorld(ISLAND, host));
  return world;
}
