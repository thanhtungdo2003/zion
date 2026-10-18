import { CHUNK_SIZE, Rng, hashCombine, quantizeHeight, quantizeLocal, quantizeRotation, quantizeScale, type PropInstance } from '@zion/shared';
import { CAMP_ASSET } from '@zion/assets';
import { makeColumnSample, type WorldGenerator } from './generator';
import { DEFAULT_CAMP_NPCS, DEFAULT_CAMP_PARTS } from './camp-default';

export interface CampSite { x: number; y: number; z: number }
export interface CampPart {
  asset: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  /** Structure group (0/absent = none): parts of one wall or building fade together. */
  group?: number;
}
export const CAMP_HALF_SIZE = 50;
export const CAMP_PAD = 54;
export const CAMP_BLEND = 18;

/** Probe natural ground before the foundation is enabled. Workers choose the same site. */
export function findCampSite(gen: WorldGenerator): CampSite | null {
  const rng = new Rng(hashCombine(gen.seed, 0xca6f));
  const s = makeColumnSample();
  let best: CampSite | null = null;
  let fallback: CampSite | null = null;
  let fallbackScore = Infinity;
  let bestScore = Infinity;
  for (let attempt = 0; attempt < 512; attempt++) {
    const x = Math.round(gen.worldSize * (0.15 + rng.next() * 0.7));
    const z = Math.round(gen.worldSize * (0.15 + rng.next() * 0.7));
    gen.sampleColumn(x, z, s);
    if (s.height > gen.seaLevel + 4 && !Number.isFinite(s.water) && s.river < 0.1) {
      const score = s.height - gen.seaLevel;
      if (score < fallbackScore) {
        fallbackScore = score;
        fallback = { x, y: Math.round(s.height * 100) / 100, z };
      }
    }
    let lo = Infinity, hi = -Infinity, total = 0, count = 0, valid = true;
    for (let dz = -72; dz <= 72 && valid; dz += 8) for (let dx = -72; dx <= 72; dx += 8) {
      gen.sampleColumn(x + dx, z + dz, s);
      if (s.height < gen.seaLevel + 3 || Number.isFinite(s.water) || s.river > 0.1) { valid = false; break; }
      lo = Math.min(lo, s.height); hi = Math.max(hi, s.height); total += s.height; count++;
    }
    if (!valid || hi - lo > 20 || hi - lo >= bestScore) continue;
    bestScore = hi - lo;
    best = { x, y: Math.round(total / count * 100) / 100, z };
    if (bestScore < 3) break;
  }
  // Small islands may lack 144 m of dry ground; a raised foundation still provides a safe spawn.
  return best ?? fallback;
}

/** Radius of the supply drop zone's levelled, cleared ground (matches the shared SUPPLY_ZONE_RADIUS). */
export const SUPPLY_PAD = 14;
export const SUPPLY_BLEND = 8;

/**
 * The supply drop zone (red X) beside the camp: open, level, dry ground just outside the camp's
 * protection, off the roads, where crates and vehicles come down under their canopies.
 */
export function findSupplyZone(gen: WorldGenerator, camp: CampSite): CampSite | null {
  const s = makeColumnSample();
  let best: CampSite | null = null, bestScore = Infinity;
  for (const r of [84, 96, 110]) for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2, x = Math.round(camp.x + Math.cos(a) * r), z = Math.round(camp.z + Math.sin(a) * r);
    if (x < 40 || z < 40 || x > gen.worldSize - 40 || z > gen.worldSize - 40) continue;
    let lo = Infinity, hi = -Infinity, total = 0, n = 0, ok = true;
    for (let dz = -SUPPLY_PAD; dz <= SUPPLY_PAD && ok; dz += 4) for (let dx = -SUPPLY_PAD; dx <= SUPPLY_PAD; dx += 4) {
      gen.sampleColumn(x + dx, z + dz, s);
      if (s.height < gen.seaLevel + 1.5 || Number.isFinite(s.water) || s.river > .05 || s.roadDistance < s.roadHalfWidth + 3) { ok = false; break; }
      lo = Math.min(lo, s.height); hi = Math.max(hi, s.height); total += s.height; n++;
    }
    if (!ok) continue;
    const score = hi - lo + r * .02;
    if (score < bestScore) { bestScore = score; best = { x, y: Math.round(total / n * 100) / 100, z }; }
  }
  return best;
}

export function campDistance(site: CampSite, x: number, z: number): number {
  return Math.max(Math.abs(x - site.x), Math.abs(z - site.z));
}

/**
 * Local metre coordinates (+Z = south, the entrance side). The southern entrance and central
 * avenue (|x| < 5) stay clear for spawning players. Everything stands on the ground or on top of
 * something solid: props can only yaw, so towers and shelters are built from upright boards,
 * sheets and ladders with horizontal beams, bars and plates.
 */
/** Where the camp NPCs stand (camp-local metres); the Camp Studio can move them. */
export interface CampNpcLayout {
  merchant: { x: number; z: number };
  nurse: { x: number; z: number };
  /** Gate guard posts (one per guard). */
  guards: Array<{ x: number; z: number }>;
}

/** Camp-local spots where the camp NPCs stand (their tables are placed beside them). */
export const NPC_STALLS = {
  merchant: DEFAULT_CAMP_NPCS.merchant,
  nurse: DEFAULT_CAMP_NPCS.nurse,
  /** The architect (blueprints) by the merchant's row. */
  architect: { x: 16, z: 4 },
} as const;

export function buildCampLayout(): CampPart[] {
  const parts: CampPart[] = [];
  const add = (name: keyof typeof CAMP_ASSET, x: number, z: number, yaw = 0, y = 0, scale = 1) => {
    parts.push({ asset: CAMP_ASSET[name], x, y, z, yaw, scale });
  };
  const turn = Math.PI / 2;
  // Heights of the surfaces things rest on.
  const CRATE_TOP = 1.0;
  const MIL_CRATE_TOP = 0.75;
  const PLATE = 0.375;
  const BEAM = 0.375;

  /* ---------------------------------------------------------------- perimeter */
  // Outer wire: a continuous perimeter with an eight-metre vehicle entrance.
  for (let t = -48; t <= 48; t += 4) {
    add('barbed-wire-fence', t, -50);
    if (Math.abs(t) > 4) add('barbed-wire-fence', t, 50);
    add('barbed-wire-fence', -50, t, turn);
    add('barbed-wire-fence', 50, t, turn);
  }
  // Inner palisade, with a patrol lane between the two rings.
  for (let t = -43.875; t <= 43.875; t += 2.25) {
    add('iron-fence', t, -45);
    if (Math.abs(t) > 4) add('iron-fence', t, 45);
    add('iron-fence', -45, t, turn);
    add('iron-fence', 45, t, turn);
  }
  // Staggered checkpoint forces vehicles to slow down without blocking foot traffic.
  for (const [x, z] of [[-4, 39], [-1.75, 39], [3, 33], [5.25, 33]]) add('sandbag-wall', x!, z!);

  /* ------------------------------------------------------------- watchtowers */
  // Salvage tower: stacked ladders as legs, beam/bar bracing, a steel deck at 4 m, a parapet of
  // boards and sheet metal, and a steel roof on sheet-metal corner posts. `facing` turns the
  // front (boards, sandbags) towards where the tower looks out.
  const tower = (cx: number, cz: number, facing: number) => {
    const c = Math.cos(facing);
    const s = Math.sin(facing);
    // Local (u across the front, v outwards) → camp coordinates; yaw is relative to `facing`.
    const put = (name: keyof typeof CAMP_ASSET, u: number, v: number, yaw: number, y = 0, scale = 1) => {
      add(name, cx + u * c + v * s, cz - u * s + v * c, facing + yaw, y, scale);
    };
    const L = 1.6;
    for (const u of [-L, L]) for (const v of [-L, L]) {
      put('rusty-iron-wall-ladder', u, v, 0, 0);
      put('rusty-iron-wall-ladder', u, v, 0, 2);
    }
    // Bracing only on the front and back faces, so you can walk under the deck side to side.
    for (const v of [-L, L]) {
      put('old-wooden-beam', 0, v, 0, 0.9);
      put('rusty-iron-bar', 0, v, 0, 2.3, 1.4);
      put('old-wooden-beam', 0, v, 0, 3.6);
    }
    // Deck: four plates make a 4 x 4 m floor resting on the top beams.
    for (const u of [-1, 1]) for (const v of [-1, 1]) put('rusty-metal-plate', u, v, 0, 3.6 + BEAM);
    const deck = 3.6 + BEAM + PLATE;
    // Parapet: boards on the front, rusty sheets left, perforated sheets right, back half open.
    for (const u of [-0.8, 0.8]) put('old-dusty-wood-board', u, 1.85, 0, deck);
    put('old-dusty-wood-board', -0.8, -1.85, 0, deck);
    for (const v of [-0.6, 0.6]) {
      put('rusty-corrugated-sheet', -1.85, v, turn, deck);
      put('perforated-corrugated-sheet', 1.85, v, turn, deck);
    }
    // Roof on four corner posts.
    for (const u of [-1.75, 1.75]) for (const v of [-1.75, 1.75]) put('rusty-corrugated-sheet', u, v, turn, deck);
    for (const u of [-1, 1]) for (const v of [-1, 1]) put('rusty-metal-plate', u, v, 0, deck + 1.61);
    // Ground clutter: sandbags in front, a barrel and a crate behind.
    put('sandbag-wall', 0, L + 1.3, 0);
    put('rusty-oil-barrel', 1.1, -L - 1, 0);
    put('military-wooden-crate', -1.1, -L - 1, 0.3);
  };
  // Gate towers flank the entrance; four corner towers overlook the wire.
  tower(-11, 38.5, 0);
  tower(11, 38.5, 0);
  tower(-38.5, -38.5, -Math.PI * 0.75);
  tower(38.5, -38.5, Math.PI * 0.75);
  tower(-38.5, 38.5, -Math.PI * 0.25);
  tower(38.5, 38.5, Math.PI * 0.25);

  /* -------------------------------------------------------------- buildings */
  const building = (cx: number, cz: number, width: number, depth: number) => {
    for (let x = -width / 2 + 2; x < width / 2; x += 4) {
      add('large-stone-brick-wall', cx + x, cz - depth / 2);
      // Four-metre doorway on the south facade.
      if (Math.abs(x) >= 2.1) add('large-stone-brick-wall', cx + x, cz + depth / 2);
    }
    for (let z = -depth / 2 + 2; z < depth / 2; z += 4) {
      add('large-stone-brick-wall', cx - width / 2, cz + z, turn);
      add('large-stone-brick-wall', cx + width / 2, cz + z, turn);
    }
    // Salvaged steel roof panels rest on the stone walls, with accessible interior space.
    for (let x = -width / 2 + 1; x < width / 2; x += 2) for (let z = -depth / 2 + 1; z < depth / 2; z += 2) {
      add('rusty-metal-plate', cx + x, cz + z, 0, 2.25);
    }
  };
  building(-22, -27, 12, 12); // command post
  building(23, -26, 16, 16); // supply warehouse
  building(26, 22, 12, 8); // checkpoint workshop
  // Command post interior: a map table (plate on two crates) and a radio battery.
  for (const x of [-23.5, -20.5]) add('old-wooden-crate', x, -29);
  add('rusty-metal-plate', -22, -29, 0, CRATE_TOP);
  add('car-battery', -26, -31.5, 0, 0, 0.6);
  for (const x of [-19, -17.5]) add('military-wooden-crate', x, -31.5);

  /* ------------------------------------------------------------- barracks */
  // Tents face the central avenue; each has a supply crate at its door.
  for (const z of [-6, 7, 20]) for (const x of [-32, -17]) add('field-tent', x, z, Math.PI);
  for (const z of [-6, 7, 20]) {
    add('old-wooden-crate', -10.5, z + 2.5);
    // Bottles stand on the crate lid.
    add('water-bottle', -10.75, z + 2.3, 0.4, CRATE_TOP);
    add('water-bottle', -10.3, z + 2.75, 1.1, CRATE_TOP);
    add('old-iron-bucket', -10.5, z + 4, 0, 0, 0.6);
  }

  /* --------------------------------------------------------- campfire yard */
  // Between the tents and the south palisade: a ring of sticks with beam benches around it.
  const fx = -24;
  const fz = 33;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add('branch-stick', fx + Math.cos(a) * 0.25, fz + Math.sin(a) * 0.25, a, 0, 0.5);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    add('old-wooden-beam', fx + Math.cos(a) * 3, fz + Math.sin(a) * 3, turn - a);
  }
  add('lon-cu-nat', fx + 1.6, fz - 1.4, 0.7);
  add('lon-cu-nat', fx - 2.1, fz + 0.9, 2.3);
  add('water-bottle', fx + 2.2, fz + 1.2, 0.2);
  // Firewood stack: two layers of beams.
  for (let i = 0; i < 4; i++) add('old-wooden-beam', fx - 6.5, fz - 1 + i * 0.45, turn);
  for (let i = 0; i < 3; i++) add('old-wooden-beam', fx - 6.5, fz - 0.8 + i * 0.45, turn, BEAM);

  /* --------------------------------------------------------------- garden */
  // Fenced vegetable patch behind the barracks, gate on the south side.
  const gx = -37;
  const gz = -17;
  for (const t of [-2, 2]) {
    add('wooden-fence', gx + t, gz - 4);
    if (t > 0) add('wooden-fence', gx + t, gz + 4);
    add('wooden-fence', gx - 4, gz + t, turn);
    add('wooden-fence', gx + 4, gz + t, turn);
  }
  // Interior reserved for server-owned farmland plots configured in Studio.

  /* ------------------------------------------------------ quartermaster */
  // Stores: aisles of crates; the second layer sits on the first, never in the air.
  for (const x of [18, 22, 26]) for (const z of [-31, -27]) {
    add('military-wooden-crate', x, z);
    add('military-wooden-crate', x, z, turn, MIL_CRATE_TOP);
    add('old-carton-box', x + 1.3, z);
  }
  add('zion-ammo-cache-station', 21, -21);
  // Weapon merchant's stall: his table beside the ammo cache (he stands at NPC_STALLS.merchant).
  add('weapon-table', NPC_STALLS.merchant.x, NPC_STALLS.merchant.z - 1.6);
  // Field medic: her table by the barracks tents (she stands at NPC_STALLS.nurse).
  add('medical-table', NPC_STALLS.nurse.x, NPC_STALLS.nurse.z + 1.5);
  add('zion-ammo-cache-station', 33, 12, turn);
  // Firing line with barrels.
  for (const z of [-8, -4, 0, 4]) {
    add('sandbag-wall', 34, z, turn);
    add('rusty-oil-barrel', 39, z);
  }

  /* -------------------------------------------------------- power yard */
  for (const x of [17, 21, 25]) {
    add('old-solar-panel', x, 7, 0, 0, 2);
    add('car-battery', x, 10, 0, 0, 0.6);
  }
  add('small-transformer', 29, 7, 0, 0, 1.5);
  add('utility-pole', 33, 4);
  add('rusted-wire-coil', 31, 9.5);

  /* ---------------------------------------------------------- workshop */
  // Lean-to shed: perforated sheet walls two high, steel roof on the walls.
  const sx = 14;
  const sz = 22;
  for (let i = -1.5; i <= 1.5; i += 1) {
    add('perforated-corrugated-sheet', sx + i, sz - 2);
    add('perforated-corrugated-sheet', sx + i, sz - 2, 0, 1);
    add('perforated-corrugated-sheet', sx - 2, sz + i, turn);
    add('perforated-corrugated-sheet', sx - 2, sz + i, turn, 1);
    add('rusty-corrugated-sheet', sx + 2, sz + i, turn);
  }
  for (const u of [-1, 1]) for (const v of [-1, 1]) add('rusty-metal-plate', sx + u, sz + v, 0, 2);
  // Salvage piles: beams stacked flat, iron bars on top, sheets leaning in a row.
  for (let i = 0; i < 4; i++) add('old-wooden-beam', 21, 15.5, 0, i * BEAM);
  add('rusty-iron-bar', 21, 15.5, 0.15, 4 * BEAM);
  add('rusty-iron-bar', 21, 15.5, -0.1, 4 * BEAM + 0.31);
  for (let i = 0; i < 3; i++) add('rusty-corrugated-sheet', 29 + i * 0.3, 16, turn);
  add('old-water-pipe', 24, 26.5);
  add('old-iron-bucket', 28, 25.5, 0, 0, 0.6);
  add('rusted-wire-coil', 30, 25);
  add('old-wooden-crate', 21, 25);
  add('rusty-iron-bar', 21, 25, 0.3, CRATE_TOP);
  add('lon-cu-nat', 21.2, 24.6, 0, CRATE_TOP);

  /* -------------------------------------------------------- avenue */
  for (const z of [-30, -10, 10, 28]) for (const x of [-6, 7]) add('military-lamp-post', x, z);
  return parts;
}

/** Camp group ids live in their own range (structures use hashed ids below it). */
const CAMP_GROUP_BASE = 0x80000000;

/** Assets that make up walls and buildings (auto-grouped when they touch each other). */
const STRUCTURAL = new Set<number>([
  'barbed-wire-fence', 'iron-fence', 'wooden-fence', 'large-stone-brick-wall', 'sandbag-wall', 'rusty-corrugated-sheet',
  'perforated-corrugated-sheet', 'rusty-metal-plate', 'old-dusty-wood-board', 'old-wooden-beam', 'rusty-iron-wall-ladder',
  'rusty-iron-bar', 'concrete-wall', 'concrete-wall-panel', 'mossy-concrete-wall', 'broken-concrete-wall', 'glass-pane',
  'broken-glass-pane', 'shattered-glass-pane',
].map((k) => CAMP_ASSET[k as keyof typeof CAMP_ASSET]));

/** Half length of a structural piece along its long side (metres, before scale). */
const HALF_LEN: Record<number, number> = {
  [CAMP_ASSET['barbed-wire-fence']]: 2, [CAMP_ASSET['iron-fence']]: 1.13, [CAMP_ASSET['wooden-fence']]: 2,
  [CAMP_ASSET['large-stone-brick-wall']]: 2, [CAMP_ASSET['sandbag-wall']]: 1.13, [CAMP_ASSET['rusty-metal-plate']]: 1,
  [CAMP_ASSET['concrete-wall']]: 2, [CAMP_ASSET['concrete-wall-panel']]: 2.5, [CAMP_ASSET['mossy-concrete-wall']]: 2,
  [CAMP_ASSET['broken-concrete-wall']]: 2, [CAMP_ASSET['old-wooden-beam']]: 1.44, [CAMP_ASSET['old-dusty-wood-board']]: 0.75,
  [CAMP_ASSET['rusty-corrugated-sheet']]: 0.5, [CAMP_ASSET['perforated-corrugated-sheet']]: 0.5,
};

/**
 * The default camp's group configuration (what the Studio's Group button stores): one group per
 * wall face — pieces in a straight, unbroken run sharing a line and height — and one per roof
 * (adjacent horizontal plates at the same height). Run once when the default layout is defined;
 * the game itself never groups anything at runtime, and Studio-saved layouts keep their own groups.
 */
function wallFaceGroups(parts: CampPart[]): CampPart[] {
  const out = parts.map((p) => ({ ...p }));
  let next = 0;
  // Walls: bucket by orientation (mod 180°), line offset and height; split runs at gaps.
  const runs = new Map<string, Array<{ i: number; along: number; half: number }>>();
  out.forEach((p, i) => {
    if (!STRUCTURAL.has(p.asset) || p.asset === CAMP_ASSET['rusty-metal-plate']) return;
    let yaw = p.yaw % Math.PI;
    if (yaw < 0) yaw += Math.PI;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const normal = p.x * sn + p.z * c;
    const along = p.x * c - p.z * sn;
    const key = `${Math.round(yaw * 10)}|${Math.round(normal * 2)}|${Math.round(p.y * 2)}`;
    const list = runs.get(key) ?? [];
    list.push({ i, along, half: (HALF_LEN[p.asset] ?? 0.6) * p.scale });
    runs.set(key, list);
  });
  for (const list of runs.values()) {
    list.sort((a, b) => a.along - b.along);
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 2) {
        next++;
        for (const i of run) out[i]!.group = next;
      }
      run = [];
    };
    for (let k = 0; k < list.length; k++) {
      const cur = list[k]!;
      const prev = list[k - 1];
      if (prev && cur.along - prev.along > cur.half + prev.half + 0.6) flush();
      run.push(cur.i);
    }
    flush();
  }
  // Roofs: horizontal plates touching each other at the same height.
  const plates = out.map((p, i) => (p.asset === CAMP_ASSET['rusty-metal-plate'] && p.y > 0.5 ? i : -1)).filter((i) => i >= 0);
  const seen = new Set<number>();
  for (const start of plates) {
    if (seen.has(start)) continue;
    const comp = [start];
    seen.add(start);
    for (let k = 0; k < comp.length; k++) {
      const a = out[comp[k]!]!;
      for (const j of plates) {
        if (seen.has(j)) continue;
        const b = out[j]!;
        if (Math.abs(a.y - b.y) < 0.3 && Math.abs(a.x - b.x) <= 2.2 && Math.abs(a.z - b.z) <= 2.2) {
          seen.add(j);
          comp.push(j);
        }
      }
    }
    if (comp.length >= 2) {
      next++;
      for (const i of comp) out[i]!.group = next;
    }
  }
  return out;
}

/**
 * The default camp: the layout published from Camp Studio (see camp-default.ts). The procedural
 * builder above stays as the original reference design.
 */
export const CAMP_LAYOUT: CampPart[] = DEFAULT_CAMP_PARTS;
/** The original procedural camp (with wall-face groups), kept for tooling and tests. */
export const PROCEDURAL_CAMP_LAYOUT = (): CampPart[] => wallFaceGroups(buildCampLayout());

export function campChunkProps(site: CampSite, cx: number, cz: number, layout: readonly CampPart[] = CAMP_LAYOUT): PropInstance[] {
  const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
  return layout.filter(p => {
    const x = site.x + p.x, z = site.z + p.z;
    return x >= ox && x < ox + CHUNK_SIZE && z >= oz && z < oz + CHUNK_SIZE;
  }).map(p => ({ asset: p.asset, lx: quantizeLocal(site.x + p.x - ox), lz: quantizeLocal(site.z + p.z - oz), yq: quantizeHeight(site.y + p.y), rot: quantizeRotation(p.yaw), scale: quantizeScale(p.scale), group: p.group ? (CAMP_GROUP_BASE | p.group) >>> 0 : 0 }));
}
