import { hash3 } from '@zion/shared';

/**
 * Where plants grow and rock shows, from the shape of the ground rather than from noise: water
 * gathers in hollows and runs down gullies (wet, deep soil: broadleaves, thick grass), ridges and
 * convex slopes dry out and lose their soil (pines, sparse grass, bare rock), slopes facing the sun
 * (south, +z on our maps) are warmer and drier than shaded ones. After the habitat model of
 * UGLYTerrain (Nodli, https://github.com/Nodli/UGLYTerrain: exposure × slope × wetness decide the
 * density of each plant type), reimplemented from its description; and trees spread from mother
 * trees by seed dispersal, so woods come in groves with ragged edges and glades between them, as in
 * its succession simulation (seed throw radius around each reproducing tree).
 */

export interface EcologySource {
  /** Natural ground height (m). */
  height(x: number, z: number): number;
  /** 0..1 water passing (an erosion flow map), when there is one. */
  flow?(x: number, z: number): number;
  /** Net erosion change (m): + deposited, − carved. */
  sediment?(x: number, z: number): number;
  /** −1 hollow … +1 crest, when precomputed (saves four height samples). */
  ridge?(x: number, z: number): number;
}

export interface Ecology {
  /** Rise / run. */
  slope: number;
  /** −1 valley floor … +1 ridge crest (height against the ground 24 m around). */
  ridge: number;
  /** 0 shaded (north-facing) … 1 full sun (south-facing); flat ground .6. */
  sun: number;
  /** 0 dry … 1 waterlogged. */
  wetness: number;
  /** 0 bare rock … 1 deep soil. */
  soil: number;
  /** 0..1: bare rock showing (steep, scoured, on crests). */
  rocky: number;
}

export function makeEcology(): Ecology {
  return { slope: 0, ridge: 0, sun: .6, wetness: 0, soil: .5, rocky: 0 };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The habitat at (x, z); `h` its height when known. Two height samples for the slope and facing,
 * four more for the ridge unless the source has it precomputed.
 */
export function ecologyAt(src: EcologySource, x: number, z: number, out: Ecology = makeEcology(), h = src.height(x, z)): Ecology {
  const e = 2;
  const gx = (src.height(x + e, z) - h) / e, gz = (src.height(x, z + e) - h) / e;
  const slope = Math.hypot(gx, gz);
  // ±3 m against the surroundings 24 m away is a clear ridge or hollow at this scale.
  const r = 24, ridge = src.ridge ? src.ridge(x, z) : Math.max(-1, Math.min(1, (h - (src.height(x + r, z) + src.height(x - r, z) + src.height(x, z + r) + src.height(x, z - r)) / 4) / 3));
  // Facing: the downhill direction is −gradient; south (+z) faces the sun.
  const facing = slope > .02 ? -gz / slope : 0;
  const sun = clamp01(.6 + .4 * facing * Math.min(1, slope * 2.5));
  const flow = src.flow ? src.flow(x, z) : 0, sediment = src.sediment ? src.sediment(x, z) : 0;
  const wetness = clamp01(.35 - ridge * .35 + flow * .9 - slope * .35 + (1 - sun) * .15 + Math.max(0, sediment) * .08);
  const soil = clamp01(.6 - ridge * .3 - slope * .55 + Math.max(0, sediment) * .25 + Math.min(0, sediment) * .15 + wetness * .2);
  const rocky = clamp01((slope - .45) * 1.6 + Math.max(0, ridge) * .35 - soil * .4 + Math.max(0, -sediment) * .12 + (flow > .55 && slope > .25 ? .3 : 0));
  out.slope = slope; out.ridge = ridge; out.sun = sun; out.wetness = wetness; out.soil = soil; out.rocky = rocky;
  return out;
}

/** How well each kind of plant does in a habitat, 0..1. */
export function suitability(e: Ecology): { broadleaf: number; conifer: number; shrub: number; grass: number; rock: number } {
  const broadleaf = clamp01(e.soil * 1.1 * (.55 + e.wetness * .7) - e.rocky * .8 - Math.max(0, e.slope - .7));
  const conifer = clamp01((.5 + Math.max(0, e.ridge) * .4 + (1 - e.wetness) * .25) * (.4 + e.soil * .6) - e.rocky * .6 - Math.max(0, e.slope - .9));
  const shrub = clamp01(.35 + e.sun * .35 + e.soil * .2 - e.rocky * .5 - e.wetness * .1);
  const grass = clamp01(e.soil * .8 + e.sun * .25 + e.wetness * .15 - e.rocky);
  return { broadleaf, conifer, shrub, grass, rock: e.rocky };
}

const MOTHER_CELL = 30;

/**
 * 0..1: how close (x, z) lies to reproducing mother trees — seedlings land round each one within
 * its throw radius (12–26 m), so woods come in groves with glades between. Deterministic per world
 * seed and independent of chunks (mothers sit on a 30 m world grid).
 */
export function groveDensity(seed: number, x: number, z: number): number {
  const ci = Math.floor(x / MOTHER_CELL), cj = Math.floor(z / MOTHER_CELL);
  let sum = 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const i = ci + di, j = cj + dj, h = hash3(seed, i, j, 0x9e0e);
    // About three cells in five hold a mother tree.
    if ((h & 0xffff) / 0x10000 > .6) continue;
    const mx = (i + .15 + .7 * (((h >>> 16) & 0xff) / 255)) * MOTHER_CELL, mz = (j + .15 + .7 * ((h >>> 24) / 255)) * MOTHER_CELL;
    const reach = 12 + 14 * (((h >>> 8) & 0xff) / 255), d2 = ((x - mx) ** 2 + (z - mz) ** 2) / (reach * reach);
    if (d2 < 4) sum += Math.exp(-d2 * 1.6);
  }
  return 1 - Math.exp(-sum * 1.4);
}
