import type { Rng } from '@zion/shared';
import { BATTLE_ASSET, BUILDING_ASSET, CAMP_ASSET } from '@zion/assets';
import type { CampPart } from './camp';
import { modularBuilding } from './battle-map';

/** Site-local zombie spawn spot: x, floor height above the site base, z. */
export type SpawnSpot = readonly [number, number, number];

export interface TownLayout {
  parts: CampPart[];
  radius: number;
  /** Local Z of the far end of the main street (it runs along local Z, through x = 0). */
  street: number;
  spawns: SpawnSpot[];
}

type Lot = 'block' | 'block2' | 'favela' | 'house' | 'houseLarge' | 'houseSmall' | 'slums' | 'shop' | 'apartment';
/** Footprint half-depth (away from the street) and half-width (along it), per lot kind, as turned below. */
const SIZE: Record<Lot, readonly [number, number]> = {
  block: [11, 6.5], block2: [11, 6.5], favela: [4.2, 4.9], house: [2.6, 4.4], houseLarge: [5.3, 5.6], houseSmall: [2.3, 2.3], slums: [1.7, 5], shop: [3.2, 7], apartment: [13.5, 25],
};
/** Main street half-width (matches the road network's town streets) plus a pavement. */
export const TOWN_STREET_HALF_WIDTH = 3.3;
const FRONTAGE = TOWN_STREET_HALF_WIDTH + 1.4;

/**
 * An abandoned survival town in the battle-royale style: one straight main street with the
 * prepared building models packed side by side along both frontages, facing it. Blocks are
 * enterable over several floors; their doors are long gone.
 */
export function survivalTown(rng: Rng): TownLayout {
  const parts: CampPart[] = [], spawns: SpawnSpot[] = [];
  let group = 1, apartment = rng.next() < .5;
  const half = 38 + Math.floor(rng.next() * 16);
  const pick = (room: number): Lot => {
    if (apartment && room > 2 * SIZE.apartment[1] + 2 && rng.next() < .25) { apartment = false; return 'apartment'; }
    const r = rng.next();
    return r < .2 ? 'block' : r < .32 ? 'block2' : r < .44 ? 'favela' : r < .56 ? 'house' : r < .66 ? 'houseLarge' : r < .74 ? 'houseSmall' : r < .9 ? 'slums' : 'shop';
  };
  const put = (asset: number, x: number, z: number, y: number, yaw: number, scale = 1, g = 0) => parts.push({ asset, x, y, z, yaw, scale, group: g });
  const house = (asset: number, x: number, z: number, yaw: number, scale = 1) => put(asset, x, z, .08, yaw, scale, group++);
  let reachX = 0;
  const build = (lot: Lot, x: number, z: number, facing: number) => {
    const turn = facing + (rng.next() - .5) * .08, c = Math.cos(turn), s = Math.sin(turn);
    switch (lot) {
      case 'block': case 'block2': {
        const floors = lot === 'block' ? 1 : 2 + Math.floor(rng.next() * 2);
        const before = parts.length;
        modularBuilding(parts, x, z, floors, group++, rng.next() < .3, turn, Math.floor(rng.next() * 1e6));
        // Abandoned: every door has been torn out of its frame.
        for (let i = parts.length - 1; i >= before; i--) if (parts[i]!.asset === BATTLE_ASSET.door) parts.splice(i, 1);
        for (let level = 0; level <= floors; level++) for (const [dx, dz] of [[-2, 1], [2.5, -2]] as const) {
          spawns.push([x + dx * c + dz * s, .24 + level * 3.2, z - dx * s + dz * c]);
        }
        break;
      }
      case 'favela': house(BUILDING_ASSET.favela, x, z, turn); break;
      case 'house': house(BUILDING_ASSET.house, x, z, turn + Math.PI / 2); break;
      case 'houseLarge': house(BUILDING_ASSET.houseLarge, x, z, turn); break;
      case 'houseSmall': house(BUILDING_ASSET.houseSmall, x, z, turn); break;
      // A terrace of rooms along the frontage.
      case 'slums': for (const d of [-3.3, 0, 3.3]) house(BUILDING_ASSET.slumRoom, x, z + d, turn); break;
      case 'shop': {
        for (const d of [-3.5, 3.5]) put(rng.next() < .5 ? BATTLE_ASSET.containerRed : BATTLE_ASSET.containerGreen, x, z + d, 0, turn + Math.PI / 2);
        put(CAMP_ASSET['old-wooden-crate'], x - 1.5 * c, z + 1.5 * s, 0, turn);
        break;
      }
      // Scaled up so its windows are tall enough to jump and climb through.
      case 'apartment': house(BUILDING_ASSET.apartment, x, z, turn, 1.3); break;
    }
  };
  // Both frontages, packed tight: a metre or two between neighbours, a short front yard.
  for (const side of [-1, 1] as const) {
    let z = -half;
    while (z < half) {
      const lot = pick(half - z), [depth, width] = SIZE[lot];
      z += width + .4;
      if (z + width > half) break;
      const x = side * (FRONTAGE + depth + .6 + rng.next() * 1.4);
      build(lot, x, z, side * Math.PI / 2);
      reachX = Math.max(reachX, Math.abs(x) + depth);
      z += width + .6 + rng.next() * 1.2;
    }
  }
  // Street litter on the pavements (the power poles line the street already).
  const junk = ['rusty-oil-barrel', 'old-carton-box', 'old-dusty-wood-board', 'old-wooden-crate', 'rusty-iron-bar', 'old-iron-bucket'] as const;
  for (let i = 0; i < 10; i++) {
    const side = rng.next() < .5 ? -1 : 1;
    put(CAMP_ASSET[junk[Math.floor(rng.next() * junk.length)]!], side * (TOWN_STREET_HALF_WIDTH + .3 + rng.next() * 1.2), (rng.next() * 2 - 1) * half, 0, rng.next() * Math.PI * 2, .8 + rng.next() * .3);
  }
  return { parts, radius: Math.hypot(Math.max(reachX, FRONTAGE) + 2, half + 2), street: -half - 4, spawns };
}
