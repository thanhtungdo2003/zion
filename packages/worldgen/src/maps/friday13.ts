import { smoothstep } from '@zion/shared';
import { BATTLE_ASSET, BUILDING_ASSET, CAMP_ASSET } from '@zion/assets';
import type { CampPart } from '../camp';
import type { Structure } from '../structures';
import { battleTower, modularBuilding } from '../battle-map';

/**
 * "Thứ 6 Ngày 13" (Friday the 13th): the infection map. A walled night town about 170 m across,
 * cut into four districts by two streets that meet at a plaza with a crashed helicopter:
 *   north-west  a gutted apartment block (three floors of rooms, stairwells, balconies),
 *   north-east  a chapel and its graveyard behind a low stone wall, with a bell tower,
 *   south-east  a container yard: stacked boxes, ladders, a water tower over the maze,
 *   south-west  packed walk-ups with stairwells and roof terraces, slum shacks in the alleys.
 * Beyond the perimeter wall the ground climbs into steep banks nobody can scale.
 */
export const F13 = {
  /** Centre of the playable town (world metres). */
  centre: 256,
  /** Ground height inside the walls. */
  ground: 30,
  /** Half extent of the walled town. */
  half: 88,
} as const;

/** Terrain: flat inside the wall, rising into banks outside. */
export function friday13Height(x: number, z: number): number {
  const d = Math.max(Math.abs(x - F13.centre), Math.abs(z - F13.centre));
  return F13.ground + smoothstep(F13.half + 3, F13.half + 24, d) * 34 + smoothstep(F13.half + 24, F13.half + 80, d) * 20;
}

/** On a street (for the surface): the two cross streets and the plaza. */
export function friday13Street(x: number, z: number): boolean {
  const dx = Math.abs(x - F13.centre), dz = Math.abs(z - F13.centre);
  if (Math.max(dx, dz) > F13.half) return false;
  return dx < 5 || dz < 5 || Math.max(dx, dz) < 18;
}

type Site = Structure;
const cache = new WeakMap<object, Site[]>();

/** The town districts and streets (world coordinates; the walls and nature are added per map). */
export function friday13Structures(key: object): Site[] {
  const cached = cache.get(key);
  if (cached) return cached;
  const C = F13.centre, G = F13.ground;
  const sites: Site[] = [];
  const site = (kind: Structure['kind'], x: number, z: number, radius: number, parts: CampPart[]) =>
    sites.push({ kind, x: C + x, z: C + z, y: G, yaw: 0, radius, parts, gid: 1300 + sites.length });

  // ---- Perimeter wall and streets ----------------------------------------------------------
  {
    // (The perimeter wall comes from the map settings, see infection-map.ts.)
    const parts: CampPart[] = [];
    // Street tiles, one snapped grid so crossings never overlap.
    const tiles = new Set<string>();
    const tile = (x: number, z: number) => { const k = `${x}:${z}`; if (tiles.has(k)) return; tiles.add(k); parts.push({ asset: BATTLE_ASSET.street, x, y: .12, z, yaw: 0, scale: 1 }); };
    for (let o = -84; o <= 84; o += 8) { tile(0, o); tile(o, 0); }
    for (let x = -16; x <= 16; x += 8) for (let z = -16; z <= 16; z += 8) tile(x, z);
    // Lamps down both streets: the only light in town.
    for (const o of [-76, -56, -36, 36, 56, 76]) {
      parts.push({ asset: CAMP_ASSET['straight-lamp-post'], x: 6, y: 0, z: o, yaw: Math.PI, scale: 1 });
      parts.push({ asset: CAMP_ASSET['straight-lamp-post'], x: o, y: 0, z: -6, yaw: 0, scale: 1 });
    }
    // Street cover: barricades, a burnt tank, barrels and crates.
    parts.push({ asset: CAMP_ASSET['old-rusty-tank'], x: 0, y: 0, z: 58, yaw: .35, scale: 1 });
    for (const [x, z, yaw] of [[-2, -46, 0], [2, -66, 0], [46, 2, Math.PI / 2], [66, -2, Math.PI / 2], [-50, 2, Math.PI / 2], [-70, -2, Math.PI / 2], [3, 38, 0]] as const)
      parts.push({ asset: CAMP_ASSET['sandbag-wall'], x, y: 0, z, yaw, scale: 1 });
    for (const [x, z] of [[-3, -30], [3, -31], [30, 3], [-31, -3], [-3, 76], [77, 3], [-77, -3], [3, -78]] as const)
      parts.push({ asset: CAMP_ASSET['rusty-oil-barrel'], x, y: 0, z, yaw: x * .7, scale: 1 });
    for (const [x, z] of [[-3.5, 24], [24, -3.5], [-24, 3.5], [3.5, -24]] as const)
      parts.push({ asset: CAMP_ASSET['military-wooden-crate'], x, y: 0, z, yaw: z * .3, scale: 1 });
    site('ruined_camp', 0, 0, 130, parts);
  }

  // ---- Plaza: the crashed helicopter -------------------------------------------------------
  {
    const parts: CampPart[] = [
      { asset: CAMP_ASSET['rusty-old-helicopter'], x: 0, y: 0, z: 0, yaw: .65, scale: 1, group: 1 },
      ...[[-14, -14], [14, -14], [-14, 14], [14, 14]].map(([x, z]) => ({ asset: CAMP_ASSET['military-lamp-post'], x: x!, y: 0, z: z!, yaw: Math.atan2(x!, z!), scale: 1 })),
      ...[[-11, 0, Math.PI / 2], [11, 0, Math.PI / 2], [0, -11, 0], [0, 11, 0]].map(([x, z, yaw]) => ({ asset: CAMP_ASSET['sandbag-wall'], x: x!, y: 0, z: z!, yaw: yaw!, scale: 1 })),
      { asset: CAMP_ASSET['broken-concrete-wall'], x: -9, y: 0, z: -9, yaw: Math.PI / 4, scale: .8 },
      { asset: CAMP_ASSET['broken-concrete-wall'], x: 9, y: 0, z: 9, yaw: Math.PI / 4, scale: .8 },
    ];
    site('ruined_camp', 0, 0, 20, parts);
  }

  // ---- North-west: the apartment block -----------------------------------------------------
  {
    const parts: CampPart[] = [{ asset: BUILDING_ASSET.apartment, x: 0, y: .08, z: 4, yaw: 0, scale: 1, group: 1 }];
    battleTower(parts, -28, -28, 2, false);
    for (const [x, z] of [[24, -28], [-30, 28], [28, 30]] as const) parts.push({ asset: CAMP_ASSET['broken-concrete-wall'], x, y: 0, z, yaw: x * .1, scale: 1, group: 3 });
    for (const [x, z] of [[18, -30], [-24, 32], [30, 18]] as const) parts.push({ asset: CAMP_ASSET['old-wooden-crate'], x, y: 0, z, yaw: z, scale: 1 });
    site('town', -47, -47, 40, parts);
  }

  // ---- North-east: chapel and graveyard ----------------------------------------------------
  {
    const parts: CampPart[] = [];
    // The chapel: a long barn hall at the back, its bell tower beside it.
    parts.push({ asset: BUILDING_ASSET.barn, x: 6, y: .08, z: -24, yaw: Math.PI / 2, scale: 1.35, group: 1 });
    battleTower(parts, -20, -26, 2, false);
    // Low stone wall round the graves, gaps at the gate and the chapel path.
    for (let o = -28; o <= 28; o += 4) {
      if (Math.abs(o) > 3) parts.push({ asset: CAMP_ASSET['large-stone-brick-wall'], x: o, y: 0, z: 34, yaw: 0, scale: .55, group: 3 });
      if (Math.abs(o - 6) > 3) parts.push({ asset: CAMP_ASSET['large-stone-brick-wall'], x: o, y: 0, z: -10, yaw: 0, scale: .55, group: 3 });
    }
    for (let o = -8; o <= 32; o += 4) for (const side of [-1, 1]) parts.push({ asset: CAMP_ASSET['large-stone-brick-wall'], x: side * 30, y: 0, z: o, yaw: Math.PI / 2, scale: .55, group: 3 });
    // Rows of headstones, a few knocked over, between dead trees.
    let n = 0;
    for (let x = -24; x <= 24; x += 5) for (let z = -4; z <= 28; z += 5.5) {
      if (Math.abs(x) < 3) continue;
      n++;
      const tilt = n % 7 === 0 ? .9 : 0;
      parts.push({ asset: n % 3 ? CAMP_ASSET['large-stone-brick-wall'] : [2463, 2464][n % 2]!, x: x + (n % 3) * .3, y: 0, z: z + tilt, yaw: tilt + (n % 5) * .04, scale: n % 3 ? .22 : 1.4 });
    }
    for (const [x, z, asset] of [[-14, 8, 2453], [16, 20, 2452], [-6, 26, 2453], [22, -2, 2453], [-26, 18, 2452]] as const) parts.push({ asset, x, y: 0, z, yaw: x, scale: 1.1 });
    site('farm', 47, -47, 40, parts);
  }

  // ---- South-east: container yard ----------------------------------------------------------
  {
    const parts: CampPart[] = [];
    const box = (x: number, z: number, yaw: number, level: number, i: number) =>
      parts.push({ asset: i % 3 === 2 ? BUILDING_ASSET.container : i % 2 ? BATTLE_ASSET.containerRed : BATTLE_ASSET.containerGreen, x, y: level ? .02 + level * 2.6 : 0, z, yaw, scale: 1, group: 10 + i });
    let i = 0;
    // A maze of rows; every other stack is two high, with a ladder up its end.
    for (const [row, z] of [-26, -14, -2, 10, 22].entries()) for (const [col, x] of [-24, -10, 4, 18].entries()) {
      if ((row === 2 && col === 1) || (row === 2 && col === 2)) continue;
      const turned = (row + col) % 3 === 0;
      box(x, z, turned ? Math.PI / 2 : 0, 0, i);
      if ((row + col) % 2 === 0) {
        box(x, z, turned ? Math.PI / 2 : 0, 1, i + 1);
        // Ladder up the end of the stack.
        const lx = turned ? x : x + 3.4, lz = turned ? z + 3.4 : z;
        for (const y of [0, 2, 4]) parts.push({ asset: CAMP_ASSET['rusty-iron-wall-ladder'], x: lx, y, z: lz, yaw: turned ? 0 : Math.PI / 2, scale: y === 4 ? .6 : 1 });
      }
      i += 2;
    }
    // The water tower stands over the open middle of the yard.
    battleTower(parts, -3, -2, 2, true);
    parts.push({ asset: BUILDING_ASSET.trailer, x: 28, y: 0, z: 30, yaw: .2, scale: 1 });
    parts.push({ asset: BUILDING_ASSET.generator, x: -28, y: 0, z: 30, yaw: 0, scale: 1 });
    site('factory', 47, 47, 40, parts);
  }

  // ---- South-west: walk-ups and slum alleys ------------------------------------------------
  {
    const parts: CampPart[] = [];
    // Four enterable blocks round a narrow yard: stairwells, balconies and roof terraces.
    modularBuilding(parts, -15, -15, 2, 1, false, 0, 13);
    modularBuilding(parts, 15, -15, 1, 2, true, Math.PI / 2, 13);
    modularBuilding(parts, -15, 15, 1, 3, false, -Math.PI / 2, 13);
    modularBuilding(parts, 15, 15, 2, 4, false, Math.PI, 13);
    // Shacks fill the alleys along the edges.
    for (const [x, z, asset, yaw] of [[-32, 0, BUILDING_ASSET.slumRoom, Math.PI / 2], [32, 0, BUILDING_ASSET.slumCorner, -Math.PI / 2], [0, 32, BUILDING_ASSET.slumRoom, Math.PI], [0, -32, BUILDING_ASSET.slumCorner, 0], [-30, 32, BUILDING_ASSET.house, 0], [30, 32, BUILDING_ASSET.houseSmall, Math.PI]] as const)
      parts.push({ asset, x, y: .08, z, yaw, scale: 1, group: 20 + Math.round(x + z) });
    for (const [x, z] of [[0, 0], [-4, 2], [3, -3]] as const) parts.push({ asset: CAMP_ASSET['rusty-oil-barrel'], x, y: 0, z, yaw: x, scale: 1 });
    site('hamlet', -47, 47, 40, parts);
  }

  cache.set(key, sites);
  return sites;
}

/** Open ground for spawns: along the streets and in each district's yards. */
export function friday13Spawns(): Array<{ x: number; z: number }> {
  const C = F13.centre, out: Array<{ x: number; z: number }> = [];
  for (const o of [-80, -70, -60, -42, -26, 26, 42, 60, 70, 80]) { out.push({ x: C - 2.5, z: C + o }, { x: C + o, z: C + 2.5 }); }
  for (const [x, z] of [[-20, 20], [20, 20], [-20, -20], [20, -20], [-47, -82], [-82, -47], [47, -78], [78, 47], [47, 80], [-47, 80], [-80, 47], [82, -47], [-47, 47], [47, 13], [-75, -75], [75, 75]] as const) out.push({ x: C + x, z: C + z });
  return out;
}
