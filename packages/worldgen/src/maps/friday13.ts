import { BATTLE_ASSET, BUILDING_ASSET, CAMP_ASSET, STREET_ASSET, STREET_KIT } from '@zion/assets';
import type { CampPart } from '../camp';
import type { Structure } from '../structures';

/**
 * "Thứ 6 Ngày 13" (Friday the 13th): a night street that turns right. Road A runs north to a
 * crossroads with traffic lights and turns east as road B; both have raised sidewalks, kerbs,
 * lane markings, zebra crossings, street lamps and abandoned cars. Two- and three-storey houses
 * line every frontage: real doors and French windows, stairs inside up to flat roofs with
 * parapets, front balconies, plank bridges between some roofs and wall ladders at the back.
 * Behind them: a container yard in the west, a car park round a three-storey block inside the
 * bend, back yards in the north. Everything is at human scale (1 m wall pieces, 3.2 m storeys).
 */
export const F13 = {
  /** Centre of the town (world metres). */
  centre: 256,
  /** Ground height. */
  ground: 30,
  /** Half extent of the walled play area. */
  half: 42,
} as const;

/** Road surface (asphalt): road A (south → north) and road B (the bend → east). */
export function friday13Street(x: number, z: number): boolean {
  const lx = x - F13.centre, lz = z - F13.centre;
  return (Math.abs(lx) < 4 && lz > -F13.half && lz < 16) || (lz > 8 && lz < 16 && lx > -4 && lx < F13.half);
}

type Palette = 'a' | 'b' | 'c';
const WALL: Record<Palette, { wall: number; sill: number; head: number; parapet: number }> = {
  a: { wall: STREET_ASSET.wallA, sill: STREET_ASSET.sillA, head: STREET_ASSET.headA, parapet: STREET_ASSET.parapetA },
  b: { wall: STREET_ASSET.wallB, sill: STREET_ASSET.sillB, head: STREET_ASSET.headB, parapet: STREET_ASSET.parapetB },
  c: { wall: STREET_ASSET.wallC, sill: STREET_ASSET.sillC, head: STREET_ASSET.headC, parapet: STREET_ASSET.parapetC },
};

interface HouseOptions {
  palette: Palette;
  floors: number;
  balcony?: boolean;
  shop?: boolean;
  /** Leave the roof parapet open at the side wall's middle (a plank bridge lands there). */
  openLeft?: boolean;
  openRight?: boolean;
  /** A wall ladder up the back to the roof. */
  ladder?: boolean;
}

/** Yaw that turns a house's front (local −Z) towards direction (dx, dz). */
const facing = (dx: number, dz: number) => Math.atan2(-dx, -dz);

/**
 * A house `w` × `d` metres (both even), front to local −Z. Ground floor: a door in the middle of
 * the front and one at the back, windows elsewhere; upper floors: windows, and a balcony door when
 * there is a balcony. A straight stair against the left wall climbs to every floor and the roof.
 */
function house(parts: CampPart[], cx: number, cz: number, yaw: number, w: number, d: number, o: HouseOptions, group: number): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const put = (asset: number, lx: number, y: number, lz: number, partYaw = 0, scale = 1) =>
    parts.push({ asset, x: cx + lx * c + lz * s, y, z: cz - lx * s + lz * c, yaw: partYaw + yaw, scale, group });
  const k = WALL[o.palette], H = STREET_KIT.storey, top = STREET_KIT.slab, headY = top + STREET_KIT.wall - STREET_KIT.head;
  const tilesX = w / 2, tilesZ = d / 2;
  // Stair: 16 steps of 0.2 m against the left wall, rising towards the front.
  // The stairwell opening is the left column of slabs from `holeFront` back; the top step ends at its front edge.
  const stairX = -w / 2 + .8, steps = 16, run = .3, holeFront = -d / 2 + 2 * (tilesZ - 3);
  const inStairwell = (i: number, j: number) => i === 0 && j >= tilesZ - 3;
  const segment = (kind: 'wall' | 'window' | 'door', lx: number, y: number, lz: number, wallYaw: number) => {
    if (kind === 'wall') put(k.wall, lx, y + top, lz, wallYaw);
    if (kind === 'window') put(k.sill, lx, y + top, lz, wallYaw);
    if (kind !== 'wall') put(k.head, lx, y + headY, lz, wallYaw);
  };
  for (let f = 0; f <= o.floors; f++) {
    const y = f * H;
    // Floor (or roof) slabs, open over the stair from the first floor up.
    for (let i = 0; i < tilesX; i++) for (let j = 0; j < tilesZ; j++) {
      if (f > 0 && inStairwell(i, j)) continue;
      put(f === o.floors ? STREET_ASSET.roof : STREET_ASSET.slab, -w / 2 + 1 + i * 2, y, -d / 2 + 1 + j * 2);
    }
    if (f === o.floors) {
      // Roof parapet all round (open where a bridge or the ladder lands).
      for (let i = 0; i < w; i++) {
        const lx = -w / 2 + .5 + i;
        put(k.parapet, lx, y + top, -d / 2 + .1);
        if (!(o.ladder && Math.abs(lx - (w / 2 - 1.5)) < .6)) put(k.parapet, lx, y + top, d / 2 - .1);
      }
      for (let j = 0; j < d; j++) {
        // Bridges land on the front part of a side, clear of the stair opening.
        const z = -d / 2 + .5 + j, gap = z > -d / 2 + .4 && z < holeFront - .1;
        if (!(gap && o.openLeft)) put(k.parapet, -w / 2 + .1, y + top, z, Math.PI / 2);
        if (!(gap && o.openRight)) put(k.parapet, w / 2 - .1, y + top, z, Math.PI / 2);
      }
      // Railing beside the stair opening on the roof.
      for (let z = holeFront + .5; z < d / 2 - .2; z += 1) put(k.parapet, -w / 2 + 2.1, y + top, z, Math.PI / 2);
      break;
    }
    for (let n = 0; n < steps; n++) put(STREET_ASSET.step, stairX, y + top + n * .2, holeFront + .16 + (steps - 1 - n) * run);
    // Front: ground floor door in the middle (shop windows either side), upper floors windows / balcony door.
    const mid = w / 2 - 1;
    for (let i = 0; i < w; i++) {
      const lx = -w / 2 + .5 + i, centre = i === mid || i === mid + 1;
      const kind: 'wall' | 'window' | 'door' = f === 0
        ? (centre ? (i === mid ? 'door' : o.shop ? 'window' : 'wall') : (o.shop || i % 3 === 1 ? 'window' : 'wall'))
        : centre && o.balcony ? 'door' : (i % 3 === 1 || centre) ? 'window' : 'wall';
      segment(i === 0 || i === w - 1 ? 'wall' : kind, lx, y, -d / 2 + .1, 0);
    }
    // Back: a door on the ground floor, windows above.
    for (let i = 0; i < w; i++) {
      const lx = -w / 2 + .5 + i;
      const kind = i === 0 || i === w - 1 ? 'wall' : f === 0 && i === w - 3 ? 'door' : i % 3 === 2 ? 'window' : 'wall';
      segment(kind, lx, y, d / 2 - .1, 0);
    }
    // Sides: windows on the right; the left (stair side) is blind.
    for (let j = 0; j < d; j++) {
      const lz = -d / 2 + .5 + j, edge = j === 0 || j === d - 1;
      segment('wall', -w / 2 + .1, y, lz, Math.PI / 2);
      segment(!edge && j % 3 === 1 ? 'window' : 'wall', w / 2 - .1, y, lz, Math.PI / 2);
    }
    if (f > 0 && o.balcony) {
      for (const bx of [-1.5, -.5, .5, 1.5]) put(STREET_ASSET.balcony, bx, y, -d / 2 - .6);
      for (const bx of [-1.5, -.5, .5, 1.5]) put(k.parapet, bx, y + .18, -d / 2 - 1.1);
      for (const side of [-1, 1]) put(k.parapet, side * 2.1, y + .18, -d / 2 - .6, Math.PI / 2);
    }
    if (f === 0 && o.shop) for (let i = 1; i < w - 1; i++) put(STREET_ASSET.awning, -w / 2 + .5 + i, 2.95, -d / 2 - .7);
  }
  // Wall ladder up the back, through the gap in the roof parapet.
  if (o.ladder) for (let y = 0; y < o.floors * H + top; y += 2) put(CAMP_ASSET['rusty-iron-wall-ladder'], w / 2 - 1.5, y, d / 2 + .15);
}

/** A traffic light on a corner: pole, an arm over the road towards (dx, dz), the head with its three lights. */
function trafficLight(parts: CampPart[], x: number, z: number, dx: number, dz: number, lit: 'red' | 'amber' | 'green'): void {
  const l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l, armYaw = Math.atan2(-uz, ux);
  parts.push({ asset: STREET_ASSET.trafficPole, x, y: 0, z, yaw: 0, scale: 1 });
  parts.push({ asset: STREET_ASSET.trafficArm, x: x + ux * 1.6, y: 4.2, z: z + uz * 1.6, yaw: armYaw, scale: 1 });
  const hx = x + ux * 3.1, hz = z + uz * 3.1;
  parts.push({ asset: STREET_ASSET.trafficHead, x: hx, y: 3.05, z: hz, yaw: armYaw, scale: 1 });
  // The lights face the traffic coming along the road (perpendicular to the arm).
  const fx = -uz, fz = ux;
  for (const [asset, h, on] of [[STREET_ASSET.lampRed, 3.85, lit === 'red'], [STREET_ASSET.lampAmber, 3.55, lit === 'amber'], [STREET_ASSET.lampGreen, 3.25, lit === 'green']] as const)
    parts.push({ asset, x: hx + fx * .19, y: h, z: hz + fz * .19, yaw: armYaw + Math.PI / 2, scale: on ? 1 : .75 });
}

type Site = Structure;
const cache = new WeakMap<object, Site[]>();

/** The town (world coordinates); the perimeter wall and nature come from the map settings. */
export function friday13Structures(key: object): Site[] {
  const cached = cache.get(key);
  if (cached) return cached;
  const C = F13.centre, G = F13.ground, sites: Site[] = [];
  const site = (kind: Structure['kind'], parts: CampPart[], radius = 70) => sites.push({ kind, x: C, z: C, y: G, yaw: 0, radius, parts, gid: 1300 + sites.length });
  const H = F13.half;

  // ---- Streets: sidewalks, kerbs, markings, crossings, lamps, traffic lights, cars ---------
  {
    const parts: CampPart[] = [];
    const walk = (x0: number, x1: number, z0: number, z1: number) => {
      for (let x = x0 + 1; x <= x1 - .99; x += 2) for (let z = z0 + 1; z <= z1 - .99; z += 2) parts.push({ asset: STREET_ASSET.sidewalk, x, y: 0, z, yaw: 0, scale: 1 });
    };
    walk(-6.5, -4.5, -H, 18.5); walk(4.5, 6.5, -H, 5.5); walk(-4.5, H, 16.5, 18.5); walk(4.5, H, 5.5, 7.5);
    for (let z = -H + 1; z < 16; z += 2) { parts.push({ asset: STREET_ASSET.curb, x: -4.4, y: 0, z, yaw: Math.PI / 2, scale: 1 }); if (z < 5) parts.push({ asset: STREET_ASSET.curb, x: 4.4, y: 0, z, yaw: Math.PI / 2, scale: 1 }); }
    for (let x = -3; x < H; x += 2) { parts.push({ asset: STREET_ASSET.curb, x, y: 0, z: 16.4, yaw: 0, scale: 1 }); if (x > 5) parts.push({ asset: STREET_ASSET.curb, x, y: 0, z: 7.6, yaw: 0, scale: 1 }); }
    for (let z = -H + 3; z < 3; z += 5) parts.push({ asset: STREET_ASSET.laneDash, x: 0, y: .01, z, yaw: 0, scale: 1 });
    for (let x = 9; x < H - 1; x += 5) parts.push({ asset: STREET_ASSET.laneDash, x, y: .01, z: 12, yaw: Math.PI / 2, scale: 1 });
    for (let x = -3.25; x <= 3.25; x += 1.3) parts.push({ asset: STREET_ASSET.zebra, x, y: .01, z: 4.5, yaw: 0, scale: 1 });
    for (let z = 9.25; z <= 14.8; z += 1.3) parts.push({ asset: STREET_ASSET.zebra, x: 6, y: .01, z, yaw: Math.PI / 2, scale: 1 });
    // Street lamps along the sidewalks (the only light at night).
    for (const z of [-36, -24, -12, 0]) {
      parts.push({ asset: CAMP_ASSET['straight-lamp-post'], x: -6, y: .15, z, yaw: -Math.PI / 2, scale: 1 });
      parts.push({ asset: CAMP_ASSET['straight-lamp-post'], x: 6, y: .15, z: z - 6, yaw: Math.PI / 2, scale: 1 });
    }
    for (const x of [12, 24, 36]) {
      parts.push({ asset: CAMP_ASSET['straight-lamp-post'], x, y: .15, z: 18, yaw: 0, scale: 1 });
      parts.push({ asset: CAMP_ASSET['straight-lamp-post'], x: x + 6, y: .15, z: 6, yaw: Math.PI, scale: 1 });
    }
    // Traffic lights on three corners of the bend.
    trafficLight(parts, -5.6, 6.4, 1, 0, 'red');
    trafficLight(parts, 5.6, 17.6, 0, -1, 'amber');
    trafficLight(parts, 5.6, 6.6, 0, 1, 'green');
    // Abandoned cars: in their lanes, slewed across, one nosed into the bend.
    for (const [x, z, yaw] of [[-1.8, -33, .08], [2, -21, Math.PI - .25], [-1.4, -9, .55], [1.6, 1, Math.PI + .9], [.5, 12.5, 1.25], [15, 10.2, Math.PI / 2 + .1], [26, 13.8, -Math.PI / 2 - .3], [36, 10, Math.PI / 2 + .6]] as const)
      parts.push({ asset: STREET_ASSET.wreckCar, x, y: 0, z, yaw, scale: 1.2 });
    // A barricade closes the south end of road A.
    parts.push({ asset: BATTLE_ASSET.containerRed, x: -1.2, y: 0, z: -H + 5, yaw: Math.PI / 2 + .12, scale: 1 });
    parts.push({ asset: CAMP_ASSET['sandbag-wall'], x: 3, y: 0, z: -H + 9, yaw: 0, scale: 1 });
    parts.push({ asset: CAMP_ASSET['rusty-oil-barrel'], x: 3.2, y: 0, z: -H + 3, yaw: 0, scale: 1 });
    site('ruined_camp', parts, 90);
  }

  // ---- Houses on every frontage ----------------------------------------------------------
  {
    const parts: CampPart[] = [];
    let g = 1;
    const P: Palette[] = ['a', 'b', 'c'];
    // Road A, west side (fronts face east).
    const west: Array<[number, number, number]> = [[-35, 10, 2], [-24, 8, 2], [-13, 10, 2], [-2, 8, 2], [9, 10, 3]];
    west.forEach(([z, w, floors], i) => house(parts, -10.5, z, facing(1, 0), w, 8, { palette: P[i % 3]!, floors, balcony: i % 2 === 0, shop: i === 2 || i === 4, openLeft: i === 1, openRight: i === 0, ladder: i === 3 }, g++));
    // Road A, east side (fronts face west).
    const east: Array<[number, number, number]> = [[-35, 10, 2], [-24, 8, 2], [-13, 10, 3], [-1, 10, 3]];
    east.forEach(([z, w, floors], i) => house(parts, 10.5, z, facing(-1, 0), w, 8, { palette: P[(i + 1) % 3]!, floors, balcony: i % 2 === 1, shop: i === 3, openLeft: i === 0, openRight: i === 1, ladder: i === 2 }, g++));
    // Road B, north side (fronts face south); the corner house looks down road A.
    const north: Array<[number, number, number]> = [[-9, 10, 3], [2, 8, 2], [13, 10, 2], [24, 8, 3], [35, 10, 2]];
    north.forEach(([x, w, floors], i) => house(parts, x, 22.5, facing(0, -1), w, 8, { palette: P[(i + 2) % 3]!, floors, balcony: i % 2 === 0, shop: i === 0, openLeft: i === 2, openRight: i === 1, ladder: i === 4 }, g++));
    // Road B, south side (fronts face north).
    const south: Array<[number, number, number]> = [[21, 10, 2], [33, 10, 3]];
    south.forEach(([x, w, floors], i) => house(parts, x, 1.5, facing(0, 1), w, 8, { palette: P[i % 3]!, floors, balcony: true, ladder: i === 1 }, g++));
    // Plank bridges over the alleys between roofs of equal height.
    const roof2 = 2 * STREET_KIT.storey + STREET_KIT.slab - .12;
    // Each lands on the front part of the two sides (local z ≈ −3), beside the parapet gaps.
    const plank = (x: number, z: number, alongX: boolean) => { for (const o of [-1, 0, 1]) parts.push({ asset: STREET_ASSET.plank, x: alongX ? x + o : x, y: roof2, z: alongX ? z : z + o, yaw: 0, scale: 1 }); };
    plank(-7.5, -29, false); plank(7.5, -29, false); plank(7, 19.5, true);
    // Inside the bend: a three-storey block over a car park; in the west yard a house among the containers.
    house(parts, 28, -22, facing(-1, 0), 10, 8, { palette: 'b', floors: 3, balcony: true, ladder: true }, g++);
    house(parts, -30, -14, facing(0, 1), 8, 8, { palette: 'c', floors: 2 }, g++);
    site('town', parts, 90);
  }

  // ---- Back yards: containers, crates, sheds, cars, fences -------------------------------
  {
    const parts: CampPart[] = [];
    const stack = (x: number, z: number, yaw: number, high: boolean, red: boolean) => {
      parts.push({ asset: red ? BATTLE_ASSET.containerRed : BATTLE_ASSET.containerGreen, x, y: 0, z, yaw, scale: 1 });
      if (high) parts.push({ asset: red ? BATTLE_ASSET.containerGreen : BATTLE_ASSET.containerRed, x, y: 2.62, z, yaw, scale: 1 });
    };
    // West yard: containers, some stacked, crates as steps up (mantle onto them).
    stack(-26, -32, 0, true, true); stack(-35, -32, 0, false, false); stack(-23, -2, Math.PI / 2, true, false);
    stack(-37, 4, Math.PI / 2, false, true); stack(-28, 10, 0, true, true); stack(-36, 18, .1, false, false);
    for (const [x, z, y] of [[-22.3, -30.4, 0], [-22.3, -29.2, 0], [-22.3, -30.4, 1.2], [-21.3, -5.6, 0], [-31.8, 11.6, 0]] as const) parts.push({ asset: STREET_ASSET.crate, x, y, z, yaw: 0, scale: 1 });
    parts.push({ asset: BUILDING_ASSET.container, x: -38, y: 0, z: -22, yaw: Math.PI / 2, scale: 1.25 });
    // The car park inside the bend.
    for (const [x, z, yaw] of [[19, -34, Math.PI / 2], [19, -12, Math.PI / 2 + .2], [37, -34, -Math.PI / 2], [37, -10, -Math.PI / 2 + .3]] as const) parts.push({ asset: STREET_ASSET.wreckCar, x, y: 0, z, yaw, scale: 1.2 });
    stack(26, -38, 0, true, false);
    parts.push({ asset: STREET_ASSET.crate, x: 22.3, y: 0, z: -36.6, yaw: 0, scale: 1 });
    for (const [x, z] of [[33, -4], [18, -24]] as const) parts.push({ asset: CAMP_ASSET['sandbag-wall'], x, y: 0, z, yaw: 0, scale: 1 });
    // North back yards: a fence line, a trailer and crates.
    for (let x = -14; x <= 40; x += 2.25) parts.push({ asset: CAMP_ASSET['wooden-fence'], x, y: 0, z: 31, yaw: 0, scale: 1 });
    parts.push({ asset: BUILDING_ASSET.trailer, x: 6, y: 0, z: 36, yaw: .2, scale: 1.2 });
    parts.push({ asset: STREET_ASSET.crate, x: 26, y: 0, z: 35, yaw: .3, scale: 1 });
    parts.push({ asset: STREET_ASSET.crate, x: 26, y: 1.2, z: 35, yaw: .3, scale: 1 });
    for (const [x, z] of [[-16, -40], [16, 39], [-38, 30]] as const) parts.push({ asset: CAMP_ASSET['rusty-oil-barrel'], x, y: 0, z, yaw: x, scale: 1 });
    site('factory', parts, 90);
  }

  cache.set(key, sites);
  return sites;
}

/** Open ground for spawns: the roads, the sidewalks, the yards. */
export function friday13Spawns(): Array<{ x: number; z: number }> {
  const C = F13.centre, out: Array<{ x: number; z: number }> = [];
  for (const z of [-38, -27, -16, -5]) out.push({ x: C - 2.6, z: C + z }, { x: C + 2.6, z: C + z + 4 });
  for (const x of [9, 19, 30, 39]) out.push({ x: C + x, z: C + 11 }, { x: C + x - 3, z: C + 14 });
  for (const [x, z] of [[-31, -25], [-36, -8], [-24, 22], [-34, 28], [29, -30], [31, -14], [20, -4], [0, 37], [18, 37], [34, 37]] as const) out.push({ x: C + x, z: C + z });
  return out;
}
