import { CAMP_ASSET, BRIDGE_ASSET, BATTLE_ASSET, BUILDING_ASSET } from '@zion/assets';
import { Rng, hashCombine, smoothstep } from '@zion/shared';
import type { CampPart } from './camp';
import type { WorldGenerator } from './generator';
import type { Structure } from './structures';
import { importedRoofAccess } from './imported-buildings';

const cache = new WeakMap<WorldGenerator, Structure[]>();
/** Four kilometres of rolling valleys, ridgelines and mountain passes. */
export function battleTerrain(seed: number, size: number, sea: number, x: number, z: number): number {
  const phase = (seed % 10000) / 1000;
  const nx = (x - size * .5) / (size * .44), nz = (z - size * .5) / (size * .42);
  const angle = Math.atan2(nz, nx);
  // Seeded bays and headlands, surrounded by an ocean margin on every side.
  const coast = Math.min(1.08, 1 + .09 * Math.sin(angle * 3 + phase) + .055 * Math.sin(angle * 5 - phase * 2) + .035 * Math.cos(angle * 9 + phase));
  const inland = (coast - Math.hypot(nx, nz)) * size * .42;
  const ridge = Math.pow((1 + Math.sin(x / 480 + Math.sin(z / 630 + phase) * 1.4 + phase)) / 2, 3);
  const land = sea + 24 + ridge * 145 + Math.sin(x / 175 + phase) * 10 + Math.cos(z / 230 - phase) * 12;
  return sea - 24 + (land - sea + 24) * smoothstep(-65, 130, inland);
}

function building(parts: CampPart[], x: number, z: number, floors: number, group: number, unfinished: boolean): void {
  const put = (asset: number, dx: number, y: number, dz: number, yaw = 0, scale = 1) => parts.push({ asset, x: x + dx, y, z: z + dz, yaw, scale, group });
  const floorHeight = 3.2;
  for (let level = 0; level <= floors; level++) {
    const y = .24 + level * floorHeight;
    for (let fx = -5; fx <= 5; fx += 2) for (let fz = -5; fz <= 5; fz += 2) {
      // Leave a full stairwell through every upper floor.
      if (level > 0 && fx === 5 && Math.abs(fz) < 4) continue;
      put(BRIDGE_ASSET.woodenDeck, fx, y, fz);
    }
    if (level === floors) {
      // Walkable roof terrace; the stair opening stays clear all the way up.
      for (const side of [-1, 1]) for (let offset = -5.4; offset <= 5.41; offset += 1.2) {
        put(CAMP_ASSET['concrete-wall'], offset, y, side * 6, 0, .3);
        put(CAMP_ASSET['concrete-wall'], side * 6, y, offset, Math.PI / 2, .3);
      }
      continue;
    }
    // Only the ground floor has a rear entrance. Upper front doors lead to balconies.
    for (const side of level === 0 ? [-1, 1] : [-1]) {
      put(BATTLE_ASSET.door, 0, y, side * 6.02);
      put(BATTLE_ASSET.doorJamb, -1.28125, y, side * 6);
      put(BATTLE_ASSET.doorJamb, 1.28125, y, side * 6);
      put(BATTLE_ASSET.doorLintel, 0, y + 2.125, side * 6);
    }
    for (const side of [-1, 1]) for (const offset of [-4, 0, 4]) {
      put(CAMP_ASSET['concrete-wall'], side * 6, y, offset, Math.PI / 2);
      // Full-height walls meet the slab above; no unframed four-metre gaps.
      if (offset !== 0 || (level > 0 && side === 1)) put(CAMP_ASSET['concrete-wall'], offset, y, side * 6);
    }
    if (level > 0) {
      // Outer balcony corners carry each slab down to the floor below.
      for (const dx of [-3.8, 3.8]) put(BATTLE_ASSET.balconyPost, dx, y - floorHeight, -9.8);
      for (const fx of [-3, -1, 1, 3]) for (const fz of [-7, -9]) put(BRIDGE_ASSET.woodenDeck, fx, y, fz);
      for (let offset = -3.6; offset <= 3.61; offset += 1.2) put(CAMP_ASSET['concrete-wall'], offset, y, -10, 0, .3);
      for (const side of [-1, 1]) for (const fz of [-6.6, -7.8, -9]) put(CAMP_ASSET['concrete-wall'], side * 4, y, fz, Math.PI / 2, .3);
    }
    for (let step = 0; step < 16; step++) {
      put(BRIDGE_ASSET.woodenDeck, 5, y + (step + 1) * .2, -3.75 + step * .5, 0, .5);
    }
    put(CAMP_ASSET['military-wooden-crate'], -3, y, -3);
    put(CAMP_ASSET['old-wooden-crate'], -3, y, 3);
    if (unfinished) put(CAMP_ASSET['rusty-oil-barrel'], 1, y, -2);
  }
}

/** Shared tower layout: an outside ladder leads through a gap in the platform railing. */
export function battleTower(parts: CampPart[], x: number, z: number, group: number, water: boolean): void {
  const put = (asset: number, dx: number, y: number, dz: number, yaw = 0, scale = 1) => parts.push({ asset, x: x + dx, y, z: z + dz, yaw, scale, group });
  for (const dx of [-2.4, 2.4]) for (const dz of [-2.4, 2.4]) put(BATTLE_ASSET.towerPost, dx, 0, dz);
  for (const dx of [-2, 0, 2]) for (const dz of [-2, 0, 2]) put(BRIDGE_ASSET.woodenDeck, dx, 8, dz);
  for (const side of [-1, 1]) for (const offset of [-2.4, -1.2, 0, 1.2, 2.4]) {
    put(CAMP_ASSET['concrete-wall'], side * 3, 8, offset, Math.PI / 2, .3);
    if (side !== 1 || offset !== 0) put(CAMP_ASSET['concrete-wall'], offset, 8, side * 3, 0, .3);
  }
  for (let y = 0; y <= 8; y += 2) put(CAMP_ASSET['rusty-iron-wall-ladder'], 0, y, 3.25, 0, y === 8 ? .75 : 1);
  if (water) put(BATTLE_ASSET.waterTank, 0, 8, 0);
  else {
    for (const dx of [-2.4, 2.4]) for (const dz of [-2.4, 2.4]) put(BATTLE_ASSET.towerPost, dx, 8, dz, 0, .35);
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) put(BRIDGE_ASSET.woodenDeck, dx, 10.8, dz);
  }
  put(CAMP_ASSET['old-wooden-crate'], water ? -2.4 : -1.8, 8, 0);
}

const SITE_KINDS: { kind: Structure['kind']; count: number; radius: number }[] = [
  { kind: 'town', count: 10, radius: 128 },
  { kind: 'factory', count: 12, radius: 45 },
  { kind: 'farm', count: 24, radius: 64 },
  { kind: 'ruined_camp', count: 12, radius: 32 },
  { kind: 'watchtower', count: 16, radius: 12 },
  { kind: 'water_tower', count: 12, radius: 12 },
  { kind: 'hamlet', count: 28, radius: 38 },
  { kind: 'house_small', count: 36, radius: 19 },
];

export function battleStructures(gen: WorldGenerator): Structure[] {
  const cached = cache.get(gen); if (cached) return cached;
  const rng = new Rng(hashCombine(gen.seed, 0xba771e));
  const result: Structure[] = [];
  const slots = SITE_KINDS.flatMap(site => Array.from({ length: site.count }, () => site));
  // Towns anchor inhabited districts; satellite farms, hamlets and towers fill their outskirts.
  for (let attempt = 0; result.length < slots.length && attempt < 30000; attempt++) {
    const index = result.length;
    const { kind, radius } = slots[index]!;
    let x = gen.worldSize * (.12 + rng.next() * .76), z = gen.worldSize * (.12 + rng.next() * .76);
    if (kind !== 'town' && attempt % 3 !== 0) {
      const town = result[Math.floor(rng.next() * Math.min(10, result.length))]!;
      const angle = rng.next() * Math.PI * 2, distance = 175 + rng.next() * 480;
      x = town.x + Math.cos(angle) * distance; z = town.z + Math.sin(angle) * distance;
    }
    x = Math.round(x); z = Math.round(z);
    if (x < radius + 100 || z < radius + 100 || x > gen.worldSize - radius - 100 || z > gen.worldSize - radius - 100) continue;
    if (result.some(s => Math.hypot(s.x - x, s.z - z) < s.radius + radius + (kind === 'town' ? 220 : 28))) continue;
    // Keep the complete foundation and its blend off beaches, bays and the ocean.
    if (Array.from({ length: 12 }, (_, i) => i * Math.PI / 6).some(angle => battleTerrain(gen.seed, gen.worldSize, gen.seaLevel, x + Math.cos(angle) * (radius + 24), z + Math.sin(angle) * (radius + 24)) < gen.seaLevel + 7)) continue;
    const unfinished = kind === 'factory' && index % 2 === 0;
    const parts: CampPart[] = [];
    if (kind === 'town') {
      let group = 1;
      for (const row of [-66, -22, 22, 66]) for (const column of [-54, -30, 30, 54]) {
        // A complete apartment replaces two lots; neighbouring buildings stay outside its footprint.
        if (row === -22 && column === -30) continue;
        const bx = column + (rng.next() - .5) * 3, bz = row + (rng.next() - .5) * 3;
        if (row === -22 && column === -54) parts.push({ asset: BUILDING_ASSET.apartment, x: -42, z: row, y: .08, yaw: 0, scale: 1, group });
        else if (group % 6 === 0) parts.push({ asset: group % 12 ? 2420 : 2403, x: bx, z: bz, y: .08, yaw: rng.next() > .5 ? 0 : Math.PI, scale: 1, group });
        else building(parts, bx, bz, 1 + Math.floor(rng.next() * 3), group, false);
        group++;
      }
      // One snapped tile grid: crossings share one tile instead of coplanar overlapping quads.
      const streets = new Set<string>();
      const street = (x: number, z: number) => {
        const key = `${x}:${z}`; if (streets.has(key)) return; streets.add(key);
        parts.push({ asset: BATTLE_ASSET.street, x, z, y: .12, yaw: 0, scale: 1 });
      };
      for (let z = -96; z <= 96; z += 8) street(0, z);
      for (const z of [-88, -48, 0, 48, 88]) for (let x = -72; x <= 72; x += 8) street(x, z);
      battleTower(parts, 14, 14, 20, true);
      for (const z of [-80, -36, 8, 52, 88]) parts.push({ asset: CAMP_ASSET['straight-lamp-post'], x: -7, z, y: 0, yaw: 0, scale: 1 });
    } else if (kind === 'factory') {
      // Linked single-storey workshop halls, with an administration building and loading yard.
      for (let i = 0; i < 3; i++) building(parts, -14 + i * 14, -14, 1, i + 1, unfinished);
      building(parts, -14, 14, 2, 4, unfinished);
      for (let i = 0; i < 5; i++) {
        parts.push({ asset: CAMP_ASSET['concrete-wall-panel'], x: 8 + i * 4, y: 0, z: 26, yaw: Math.PI / 2, scale: .5 });
        parts.push({ asset: CAMP_ASSET['rusty-oil-barrel'], x: 10 + i * 3, y: 0, z: 15, yaw: 0, scale: 1 });
      }
    } else if (kind === 'farm') {
      building(parts, -22, -18, 2, 1, false);
      parts.push({ asset: 2400, x: 22, z: -18, y: .08, yaw: 0, scale: 1, group: 2 });
      parts.push({ asset: 2401, x: -22, z: 10, y: .08, yaw: 0, scale: 1, group: 3 });
      building(parts, 22, 10, 1, 4, true);
      battleTower(parts, 0, -20, 5, true);
      for (let x = -24; x <= 24; x += 8) {
        parts.push({ asset: BATTLE_ASSET.farmBed, x, z: 36, y: .02, yaw: 0, scale: 1 });
        for (let z = 30; z <= 42; z += 3) parts.push({ asset: BATTLE_ASSET.crop, x, z, y: .1, yaw: rng.next() * Math.PI, scale: 1 });
      }
      for (let x = -34; x <= 34; x += 4) parts.push({ asset: CAMP_ASSET['wooden-fence'], x, z: 48, y: 0, yaw: 0, scale: 1 });
    } else if (kind === 'watchtower' || kind === 'water_tower') {
      battleTower(parts, 0, 0, 1, kind === 'water_tower');
    } else if (kind === 'hamlet') {
      building(parts, -18, -16, 2, 1, false);
      for (const [i, [x, z]] of [[18,-16],[-18,16],[18,16]].entries()) parts.push({asset: [2420,2422,2423][i]!,x:x!,z:z!,y:.08,yaw:0,scale:1,group:i+2});
    } else if (kind === 'ruined_camp') {
      building(parts, -12, 0, 1, 1, true);
      battleTower(parts, 14, 5, 2, false);
      parts.push({ asset: CAMP_ASSET['field-tent'], x: 12, z: -12, y: 0, yaw: 0, scale: 1 });
    } else {
      building(parts, 0, 0, 1, 1, false);
    }
    result.push({ kind, x, z, y: battleTerrain(gen.seed, gen.worldSize, gen.seaLevel, x, z), yaw: rng.next() * Math.PI * 2, radius, parts: importedRoofAccess(parts), gid: index + 1 });
  }
  cache.set(gen, result); return result;
}
