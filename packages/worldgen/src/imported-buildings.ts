import { hash3 } from '@zion/shared';
import { CAMP_ASSET, BATTLE_ASSET } from '@zion/assets';
import type { CampPart } from './camp';
import type { Structure } from './structures';

/** Each GLB here is a separately prepared building, never the source asset collection. */
export function importedSettlement(kind: Structure['kind'], radius: number, variation: number): CampPart[] | null {
  if (variation % 3 !== 0 || kind === 'power_plant' || kind === 'ruined_camp') return null;
  const parts: CampPart[] = [];
  const put = (asset: number, x: number, z: number, yaw = 0, group = 1) => parts.push({asset,x,z,y:.08,yaw,scale:1,group});
  const chest = (x: number,z: number) => put(CAMP_ASSET['military-wooden-crate'],x,z,0,0);
  if (kind === 'town' && radius >= 48) {
    put(2421,0,0); // one complete apartment with its authored stairs, floors and roof
    put(2420,-29,-22,0,2); put(2403,29,-22,Math.PI,3);
    put(2402,-29,22,Math.PI,4); put(2422,29,22,0,5); put(2423,34,22,0,6);
    put(2412,0,-17,0,0); put(2413,-27,29,0,0);
    chest(-23,0);chest(23,0);chest(-29,-29);chest(29,29);
  } else if (kind === 'factory' && radius >= 25) {
    put(2400,-10,0);put(2401,10,0,0,2);put(2408,0,14,Math.PI/2,3);put(2410,12,14,0,0);
    chest(0,-10);chest(-10,12);
  } else if ((kind === 'house_small' || kind === 'house_large') && radius >= 10) {
    put(variation % 2 ? 2420 : 2403,0,0);chest(0,-8);
    put(2412,7,0,Math.PI/2,0);
  } else return null;
  return parts;
}

/**
 * Lootable crates on the floors inside each prepared building (local x, floor height, z). Found
 * offline from the building colliders: clear of walls and furniture with headroom, enclosed by
 * walls and under a roof, so they never block a doorway or stand outdoors.
 */
const INTERIOR_CRATES: Readonly<Record<number, ReadonlyArray<readonly [number, number, number]>>> = {
  2400: [[2.8, 0, -2.05], [-2.7, 0, -3.3]],
  2403: [[-2.5, 0, -3.97], [2, 0, 4.28]],
  2404: [[-1.11, 0, 1.29]],
  2407: [[-3.57, 0, -3.5], [-3.57, 0, .25]],
  2420: [[-3.8, .03, 1.74], [-.05, .03, 1.74], [-3.8, 3.17, 1.49], [-.05, 3.17, 1.49]],
  2421: [[-14.1, 0, 1.27], [13.9, 0, 1.27], [1.4, 3.21, 1.27], [-14.1, 3.21, 1.27], [1.4, 6.37, 1.27], [-14.1, 6.37, 1.27]],
  2422: [[.43, .07, .42]],
  2423: [[-.07, .07, -.82]],
};
/** Closed models with no usable interior: their crate (if any) stands outside, beside a wall. */
const SOLID_HALF: Readonly<Record<number, readonly [number, number]>> = {
  2401: [3.4, 3.3], 2402: [2.4, 4.4], 2405: [3.4, 1.4], 2406: [4.8, 2.4], 2408: [3, 1], 2409: [2.8, 1.2],
};
/** Deterministic 0…99 roll for one loot spot of one building. */
function roll(part: CampPart, index: number): number {
  return (hash3(0x10ad, Math.round(part.x * 10), Math.round(part.z * 10), part.asset * 16 + index) >>> 0) % 100;
}
function lootCrates(parts: CampPart[]): CampPart[] {
  const added: CampPart[] = [];
  for (const part of parts) {
    const c = Math.cos(part.yaw), s = Math.sin(part.yaw), k = part.scale;
    const place = (x: number, y: number, z: number) => added.push({ asset: CAMP_ASSET['military-wooden-crate'], x: part.x + (x * c + z * s) * k, z: part.z + (-x * s + z * c) * k, y: part.y + y * k, yaw: part.yaw, scale: 1, group: 0 });
    // Interior spots are filled by chance: not every house holds loot.
    (INTERIOR_CRATES[part.asset] ?? []).forEach(([x, y, z], i) => { if (roll(part, i) < 55) place(x, y, z); });
    const solid = SOLID_HALF[part.asset];
    if (solid && roll(part, 9) < 50) place(solid[0] + .9, 0, 0);
  }
  return added;
}

/** The favela's authored staircase reaches the second floor; an outside ladder reaches its roof. */
export function importedRoofAccess(parts: CampPart[]): CampPart[] {
  const added: CampPart[] = [];
  for (const part of parts) if (part.asset === 2420) {
    const c = Math.cos(part.yaw), s = Math.sin(part.yaw);
    added.push({asset:BATTLE_ASSET.towerPost,x:part.x-4.85*c*part.scale,z:part.z+4.85*s*part.scale,y:part.y,yaw:part.yaw,scale:part.scale*.81,group:part.group});
    for (const y of [0,2,4,6]) added.push({asset:CAMP_ASSET['rusty-iron-wall-ladder'],x:part.x-4.98*c*part.scale,z:part.z+4.98*s*part.scale,y:part.y+y*part.scale,yaw:part.yaw-Math.PI/2,scale:part.scale*(y===6?.75:1),group:part.group});
  }
  parts.push(...added, ...lootCrates(parts)); return parts;
}
