import { CHUNK_SIZE, Rng, hash3, quantizeHeight, quantizeLocal, quantizeRotation, quantizeScale, type PropInstance } from '@zion/shared';
import { CAMP_ASSET } from '@zion/assets';
import { makeColumnSample, type ColumnSample, type WorldGenerator } from './generator';
import type { CampPart } from './camp';

/**
 * Abandoned structures scattered over the map (Minecraft-style): ruined camps, lone houses,
 * factories, power plants and small towns. Each world cell may hold one site, chosen and laid out
 * purely from the world seed, on flat dry ground far from the survivor camp. Everything is built
 * from the camp asset kit, broken on purpose: missing wall segments, holed roofs, debris.
 */
export type StructureKind = 'house_small' | 'house_large' | 'ruined_camp' | 'factory' | 'power_plant' | 'town';

export interface Structure {
  kind: StructureKind;
  /** Centre (world metres) and the base height of the site. */
  x: number;
  z: number;
  y: number;
  yaw: number;
  /** Footprint radius: nothing natural grows inside, the ground is bare. */
  radius: number;
  /** Structure-local parts (rotated by `yaw` when placed). */
  parts: CampPart[];
  /** Seeded id of this site (makes its group ids unique). */
  gid: number;
}

/**
 * One possible site per cell. Cells are small (dense map); overlapping neighbours are resolved
 * by a seeded priority, so sites never collide.
 */
const CELL = 100;
export const STRUCTURE_DENSITY_MULTIPLIER = 1.5;
/** Minimum clear ground between two structures' footprints (m). */
const GAP = 10;
const SALT = 0x57c;
/** Keep clear of the survivor camp (metres from its centre). */
const CAMP_CLEARANCE = 320;
const MAX_RADIUS = 70;
/** Width (m) of the slope blending a structure's levelled pad into the terrain. */
export const STRUCTURE_BLEND = 16;

type Asset = keyof typeof CAMP_ASSET;
const A = (name: Asset) => CAMP_ASSET[name];

/** Wall kits: model, its length along local X and its height. */
interface WallKit {
  asset: Asset;
  len: number;
  height: number;
}
const WALLS: Record<string, WallKit> = {
  wood: { asset: 'wooden-fence', len: 4, height: 2.25 },
  brick: { asset: 'large-stone-brick-wall', len: 4, height: 2.25 },
  concrete: { asset: 'concrete-wall', len: 4, height: 3.16 },
  mossy: { asset: 'mossy-concrete-wall', len: 4, height: 3.88 },
  panel: { asset: 'concrete-wall-panel', len: 5, height: 3.5 },
  iron: { asset: 'iron-fence', len: 2.25, height: 2.5 },
  wire: { asset: 'barbed-wire-fence', len: 4, height: 3.38 },
  sandbag: { asset: 'sandbag-wall', len: 2.25, height: 2 },
};

/* ------------------------------------------------------------------------------- builder */

class Builder {
  readonly parts: CampPart[] = [];
  /** Group stamped on parts added now (0 = none); one per building / wall run. */
  group = 0;
  private nextGroup = 1;
  constructor(readonly rng: Rng) {}

  /** Starts a new group for the following structural parts; returns the previous one. */
  beginGroup(): number {
    const prev = this.group;
    this.group = this.nextGroup++;
    return prev;
  }

  /** When set, wall() calls join this group instead of each getting their own (curved runs). */
  sharedFace = 0;
  /** Group of each wall line, so window panes in that wall fade with it. */
  private readonly faceOf = new Map<string, number>();
  private lineKey(x0: number, z0: number, x1: number, z1: number): string {
    return [x0, z0, x1, z1].map((v) => Math.round(v * 10)).join(',');
  }

  chance(p: number): boolean {
    return this.rng.next() < p;
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rng.next() * list.length)]!;
  }

  add(asset: Asset, x: number, z: number, yaw = 0, y = 0, scale = 1): void {
    this.parts.push({ asset: A(asset), x, y, z, yaw, scale, group: this.group || undefined });
  }

  /** Loose objects (debris, furniture) never join a group. */
  loose(fn: () => void): void {
    const g = this.group;
    this.group = 0;
    fn();
    this.group = g;
  }

  /** Something lying around: crates, barrels, boards, junk. */
  debris(x: number, z: number, spread: number, count: number): void {
    const g = this.group;
    this.group = 0;
    const junk: Asset[] = ['old-wooden-crate', 'rusty-oil-barrel', 'old-dusty-wood-board', 'old-carton-box', 'old-iron-bucket', 'old-wooden-beam', 'rusty-iron-bar', 'rusted-wire-coil', 'old-water-pipe', 'car-battery', 'military-wooden-crate', 'branch-stick'];
    for (let i = 0; i < count; i++) {
      const a = this.pick(junk);
      this.add(a, x + (this.rng.next() * 2 - 1) * spread, z + (this.rng.next() * 2 - 1) * spread, this.rng.next() * Math.PI * 2, 0, 0.8 + this.rng.next() * 0.3);
    }
    this.group = g;
  }

  /**
   * A wall from (x0,z0) to (x1,z1) out of `kit` segments. `damage` = chance a segment is missing
   * (rubble or a broken panel lies there instead); `gaps` = segment indexes left open (doors).
   */
  wall(kit: WallKit, x0: number, z0: number, x1: number, z1: number, damage: number, gaps: number[] = []): void {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / kit.len));
    const yaw = Math.atan2(-dz, dx);
    // Each wall face is its own group: when it hides the player, only this face fades.
    const outer = this.group;
    this.group = this.sharedFace || this.nextGroup++;
    this.faceOf.set(this.lineKey(x0, z0, x1, z1), this.group);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = x0 + dx * t;
      const z = z0 + dz * t;
      if (gaps.includes(i)) continue;
      if (this.chance(damage)) {
        // Broken: a collapsed concrete stub, a shattered pane, or just rubble.
        const r = this.rng.next();
        if (kit.height > 3 && r < 0.45) this.add('broken-concrete-wall', x, z, yaw);
        else if (r < 0.6) this.add('shattered-glass-pane', x, z, yaw + (this.rng.next() - 0.5) * 0.6);
        else this.debris(x, z, 1.2, 2);
        continue;
      }
      // Slight crookedness: nothing here was built straight or stayed that way.
      this.add(kit.asset, x, z, yaw + (this.rng.next() - 0.5) * 0.06);
    }
    this.group = outer;
  }

  /** Closed rectangular outline centred on (cx, cz), `w` along X and `d` along Z. */
  box(kit: WallKit, cx: number, cz: number, w: number, d: number, damage: number, door: 'n' | 's' | 'e' | 'w' | null): void {
    const hx = w / 2;
    const hz = d / 2;
    const mid = (len: number) => [Math.floor(Math.max(1, Math.round(len / kit.len)) / 2)];
    this.wall(kit, cx - hx, cz - hz, cx + hx, cz - hz, damage, door === 'n' ? mid(w) : []);
    this.wall(kit, cx - hx, cz + hz, cx + hx, cz + hz, damage, door === 's' ? mid(w) : []);
    this.wall(kit, cx - hx, cz - hz, cx - hx, cz + hz, damage, door === 'w' ? mid(d) : []);
    this.wall(kit, cx + hx, cz - hz, cx + hx, cz + hz, damage, door === 'e' ? mid(d) : []);
  }

  /** Flat roof of 2 m metal plates at `height`, with holes. */
  roof(cx: number, cz: number, w: number, d: number, height: number, holes: number): void {
    const outer = this.group;
    const roofGroup = this.nextGroup++;
    for (let x = -w / 2 + 1; x < w / 2; x += 2) {
      for (let z = -d / 2 + 1; z < d / 2; z += 2) {
        if (this.chance(holes)) {
          // The fallen plate lies inside.
          if (this.chance(0.4)) this.add('rusty-metal-plate', cx + x + (this.rng.next() - 0.5), cz + z + (this.rng.next() - 0.5), this.rng.next() * 3);
          continue;
        }
        this.group = roofGroup;
        this.add('rusty-metal-plate', cx + x, cz + z, 0, height);
        this.group = outer;
      }
    }
  }

  /** Window panes set into a wall line (some intact, some broken). */
  windows(kit: WallKit, x0: number, z0: number, x1: number, z1: number): void {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / kit.len));
    const yaw = Math.atan2(-dz, dx);
    // Pushed just outside the wall face, at window height.
    const nx = -dz / (len || 1);
    const nz = dx / (len || 1);
    const outer = this.group;
    this.group = this.faceOf.get(this.lineKey(x0, z0, x1, z1)) ?? 0;
    for (let i = 0; i < n; i++) {
      if (!this.chance(0.45)) continue;
      const t = (i + 0.5) / n;
      const pane: Asset = this.pick(['glass-pane', 'broken-glass-pane', 'shattered-glass-pane', 'broken-glass-pane']);
      this.add(pane, x0 + dx * t + nx * 0.32, z0 + dz * t + nz * 0.32, yaw, 0.4);
    }
    this.group = outer;
  }
}

/* ------------------------------------------------------------------------------ layouts */

function houseSmall(b: Builder, cx = 0, cz = 0, facing: 'n' | 's' | 'e' | 'w' = 's'): number {
  const kit = WALLS[b.pick(['wood', 'brick', 'brick', 'concrete'])]!;
  const w = b.pick([8, 8, 12]);
  const d = b.pick([4, 8, 8]);
  b.box(kit, cx, cz, w, d, 0.18, facing);
  b.windows(kit, cx - w / 2, cz - d / 2, cx + w / 2, cz - d / 2);
  b.roof(cx, cz, w, d, kit.height, 0.35);
  b.debris(cx, cz, Math.min(w, d) / 2 - 0.8, 2 + Math.floor(b.rng.next() * 3));
  if (b.chance(0.4)) b.add('old-water-pipe', cx + w / 2 + 0.8, cz, Math.PI / 2);
  return Math.hypot(w, d) / 2 + 2;
}

function houseLarge(b: Builder, cx = 0, cz = 0, facing: 'n' | 's' | 'e' | 'w' = 's'): number {
  const kit = WALLS[b.pick(['concrete', 'mossy', 'brick'])]!;
  const w = b.pick([12, 16]);
  const d = b.pick([8, 12]);
  b.box(kit, cx, cz, w, d, 0.25, facing);
  // Inner partition with a doorway.
  b.wall(kit, cx, cz - d / 2, cx, cz + d / 2, 0.3, [0]);
  b.windows(kit, cx - w / 2, cz + d / 2, cx + w / 2, cz + d / 2);
  b.windows(kit, cx - w / 2, cz - d / 2, cx - w / 2, cz + d / 2);
  b.roof(cx, cz, w, d, kit.height, 0.45);
  b.debris(cx - w / 4, cz, d / 2 - 1, 4);
  b.debris(cx + w / 4, cz, d / 2 - 1, 3);
  if (b.chance(0.5)) b.add('rusty-iron-wall-ladder', cx + w / 2 + 0.3, cz + d / 4, Math.PI / 2);
  if (b.chance(0.5)) b.add('utility-pole', cx - w / 2 - 3, cz + d / 2 + 2);
  return Math.hypot(w, d) / 2 + 4;
}

function ruinedCamp(b: Builder): number {
  const round = b.chance(0.4);
  const kit = WALLS[b.pick(['wire', 'iron', 'wood', 'wire'])]!;
  let r: number;
  if (round) {
    // Circular stockade.
    r = 15 + b.rng.next() * 13;
    const n = Math.max(10, Math.round((2 * Math.PI * r) / kit.len));
    const door = Math.floor(b.rng.next() * n);
    for (let i = 0; i < n; i++) {
      // A curved fence: every 4 segments form one face (fade together).
      if (i % 4 === 0) {
        b.beginGroup();
        b.sharedFace = b.group;
        b.group = 0;
      }
      if (i === door || i === (door + 1) % n) continue;
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      b.wall(kit, Math.cos(a0) * r, Math.sin(a0) * r, Math.cos(a1) * r, Math.sin(a1) * r, 0.22);
    }
    b.sharedFace = 0;
    b.group = 0;
  } else {
    // Rectangular compound, 30–60 m.
    const w = 30 + Math.round(b.rng.next() * 7) * 4;
    const d = 30 + Math.round(b.rng.next() * 4) * 4;
    b.box(kit, 0, 0, w, d, 0.22, 's');
    r = Math.hypot(w, d) / 2;
  }
  const inner = r * 0.6;
  // Tents, a shack or two, sandbags, a lamp, supplies, and maybe a wreck.
  for (let i = 0; i < 3 + Math.floor(b.rng.next() * 4); i++) {
    const a = b.rng.next() * Math.PI * 2;
    const d = inner * (0.4 + b.rng.next() * 0.6);
    b.add('field-tent', Math.cos(a) * d, Math.sin(a) * d, b.rng.next() * Math.PI * 2);
  }
  for (let i = 0; i < 1 + Math.floor(b.rng.next() * 2); i++) {
    const a = b.rng.next() * Math.PI * 2;
    houseSmall(b, Math.cos(a) * inner * 0.7, Math.sin(a) * inner * 0.7, b.pick(['n', 's', 'e', 'w']));
  }
  for (let i = 0; i < 3; i++) {
    const a = b.rng.next() * Math.PI * 2;
    b.add('sandbag-wall', Math.cos(a) * inner, Math.sin(a) * inner, a + Math.PI / 2);
  }
  if (b.chance(0.6)) b.add('military-lamp-post', inner * 0.3, -inner * 0.3);
  b.debris(0, 0, inner, 10);
  if (b.chance(0.35)) b.add(b.pick(['rusty-old-helicopter', 'old-rusty-tank'] as const), -inner * 0.4, inner * 0.3, b.rng.next() * Math.PI * 2);
  return r + 3;
}

function factory(b: Builder): number {
  const kit = WALLS.panel!;
  const w = b.pick([20, 25, 30]);
  const d = b.pick([15, 20]);
  // The hall: tall panel walls full of holes, half its roof gone.
  b.box(kit, 0, 0, w, d, 0.3, 's');
  b.wall(kit, 0, -d / 2, 0, d / 4, 0.4);
  b.roof(0, 0, w, d, kit.height, 0.55);
  b.windows(kit, -w / 2, -d / 2, w / 2, -d / 2);
  // Machinery and stock inside.
  for (let x = -w / 2 + 3; x < w / 2 - 2; x += 4) {
    if (b.chance(0.6)) b.add('small-transformer', x, -d / 4);
    if (b.chance(0.5)) b.add('old-water-pipe', x, d / 6, b.rng.next() * 0.3);
  }
  b.debris(0, 0, Math.min(w, d) / 2 - 2, 10);
  // Fenced yard in front, with pipes, barrels and a wreck.
  const yard = d / 2 + 14;
  b.wall(WALLS.iron!, -w / 2 - 4, d / 2, -w / 2 - 4, yard, 0.25);
  b.wall(WALLS.iron!, w / 2 + 4, d / 2, w / 2 + 4, yard, 0.25);
  b.wall(WALLS.iron!, -w / 2 - 4, yard, w / 2 + 4, yard, 0.25, [Math.floor((w + 8) / 2.25 / 2)]);
  for (let i = 0; i < 6; i++) b.add('rusty-oil-barrel', -w / 2 + 2 + i * 1.1, yard - 2.5);
  b.debris(w / 4, (d / 2 + yard) / 2, 5, 6);
  if (b.chance(0.5)) b.add('old-rusty-tank', -w / 4, (d / 2 + yard) / 2, b.rng.next() * Math.PI * 2);
  for (let x = -w / 2; x <= w / 2; x += 10) b.add('utility-pole', x, -d / 2 - 4);
  return Math.hypot(w + 8, yard * 2) / 2 + 2;
}

function powerPlant(b: Builder): number {
  const w = b.pick([44, 52]);
  const d = b.pick([32, 40]);
  b.box(WALLS[b.pick(['iron', 'wire'])]!, 0, 0, w, d, 0.2, 's');
  // Control building in one corner.
  houseLarge(b, -w / 2 + 10, -d / 2 + 8, 's');
  // Transformer rows and poles.
  for (let x = -4; x < w / 2 - 3; x += 3.5) {
    for (const z of [-d / 4, 0]) if (b.chance(0.85)) b.add('small-transformer', x, z);
  }
  for (let x = -w / 2 + 4; x < w / 2; x += 8) {
    b.add('utility-pole', x, d / 2 - 4);
    if (b.chance(0.5)) b.add('rusted-wire-coil', x + 2, d / 2 - 6);
  }
  // A field of dead solar panels.
  for (let x = -w / 2 + 4; x < -2; x += 2) {
    for (let z = 4; z < d / 2 - 6; z += 2) if (b.chance(0.7)) b.add('old-solar-panel', x, z, 0, 0, 1);
  }
  b.debris(w / 4, d / 4, 6, 6);
  return Math.hypot(w, d) / 2 + 3;
}

function town(b: Builder): number {
  // One or two streets of houses facing the road, poles along it.
  const streets = b.chance(0.5) ? 2 : 1;
  const houses = 3 + Math.floor(b.rng.next() * 3);
  const spacing = 18;
  const len = houses * spacing;
  for (let s = 0; s < streets; s++) {
    const z0 = (s - (streets - 1) / 2) * 40;
    for (let i = 0; i < houses; i++) {
      const x = -len / 2 + spacing / 2 + i * spacing;
      for (const side of [-1, 1]) {
        if (b.chance(0.2)) continue;
        const z = z0 + side * 11;
        const facing = side < 0 ? 's' : 'n';
        if (b.chance(0.3)) houseLarge(b, x, z + side * 2, facing);
        else houseSmall(b, x, z, facing);
      }
      if (i % 2 === 0) b.add('utility-pole', x, z0 + 3.5);
      b.debris(x + spacing / 2, z0, 2, 1);
    }
  }
  return Math.hypot(len, streets * 40 + 20) / 2;
}

const BUILD: Record<StructureKind, (b: Builder) => number> = {
  house_small: (b) => houseSmall(b),
  house_large: (b) => houseLarge(b),
  ruined_camp: ruinedCamp,
  factory,
  power_plant: powerPlant,
  town,
};

const WEIGHTS: Array<[StructureKind, number]> = [
  ['house_small', 26],
  ['house_large', 16],
  ['ruined_camp', 18],
  ['factory', 12],
  ['power_plant', 8],
  ['town', 12],
];

/** Rough footprint radius for the flatness test before building. */
const APPROX_RADIUS: Record<StructureKind, number> = { house_small: 8, house_large: 12, ruined_camp: 30, factory: 26, power_plant: 34, town: 55 };

/* ------------------------------------------------------------------------------ placement */

const cache = new WeakMap<WorldGenerator, Map<number, Structure | null>>();
/** Created lazily: generator.ts and this module import each other. */
let probeSample: ColumnSample | null = null;

/** The structure of a world cell (deterministic; cached per generator). */
export function structureInCell(gen: WorldGenerator, gx: number, gz: number): Structure | null {
  let m = resolved.get(gen);
  if (!m) resolved.set(gen, (m = new Map()));
  const key = ((gx & 0xffff) << 16) | (gz & 0xffff);
  if (m.has(key)) return m.get(key)!;
  const s = resolveCell(gen, gx, gz);
  m.set(key, s);
  return s;
}

const resolved = new WeakMap<WorldGenerator, Map<number, Structure | null>>();
/** Neighbour cells that can overlap a site (largest footprints span this many cells). */
const REACH = Math.ceil((2 * MAX_RADIUS + GAP) / CELL);

/**
 * A cell's candidate survives unless it overlaps a neighbouring candidate with higher seeded
 * priority. Only candidates are compared (never resolved neighbours), so this never recurses.
 */
function resolveCell(gen: WorldGenerator, gx: number, gz: number): Structure | null {
  const mine = candidateInCell(gen, gx, gz);
  if (!mine) return null;
  const myPri = priority(gen, gx, gz);
  for (let dz = -REACH; dz <= REACH; dz++) {
    for (let dx = -REACH; dx <= REACH; dx++) {
      if (!dx && !dz) continue;
      const other = candidateInCell(gen, gx + dx, gz + dz);
      if (!other || Math.hypot(other.x - mine.x, other.z - mine.z) >= other.radius + mine.radius + GAP) continue;
      // Larger sites win (towns, plants), then the seeded tie-break.
      const op = priority(gen, gx + dx, gz + dz);
      if (other.radius > mine.radius || (other.radius === mine.radius && op > myPri)) return null;
    }
  }
  return mine;
}

function priority(gen: WorldGenerator, gx: number, gz: number): number {
  return hash3(gen.seed, gx, gz, SALT + 7);
}

function candidateInCell(gen: WorldGenerator, gx: number, gz: number): Structure | null {
  let m = cache.get(gen);
  if (!m) cache.set(gen, (m = new Map()));
  const key = ((gx & 0xffff) << 16) | (gz & 0xffff);
  if (m.has(key)) return m.get(key)!;
  const s = buildCell(gen, gx, gz);
  m.set(key, s);
  return s;
}

function buildCell(gen: WorldGenerator, gx: number, gz: number): Structure | null {
  if (gen.config.generatorVersion < 2) return null;
  // Probe the natural ground (no structure pads) so the choice never depends on itself.
  const raw = gen.rawTerrain;
  gen.rawTerrain = true;
  try {
    return chooseSite(gen, gx, gz);
  } finally {
    gen.rawTerrain = raw;
  }
}

function chooseSite(gen: WorldGenerator, gx: number, gz: number, salt = SALT): Structure | null {
  const rng = new Rng(hash3(gen.seed, gx, gz, salt));
  if (rng.next() > 0.92) return null;
  let total = 0;
  for (const [, w] of WEIGHTS) total += w;
  let roll = rng.next() * total;
  let kind: StructureKind = 'house_small';
  for (const [k, w] of WEIGHTS) {
    roll -= w;
    if (roll <= 0) {
      kind = k;
      break;
    }
  }
  const approx = APPROX_RADIUS[kind];
  // A few candidate spots per cell; take the first flat, dry one.
  for (let attempt = 0; attempt < 8; attempt++) {
    const x = (gx + 0.15 + 0.7 * rng.next()) * CELL;
    const z = (gz + 0.15 + 0.7 * rng.next()) * CELL;
    if (x < approx + 24 || z < approx + 24 || x > gen.worldSize - approx - 24 || z > gen.worldSize - approx - 24) continue;
    if (gen.camp && Math.hypot(x - gen.camp.x, z - gen.camp.z) < CAMP_CLEARANCE + approx) continue;
    const base = flatBase(gen, x, z, approx, kind === 'town' ? 9 : kind === 'house_small' || kind === 'house_large' ? 5 : 7);
    if (base === null) continue;
    const b = new Builder(new Rng(hash3(gen.seed, gx, gz, salt + 1)));
    const radius = Math.min(MAX_RADIUS, BUILD[kind](b));
    return { kind, x, z, y: base, yaw: rng.next() * Math.PI * 2, radius, parts: b.parts, gid: hash3(gen.seed, gx, gz, salt + 3) };
  }
  return null;
}

/** Mean ground height if the area is flat (height range ≤ `tolerance`) and dry; else null. */
function flatBase(gen: WorldGenerator, x: number, z: number, r: number, tolerance: number): number | null {
  const probe = (probeSample ??= makeColumnSample());
  let lo = Infinity;
  let hi = -Infinity;
  let sum = 0;
  let n = 0;
  for (const [u, v] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]] as const) {
    gen.sampleColumn(x + u * r, z + v * r, probe);
    if (probe.height < gen.seaLevel + 1.5 || probe.water === probe.water || probe.river > 0.05) return null;
    lo = Math.min(lo, probe.height);
    hi = Math.max(hi, probe.height);
    sum += probe.height;
    n++;
  }
  return hi - lo <= tolerance ? sum / n : null;
}

/** Structures whose footprint may reach a point or area. */
export function structuresNear(gen: WorldGenerator, x: number, z: number, extra = 0): Structure[] {
  allStructures(gen);
  const extraCells = extraCache.get(gen);
  const out: Structure[] = [];
  const gx = Math.floor(x / CELL);
  const gz = Math.floor(z / CELL);
  const reach = Math.ceil((MAX_RADIUS + extra) / CELL);
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const s = structureInCell(gen, gx + dx, gz + dz);
      if (s && Math.hypot(s.x - x, s.z - z) <= s.radius + extra) out.push(s);
      for (const added of extraCells?.get(`${gx + dx}:${gz + dz}`) ?? []) if (Math.hypot(added.x - x, added.z - z) <= added.radius + extra) out.push(added);
    }
  }
  return out;
}

/** Every structure in the world (scans all cells once; cached per generator). */
const allCache = new WeakMap<WorldGenerator, Structure[]>();
const extraCache = new WeakMap<WorldGenerator, Map<string, Structure[]>>();
export function allStructures(gen: WorldGenerator): Structure[] {
  let list = allCache.get(gen);
  if (list) return list;
  list = [];
  const n = Math.ceil(gen.worldSize / CELL);
  for (let gz = 0; gz < n; gz++) for (let gx = 0; gx < n; gx++) {
    const s = structureInCell(gen, gx, gz);
    if (s) list.push(s);
  }
  // Preserve all original sites. Fill vacant dry ground until the world has 50% more sites.
  // A spatial index keeps terrain/chunk queries local, even though the target is global.
  const extras = new Map<string, Structure[]>();
  extraCache.set(gen, extras);
  allCache.set(gen, list);
  const target = Math.round(list.length * STRUCTURE_DENSITY_MULTIPLIER);
  const cells = Array.from({ length: n * n }, (_, i) => ({ gx: i % n, gz: Math.floor(i / n) }));
  cells.sort((a, b) => priority(gen, a.gx, a.gz) - priority(gen, b.gx, b.gz));
  const raw = gen.rawTerrain;
  gen.rawTerrain = true;
  try {
    for (let pass = 0; pass < 24 && list.length < target; pass++) for (const cell of cells) {
      if (list.length >= target) break;
      const candidate = chooseSite(gen, cell.gx, cell.gz, SALT + 0x1000 + pass * 17);
      if (!candidate || list.some((s) => Math.hypot(candidate.x - s.x, candidate.z - s.z) < candidate.radius + s.radius + GAP)) continue;
      list.push(candidate);
      const key = `${cell.gx}:${cell.gz}`;
      let entries = extras.get(key); if (!entries) extras.set(key, entries = []);
      entries.push(candidate);
    }
  } finally { gen.rawTerrain = raw; }
  return list;
}

export const STRUCTURE_KINDS: readonly StructureKind[] = ['house_small', 'house_large', 'ruined_camp', 'factory', 'power_plant', 'town'];

/** Inside any structure's footprint? (keeps trees and rocks out of buildings). */
export function insideStructure(gen: WorldGenerator, x: number, z: number, margin = 2): boolean {
  return structuresNear(gen, x, z, margin).length > 0;
}

/** Props of every structure part that falls in chunk (cx, cz). */
export function structureChunkProps(gen: WorldGenerator, cx: number, cz: number): PropInstance[] {
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;
  const out: PropInstance[] = [];
  const centre = structuresNear(gen, ox + CHUNK_SIZE / 2, oz + CHUNK_SIZE / 2, CHUNK_SIZE);
  for (const s of centre) {
    const c = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    for (const p of s.parts) {
      // three.js yaw about +Y: (x, z) → (x cos + z sin, −x sin + z cos).
      const x = s.x + p.x * c + p.z * sn;
      const z = s.z - p.x * sn + p.z * c;
      if (x < ox || x >= ox + CHUNK_SIZE || z < oz || z >= oz + CHUNK_SIZE) continue;
      // Ground pieces follow the terrain; raised ones (roofs, panes) hang off the site's base.
      const y = p.y > 0.05 ? s.y + p.y : gen.heightAt(x, z);
      // Group ids unique per structure (below the camp's id range).
      const group = p.group ? (hash3(s.gid, p.group, 0, 0x9e1) & 0x7fffffff) || 1 : 0;
      out.push({ asset: p.asset, lx: quantizeLocal(x - ox), lz: quantizeLocal(z - oz), yq: quantizeHeight(y), rot: quantizeRotation(p.yaw + s.yaw), scale: quantizeScale(p.scale), group });
    }
  }
  return out;
}
