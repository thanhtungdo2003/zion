import { CAMP_ASSET, FURNITURE_ASSET, MATERIAL_ASSET, STREET_ASSET, type ConcreteFinish } from '@zion/assets';
import type { Rng } from '@zion/shared';
import type { CampPart } from './camp';

/**
 * Enterable masonry buildings from the material kit, on 3.2 m storeys (0.2 m slab + 3 m walls):
 * - brick houses: walls stacked from 2 m × 1 m brick courses (door: the top course only; window:
 *   the bottom and top course, a 1 m opening to climb through);
 * - concrete blocks: 3 m panels per storey (window: sill + lintel, a 1.6 m opening; door: lintel).
 * Floors are 2 m slab tiles; a straight stair against the left wall climbs to every floor and the
 * flat roof (parapet all round). Front = local −Z. Spawn spots on every floor.
 */
export type SpawnSpot = readonly [number, number, number];
export interface MasonryOptions {
  material: 'brick' | 'concrete';
  finish?: ConcreteFinish;
  /** Footprint (m): brick multiples of 2, concrete multiples of 6; depth ≥ 8. */
  w: number;
  d: number;
  floors: number;
  /** Upper floors left open (a building site): no walls above the first storey, no roof parapet. */
  unfinished?: boolean;
  /** 'L': the front-right corner left out (brick 4 × 4 m, concrete 6 × 6 m): a wing round a yard. */
  shape?: 'rect' | 'L';
  /**
   * Lived-in interior: a partition wall with a doorway makes rooms, each room may hold a table
   * with chairs, the stair is two step blocks wide (1.8 m) with a rail along its opening on every
   * upper floor, and a loot crate stands on some floors only (one at most), not on every floor.
   */
  interior?: boolean;
}

const STOREY = 3.2, SLAB = .2;

export function masonryBuilding(parts: CampPart[], spawns: SpawnSpot[], cx: number, cz: number, yaw: number, o: MasonryOptions, group: number, rng: Rng): void {
  // The plain block keeps its exact original layout (and random draws): saved worlds stay put.
  if (o.interior || o.shape === 'L') { livedInBuilding(parts, spawns, cx, cz, yaw, o, group, rng); return; }
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const put = (asset: number, lx: number, y: number, lz: number, partYaw = 0, scale = 1) =>
    parts.push({ asset, x: cx + lx * c + lz * s, y, z: cz - lx * s + lz * c, yaw: partYaw + yaw, scale, group });
  const { w, d } = o, tilesX = w / 2, tilesZ = d / 2;
  const brick = o.material === 'brick', module = brick ? 2 : 3, finish = o.finish ?? 'ivory';
  const stairX = -w / 2 + .8, steps = 16, run = .3, holeFront = -d / 2 + 2 * (tilesZ - 3);
  const inStairwell = (i: number, j: number) => i === 0 && j >= tilesZ - 3;
  /** One wall module centred at (lx, lz) on floor y, turned by `wy`. */
  const segment = (kind: 'wall' | 'window' | 'door', lx: number, y: number, lz: number, wy: number) => {
    const base = y + SLAB;
    if (brick) {
      // Three 1 m courses; openings leave the bottom (door) or middle (window) course out.
      if (kind === 'wall' || kind === 'window') put(MATERIAL_ASSET.brick, lx, base, lz, wy);
      if (kind === 'wall') put(MATERIAL_ASSET.brick, lx, base + 1, lz, wy);
      put(MATERIAL_ASSET.brick, lx, base + 2, lz, wy);
      return;
    }
    if (kind === 'wall') { put(MATERIAL_ASSET.panel[finish], lx, base, lz, wy); return; }
    if (kind === 'window') put(MATERIAL_ASSET.sill[finish], lx, base, lz, wy);
    put(MATERIAL_ASSET.lintel[finish], lx, base + 2.5, lz, wy);
  };
  const walled = (f: number) => !o.unfinished || f === 0;
  // Where storeys meet, a slim band runs round the outside, covering the floor slab's edge.
  const band = (y: number) => {
    const asset = brick ? MATERIAL_ASSET.band.brick : MATERIAL_ASSET.band.concrete, out = brick ? .1 : .05;
    for (let i = 0; i < w / module; i++) { const lx = -w / 2 + module / 2 + i * module; put(asset, lx, y - .06, -d / 2 - out, 0); put(asset, lx, y - .06, d / 2 + out, 0); }
    for (let j = 0; j < d / module; j++) { const lz = -d / 2 + module / 2 + j * module; put(asset, -w / 2 - out, y - .06, lz, Math.PI / 2); put(asset, w / 2 + out, y - .06, lz, Math.PI / 2); }
  };
  for (let f = 0; f <= o.floors; f++) {
    const y = f * STOREY;
    if (f > 0 && (walled(f) || f === 1)) band(y);
    for (let i = 0; i < tilesX; i++) for (let j = 0; j < tilesZ; j++) {
      if (f > 0 && inStairwell(i, j)) continue;
      put(f === o.floors ? STREET_ASSET.roof : STREET_ASSET.slab, -w / 2 + 1 + i * 2, y, -d / 2 + 1 + j * 2);
    }
    if (f === o.floors) {
      if (o.unfinished) break;
      // Roof parapet: one brick course / concrete sill all round, a rail beside the stair opening.
      const edge = (lx: number, lz: number, wy: number) => brick ? put(MATERIAL_ASSET.brick, lx, y + SLAB, lz, wy) : put(MATERIAL_ASSET.sill[finish], lx, y + SLAB, lz, wy);
      for (let i = 0; i < w / module; i++) { const lx = -w / 2 + module / 2 + i * module; edge(lx, -d / 2 + .15, 0); edge(lx, d / 2 - .15, 0); }
      for (let j = 0; j < d / module; j++) { const lz = -d / 2 + module / 2 + j * module; edge(-w / 2 + .15, lz, Math.PI / 2); edge(w / 2 - .15, lz, Math.PI / 2); }
      for (let z = holeFront + .5; z < d / 2 - .2; z += 1) put(STREET_ASSET.parapetB, -w / 2 + 2.1, y + SLAB, z, Math.PI / 2);
      break;
    }
    for (let n = 0; n < steps; n++) put(STREET_ASSET.step, stairX, y + SLAB + n * .2, holeFront + .16 + (steps - 1 - n) * run);
    // Loot: a crate or two on every floor, in the corners away from the stair.
    put(rng.next() < .5 ? CAMP_ASSET['military-wooden-crate'] : CAMP_ASSET['old-wooden-crate'], w / 2 - 1.2, y + SLAB, -d / 2 + 1.2, rng.next() * .4);
    if (w * d > 120 && rng.next() < .7) put(CAMP_ASSET['old-wooden-crate'], w / 2 - 1.2, y + SLAB, d / 2 - 1.4, rng.next() * .4);
    if (w * d > 200 && rng.next() < .5) put(CAMP_ASSET['old-carton-box'], 0, y + SLAB, d / 2 - 1.2, rng.next() * 3);
    spawns.push([cx + 1 * c + 0 * s, y + .3, cz - 1 * s + 0 * c], [cx + (w / 4) * c + (-d / 4) * s, y + .3, cz - (w / 4) * s + (-d / 4) * c]);
    if (!walled(f)) continue;
    // Front: a door in the middle on the ground floor, windows elsewhere; back: a door, windows.
    const across = w / module, deep = d / module, mid = Math.floor(across / 2);
    for (let i = 0; i < across; i++) {
      const lx = -w / 2 + module / 2 + i * module, edgeCol = i === 0 || i === across - 1;
      const front = edgeCol ? 'wall' : f === 0 && i === mid ? 'door' : (i % 2 === 1 || rng.next() < .3) ? 'window' : 'wall';
      segment(front, lx, y, -d / 2 + .15, 0);
      const back = edgeCol ? 'wall' : f === 0 && i === across - 2 ? 'door' : i % 2 === 0 ? 'window' : 'wall';
      segment(back, lx, y, d / 2 - .15, 0);
    }
    // Sides: the left (stair) side is blind, windows on the right.
    for (let j = 0; j < deep; j++) {
      const lz = -d / 2 + module / 2 + j * module, edgeRow = j === 0 || j === deep - 1;
      segment('wall', -w / 2 + .15, y, lz, Math.PI / 2);
      segment(!edgeRow && j % 2 === 1 ? 'window' : 'wall', w / 2 - .15, y, lz, Math.PI / 2);
    }
  }
}

const TABLES = [FURNITURE_ASSET.tableLong, FURNITURE_ASSET.tableDark, FURNITURE_ASSET.tableWood, FURNITURE_ASSET.tableRed, FURNITURE_ASSET.tableRound] as const;
/** Table footprints (length along local x, width across), matching the furniture assets. */
const TABLE_SIZE: Record<number, readonly [number, number]> = {
  [FURNITURE_ASSET.tableLong]: [2.95, 1], [FURNITURE_ASSET.tableDark]: [1.9, .9], [FURNITURE_ASSET.tableWood]: [2.03, .91],
  [FURNITURE_ASSET.tableRed]: [1.42, .71], [FURNITURE_ASSET.tableRound]: [.9, .9],
};

/** A straight wall line along x (z fixed) or along z (x fixed); `out` is the outside's sign. */
interface WallRun { along: 'x' | 'z'; at: number; from: number; to: number; out: 1 | -1; role: 'front' | 'back' | 'left' | 'side' | 'inner' }
interface Room { x0: number; x1: number; z0: number; z1: number }

/** The lived-in variant of masonryBuilding: L footprint, rooms, furniture, wide railed stair. */
function livedInBuilding(parts: CampPart[], spawns: SpawnSpot[], cx: number, cz: number, yaw: number, o: MasonryOptions, group: number, rng: Rng): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const put = (asset: number, lx: number, y: number, lz: number, partYaw = 0, scale = 1) =>
    parts.push({ asset, x: cx + lx * c + lz * s, y, z: cz - lx * s + lz * c, yaw: partYaw + yaw, scale, group });
  const { w, d } = o, tilesX = w / 2, tilesZ = d / 2;
  const brick = o.material === 'brick', module = brick ? 2 : 3, finish = o.finish ?? 'ivory';
  const steps = 16, run = .3, holeFront = -d / 2 + 2 * (tilesZ - 3);
  // Two 1.2 m step blocks side by side fill the 2 m stairwell (1.8 m clear), no gap to the wall.
  const stairXs = o.interior ? [-w / 2 + .8, -w / 2 + 1.4] : [-w / 2 + .8];
  const inStairwell = (i: number, j: number) => i === 0 && j >= tilesZ - 3;
  // The L's missing corner (front right), a multiple of both the slab tile and the wall module.
  const cutW = o.shape === 'L' ? (brick ? 4 : 6) : 0, cutD = cutW;
  const present = (lx: number, lz: number) => !(cutW && lx > w / 2 - cutW && lz < -d / 2 + cutD);
  const runs: WallRun[] = cutW ? [
    { along: 'x', at: -d / 2, from: -w / 2, to: w / 2 - cutW, out: -1, role: 'front' },
    { along: 'x', at: -d / 2 + cutD, from: w / 2 - cutW, to: w / 2, out: -1, role: 'side' },
    { along: 'z', at: w / 2 - cutW, from: -d / 2, to: -d / 2 + cutD, out: 1, role: 'side' },
    { along: 'z', at: w / 2, from: -d / 2 + cutD, to: d / 2, out: 1, role: 'side' },
    { along: 'x', at: d / 2, from: -w / 2, to: w / 2, out: 1, role: 'back' },
    { along: 'z', at: -w / 2, from: -d / 2, to: d / 2, out: -1, role: 'left' },
  ] : [
    { along: 'x', at: -d / 2, from: -w / 2, to: w / 2, out: -1, role: 'front' },
    { along: 'x', at: d / 2, from: -w / 2, to: w / 2, out: 1, role: 'back' },
    { along: 'z', at: -w / 2, from: -d / 2, to: d / 2, out: -1, role: 'left' },
    { along: 'z', at: w / 2, from: -d / 2, to: d / 2, out: 1, role: 'side' },
  ];
  // A partition (with one doorway) splits the main body from the side room or the L's wing.
  const split = w / 2 - (cutW || (brick ? 4 : 6)), wingFront = cutW ? -d / 2 + cutD : -d / 2;
  const partitions: WallRun[] = o.interior ? [{ along: 'z', at: split, from: wingFront, to: d / 2, out: 1, role: 'inner' }] : [];
  const rooms: Room[] = o.interior ? [
    { x0: -w / 2 + 2.3, x1: split - .3, z0: -d / 2 + .5, z1: d / 2 - .5 },
    { x0: split + .3, x1: w / 2 - .5, z0: wingFront + .5, z1: d / 2 - .5 },
  ] : [];
  /** One wall module centred at (lx, lz) on floor y, turned by `wy`. */
  const segment = (kind: 'wall' | 'window' | 'door', lx: number, y: number, lz: number, wy: number) => {
    const base = y + SLAB;
    if (brick) {
      if (kind === 'wall' || kind === 'window') put(MATERIAL_ASSET.brick, lx, base, lz, wy);
      if (kind === 'wall') put(MATERIAL_ASSET.brick, lx, base + 1, lz, wy);
      put(MATERIAL_ASSET.brick, lx, base + 2, lz, wy);
      return;
    }
    if (kind === 'wall') { put(MATERIAL_ASSET.panel[finish], lx, base, lz, wy); return; }
    if (kind === 'window') put(MATERIAL_ASSET.sill[finish], lx, base, lz, wy);
    put(MATERIAL_ASSET.lintel[finish], lx, base + 2.5, lz, wy);
  };
  /** Module centres along a run, and where a piece on it sits (`inset` towards the inside). */
  const modules = (r: WallRun) => Array.from({ length: Math.round((r.to - r.from) / module) }, (_, k) => r.from + module / 2 + k * module);
  const place = (r: WallRun, t: number, inset: number): [number, number, number] =>
    r.along === 'x' ? [t, r.at - r.out * inset, 0] : [r.at - r.out * inset, t, Math.PI / 2];
  const walled = (f: number) => !o.unfinished || f === 0;
  const band = (y: number) => {
    const asset = brick ? MATERIAL_ASSET.band.brick : MATERIAL_ASSET.band.concrete, out = brick ? .1 : .05;
    for (const r of runs) for (const t of modules(r)) { const [lx, lz, wy] = place(r, t, -out); put(asset, lx, y - .06, lz, wy); }
  };
  const rail = (y: number) => { for (let z = holeFront + .5; z < d / 2 - .2; z += 1) put(STREET_ASSET.parapetB, -w / 2 + 2.1, y + SLAB, z, Math.PI / 2); };
  // Loot crates on about a third of the floors (at least one), one crate each.
  const crateFloors = new Set<number>();
  for (let f = 0; f < o.floors; f++) if (rng.next() < .35) crateFloors.add(f);
  if (!crateFloors.size) crateFloors.add(Math.floor(rng.next() * o.floors));

  /** A table in the middle of a room, turned along its long side, chairs drawn up round it. */
  const furnish = (room: Room, y: number) => {
    const rw = room.x1 - room.x0, rd = room.z1 - room.z0, long = Math.max(rw, rd), short = Math.min(rw, rd);
    const fits = TABLES.filter((t) => TABLE_SIZE[t]![0] + 1.6 < long && TABLE_SIZE[t]![1] + 1.6 < short);
    if (!fits.length) return;
    const table = fits[Math.floor(rng.next() * fits.length)]!, [tl, tw] = TABLE_SIZE[table]!;
    const turned = rd > rw, mx = (room.x0 + room.x1) / 2, mz = (room.z0 + room.z1) / 2;
    put(table, mx, y, mz, turned ? Math.PI / 2 : 0);
    const chair = rng.next() < .5 ? FURNITURE_ASSET.chairMetal : FURNITURE_ASSET.chairWood;
    const per = tl > 1.6 ? 2 : 1;
    for (const side of [-1, 1]) for (let k = 0; k < per; k++) {
      const skip = rng.next() < .2, jitter = (rng.next() - .5) * .35;
      if (skip) continue;
      const along = per === 1 ? 0 : (k - .5) * tl * .5, away = tw / 2 + .38;
      // A chair faces +z: turned to face the table, a little askew.
      if (turned) put(chair, mx + side * away, y, mz + along, (side < 0 ? Math.PI / 2 : -Math.PI / 2) + jitter);
      else put(chair, mx + along, y, mz + side * away, (side < 0 ? 0 : Math.PI) + jitter);
    }
  };

  for (let f = 0; f <= o.floors; f++) {
    const y = f * STOREY;
    if (f > 0 && (walled(f) || f === 1)) band(y);
    for (let i = 0; i < tilesX; i++) for (let j = 0; j < tilesZ; j++) {
      const lx = -w / 2 + 1 + i * 2, lz = -d / 2 + 1 + j * 2;
      if ((f > 0 && inStairwell(i, j)) || !present(lx, lz)) continue;
      put(f === o.floors ? STREET_ASSET.roof : STREET_ASSET.slab, lx, y, lz);
    }
    if (f === o.floors) {
      if (o.unfinished) break;
      for (const r of runs) for (const t of modules(r)) { const [lx, lz, wy] = place(r, t, .15); put(brick ? MATERIAL_ASSET.brick : MATERIAL_ASSET.sill[finish], lx, y + SLAB, lz, wy); }
      rail(y);
      break;
    }
    for (let n = 0; n < steps; n++) for (const sx of stairXs) put(STREET_ASSET.step, sx, y + SLAB + n * .2, holeFront + .16 + (steps - 1 - n) * run);
    if (f > 0) rail(y);
    if (o.interior) {
      if (crateFloors.has(f)) {
        const room = rooms[Math.floor(rng.next() * rooms.length)]!;
        put(rng.next() < .5 ? CAMP_ASSET['military-wooden-crate'] : CAMP_ASSET['old-wooden-crate'], room.x1 - .7, y + SLAB, room.z0 + .7, rng.next() * .4);
      }
      for (const room of rooms) if (rng.next() < .8) furnish(room, y + SLAB);
    } else if (crateFloors.has(f)) put(CAMP_ASSET['old-wooden-crate'], w / 2 - cutW - 1.2, y + SLAB, d / 2 - 1.4, rng.next() * .4);
    spawns.push([cx + 1 * c, y + .3, cz - 1 * s], [cx - (w / 4) * c + (d / 4) * s, y + .3, cz + (w / 4) * s + (d / 4) * c]);
    if (!walled(f)) continue;
    for (const r of runs) {
      const ts = modules(r), mid = Math.floor(ts.length / 2);
      ts.forEach((t, k) => {
        const edge = k === 0 || k === ts.length - 1;
        // Front: a door in the middle of the ground floor; back: a door; the stair side blind.
        const kind = r.role === 'left' || edge ? 'wall'
          : r.role === 'front' ? f === 0 && k === mid ? 'door' : (k % 2 === 1 || rng.next() < .3) ? 'window' : 'wall'
          : r.role === 'back' ? f === 0 && k === ts.length - 2 ? 'door' : k % 2 === 0 ? 'window' : 'wall'
          : k % 2 === 1 ? 'window' : 'wall';
        const [lx, lz, wy] = place(r, t, .15);
        segment(kind, lx, y, lz, wy);
      });
    }
    for (const r of partitions) {
      const ts = modules(r), door = Math.max(0, Math.floor(ts.length / 2) - (f % 2));
      ts.forEach((t, k) => { const [lx, lz, wy] = place(r, t, 0); segment(k === door ? 'door' : 'wall', lx, y, lz, wy); });
    }
  }
}

/** A free-standing brick wall (courses `high` metres tall) from (ax, az) to (bx, bz), with gaps. */
export function brickWall(parts: CampPart[], ax: number, az: number, bx: number, bz: number, high: number, group: number, gaps: number[] = []): void {
  const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 2)), yaw = Math.atan2(-(bz - az), bx - ax);
  for (let i = 0; i < n; i++) {
    if (gaps.includes(i)) continue;
    const x = ax + (bx - ax) * (i + .5) / n, z = az + (bz - az) * (i + .5) / n;
    for (let k = 0; k < high; k++) parts.push({ asset: MATERIAL_ASSET.brick, x, y: k, z, yaw, scale: 1, group });
  }
}

/** Voxel construction-site kit (prepared from the asset pack, ids 2660–2670). */
export const SITE_ASSET = {
  barrel: 2660, brickPallet: 2661, blockPallet: 2662, lumber: 2663, cabin: 2664, cabinStack: 2665,
  hoist: 2666, crate: 2667, crateSmall: 2668, beams: 2669, crateTall: 2670,
} as const;

/**
 * A building site: a bare concrete frame going up in the middle (slabs, stairs, ground-floor
 * walls), a brick wall round the yard with a gate on the street, the site cabin, a hoist, pallets
 * of bricks and blocks, lumber, steel beams, barrels and crates. About 24 × 24 m.
 */
export function constructionSite(parts: CampPart[], spawns: SpawnSpot[], cx: number, cz: number, yaw: number, group: number, rng: Rng): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (lx: number, lz: number) => [cx + lx * c + lz * s, cz - lx * s + lz * c] as const;
  const put = (asset: number, lx: number, lz: number, y = 0, partYaw = 0, scale = 1) => { const [x, z] = at(lx, lz); parts.push({ asset, x, y, z, yaw: partYaw + yaw, scale, group }); };
  const [fx, fz] = at(0, 1);
  masonryBuilding(parts, spawns, fx, fz, yaw, { material: 'concrete', finish: rng.next() < .5 ? 'gray' : 'ivory', w: 12, d: 12, floors: 2 + Math.floor(rng.next() * 2), unfinished: true }, group, rng);
  // Yard wall: two courses of brick, a 6 m gate in the front.
  const wall = (ax: number, az: number, bx: number, bz: number, gaps: number[] = []) => { const [x0, z0] = at(ax, az), [x1, z1] = at(bx, bz); brickWall(parts, x0, z0, x1, z1, 2, group, gaps); };
  wall(-12, -12, 12, -12, [5, 6]);
  wall(-12, 12, 12, 12);
  wall(-12, -12, -12, 12);
  wall(12, -12, 12, 12, [2]);
  // Materials and plant round the frame.
  put(SITE_ASSET.cabin, 9, 8.5, 0, Math.PI / 2, .7);
  // The gate: a striped barrier to one side and cones out on the street.
  put(2681, 4.5, -13.2, 0, 0);
  for (let i = 0; i < 4; i++) put(2687, -3 + i * 2, -14.6, 0, 0);
  // The site office's supplies.
  put(CAMP_ASSET['military-wooden-crate'], 6, 6.5, 0, 0);
  put(SITE_ASSET.hoist, -9, -8, 0);
  put(SITE_ASSET.beams, 0, -8.5, 0, 0, .55);
  for (const [lx, lz] of [[-9.5, 2], [-9.5, 5]] as const) put(rng.next() < .5 ? SITE_ASSET.brickPallet : SITE_ASSET.blockPallet, lx, lz, 0, rng.next() * .3);
  put(SITE_ASSET.lumber, 8.5, -6, 0, rng.next() * .4);
  for (let i = 0; i < 4; i++) put(SITE_ASSET.barrel, 9.5 + (i % 2) * .7, -9.5 + Math.floor(i / 2) * .7, 0, rng.next() * 6);
  for (const [lx, lz, a] of [[-10, 9.5, SITE_ASSET.crate], [-9, 9.8, SITE_ASSET.crateSmall], [-10.2, 8.4, SITE_ASSET.crateTall], [6, 10, SITE_ASSET.crate]] as const) put(a, lx, lz, 0, rng.next() * .5);
  spawns.push([cx + 6 * c - 6 * s, .1, cz - 6 * s - 6 * c], [cx - 6 * c + 6 * s, .1, cz + 6 * s + 6 * c]);
}
