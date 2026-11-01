import { Rng, smoothstep } from '@zion/shared';
import { IndexHeap } from '../heap';
import { Simplex2 } from '../noise';
import { type Heightfield, seedNumber } from './heightfield';

/**
 * The World Studio's landform: a geological model first, noise only for the last few metres.
 *
 *  1. Landmass. One main spine (a random-walk polyline) with arms branching off it and islets
 *     off its coast; the land is everything within a varying width of them, its shore bent by
 *     domain-warped noise and cut where the share of land the style asks for is reached. Every
 *     seed gets its own outline (peninsulas, bays, capes), not one radial island mask.
 *  2. Uplift. Mountain ranges are ridge lines (the spine's backbone, offset towards one coast,
 *     with spurs and sub-spurs branching off), plus a broad rise inland and rolling hill country.
 *  3. Stream-power erosion on a coarse grid: uplift against fluvial incision, E = K·A^m·S, solved
 *     with the implicit O(n) scheme of Braun & Willett (2013) on the drainage tree of a
 *     Priority-Flood (Barnes et al. 2014), as in the large-scale terrain authoring of Cordonnier
 *     et al. (2016) and Schott et al. (2023). Valleys, ridges, spurs, passes and concave river
 *     profiles come out of the simulation; nothing is shaped by hand.
 *  4. Full resolution: bicubic upsampling, a continental shelf of varying steepness (beaches
 *     where it is gentle, cliffs where ranges meet the sea), plateaus, layered rock on steep
 *     faces and slope/height-scaled detail noise; the droplet and thermal erosion and the
 *     hydrology (hydro.ts) run on the result.
 *
 * All of it is our own code (no third-party source copied); the algorithms are from the papers
 * above and the public write-ups of Red Blob Games (mapgen4) and Sebastian Lague.
 */

/** What a terrain preset asks of the landform. */
export interface LandformStyle {
  /** Share of the map that is land when it is surrounded by sea (min..max, picked per seed). */
  land: [number, number];
  /** Arms (peninsulas) off the main landmass, min..max. */
  arms: [number, number];
  /** Islets off the coast, at most. */
  islets: number;
  /** Strength of the mountain ranges (0: none). */
  ranges: number;
  /** 0..1: how many spurs branch off the ranges. */
  spurs: number;
  /** Two ranges either side of the spine with a long valley between them. */
  twin: boolean;
  /** Broad rise away from the coast. */
  base: number;
  /** Rolling hill country. */
  hills: number;
  /** Chance of a plateau (a tableland cut by canyons). */
  plateau: number;
  /**
   * Hillslope creep against river incision (0..1): rounded hills and valleys far apart when
   * high, sharp ridges and dense ravines when low (Perron et al. 2008: valley spacing follows the
   * ratio of diffusion to incision).
   */
  creep: number;
}

export const LANDFORM_STYLES: Record<string, LandformStyle> = {
  tectonic: { land: [.45, .6], arms: [1, 3], islets: 3, ranges: 1, spurs: .85, twin: false, base: .14, hills: .3, plateau: .35, creep: .06 },
  plains: { land: [.55, .7], arms: [0, 2], islets: 1, ranges: .18, spurs: .3, twin: false, base: .12, hills: .3, plateau: .1, creep: .9 },
  hills: { land: [.5, .64], arms: [1, 2], islets: 2, ranges: .42, spurs: .6, twin: false, base: .28, hills: .85, plateau: .2, creep: .7 },
  mountains: { land: [.5, .64], arms: [1, 3], islets: 2, ranges: 1.3, spurs: 1, twin: false, base: .32, hills: .3, plateau: .25, creep: .04 },
  valley: { land: [.55, .7], arms: [0, 1], islets: 1, ranges: 1.1, spurs: .7, twin: true, base: .18, hills: .2, plateau: .1, creep: .08 },
  island: { land: [.28, .42], arms: [1, 4], islets: 4, ranges: .8, spurs: .7, twin: false, base: .2, hills: .3, plateau: .2, creep: .07 },
  mixed: { land: [.45, .6], arms: [1, 3], islets: 2, ranges: .8, spurs: .7, twin: false, base: .28, hills: .5, plateau: .4, creep: .15 },
};

export interface LandformInput {
  seed: string;
  /** Map edge (m). */
  size: number;
  seaLevel: number;
  /** Relief of the highest ground above the sea (m). */
  maxHeight: number;
  /** 0..1: weight of the small-scale detail. */
  roughness: number;
  /** Noise octaves for the detail (1..8). */
  detail: number;
  /** Land surrounded by sea (false: land to the edges, draining off the map). */
  island: boolean;
  style: LandformStyle;
}

type UV = [number, number];
interface Line { pts: UV[]; w: number[] }
interface Ridge { pts: UV[]; s: number[]; w: number }

/**
 * Coarse simulation grid, vertices per side: cells of at least 16 m (valleys narrower than a few
 * cells would be ravines at any map scale), at most 257 per side (32 m cells on an 8 km map).
 */
export const simSize = (size: number) => Math.max(33, Math.min(257, Math.round(size / 16) + 1));

const DI = [1, -1, 0, 0, 1, 1, -1, -1] as const;
const DJ = [0, 0, 1, -1, 1, -1, 1, -1] as const;
const DD = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2] as const;

function fbm(n: Simplex2, x: number, z: number, octaves: number, persistence = .5, lacunarity = 2.03): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += n.noise(x * freq + o * 19.1, z * freq - o * 7.3) * amp;
    norm += amp; amp *= persistence; freq *= lacunarity;
  }
  return sum / norm;
}

function ridgedNoise(n: Simplex2, x: number, z: number, octaves: number): number {
  let sum = 0, amp = 1, freq = 1, norm = 0, weight = 1;
  for (let o = 0; o < octaves; o++) {
    let v = 1 - Math.abs(n.noise(x * freq - o * 5.7, z * freq + o * 3.3));
    v *= v * weight; weight = Math.min(1, v * 1.8);
    sum += v * amp; norm += amp; amp *= .42; freq *= 2.1;
  }
  return sum / norm;
}

/** Distance from p to a polyline, and the interpolated value of `w` at the closest point. */
function lineDistance(pts: UV[], w: number[] | null, x: number, z: number): [number, number] {
  let best = Infinity, bw = w ? w[0]! : 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1]!, [bx, bz] = pts[i]!, dx = bx - ax, dz = bz - az, len = dx * dx + dz * dz;
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len)) : 0;
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) { best = d; if (w) bw = w[i - 1]! + (w[i]! - w[i - 1]!) * t; }
  }
  return [best, bw];
}


/** A wandering polyline: `n` points from `start`, heading `angle`, turning a little each step. */
function walk(rng: Rng, start: UV, angle: number, length: number, n: number, turn: number): UV[] {
  const pts: UV[] = [start];
  let a = angle;
  for (let i = 1; i < n; i++) {
    a += (rng.next() - .5) * turn;
    const [px, pz] = pts[i - 1]!;
    pts.push([px + Math.cos(a) * length / (n - 1), pz + Math.sin(a) * length / (n - 1)]);
  }
  return pts;
}

/** The landmass skeleton and the mountain ranges on it, all in map units (0..1). */
function skeleton(seed: string, style: LandformStyle): { mass: Line[]; ridges: Ridge[] } {
  const rng = new Rng(seedNumber(seed, 'landform-skeleton'));
  const mass: Line[] = [], ridges: Ridge[] = [];
  // The main landmass: a bent spine, recentred on the map.
  const n = 7, length = .6 + rng.next() * .25, angle = rng.next() * Math.PI * 2;
  const spine = walk(rng, [0, 0], angle, length, n, 1);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of spine) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const ox = .5 + (rng.next() - .5) * .08 - (x0 + x1) / 2, oz = .5 + (rng.next() - .5) * .08 - (z0 + z1) / 2;
  for (const p of spine) { p[0] += ox; p[1] += oz; }
  let W = .19 + rng.next() * .06;
  // Shrunk towards the centre when it would reach the map's edge (the sea all round must stay
  // the skeleton's coast, not a straight cut along the edge).
  const reach = Math.max(...spine.map(([x, z]) => Math.max(Math.abs(x - .5), Math.abs(z - .5)))) + W * .6;
  if (reach > .41) { const k = .41 / reach; for (const p of spine) { p[0] = .5 + (p[0] - .5) * k; p[1] = .5 + (p[1] - .5) * k; } W *= k; }
  mass.push({ pts: spine, w: spine.map((_, i) => W * (.5 + .5 * Math.sin(Math.PI * (i + .5) / n)) * (.8 + rng.next() * .45)) });
  const dirAt = (pts: UV[], i: number) => { const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
  // Arms: peninsulas branching off the spine.
  const arms = style.arms[0] + Math.floor(rng.next() * (style.arms[1] - style.arms[0] + 1));
  for (let k = 0; k < arms; k++) {
    const j = 1 + Math.floor(rng.next() * (n - 2)), side = rng.next() < .5 ? -1 : 1;
    const a = dirAt(spine, j) + side * (.8 + rng.next() * 1.1), len = .14 + rng.next() * .2, w0 = W * (.45 + rng.next() * .3);
    const pts = walk(rng, spine[j]!, a, len, 5, .9);
    mass.push({ pts, w: pts.map((_, i) => w0 * (1 - .65 * i / 4)) });
  }
  // Islets off the coast.
  const islets = Math.floor(rng.next() * (style.islets + 1));
  for (let k = 0; k < islets; k++) {
    const j = Math.floor(rng.next() * n), a = dirAt(spine, j) + (rng.next() < .5 ? -1 : 1) * Math.PI / 2;
    const d = mass[0]!.w[j]! * (1.5 + rng.next() * .8) + .03 + rng.next() * .05, [px, pz] = spine[j]!;
    const c: UV = [px + Math.cos(a) * d, pz + Math.sin(a) * d];
    if (c[0] < .08 || c[1] < .08 || c[0] > .92 || c[1] > .92) continue;
    const pts = walk(rng, c, rng.next() * Math.PI * 2, .02 + rng.next() * .05, 3, 1.2);
    mass.push({ pts, w: pts.map(() => .02 + rng.next() * .025) });
  }
  // Ranges: the backbone off-centre (towards one coast), or two either side of a valley.
  const smoothRandom = (count: number, lo: number, hi: number) => {
    const raw = Array.from({ length: count }, () => lo + rng.next() * (hi - lo));
    return raw.map((v, i) => (v * 2 + (raw[i - 1] ?? v) + (raw[i + 1] ?? v)) / 4);
  };
  const offsetLine = (line: Line, shift: number, wobble: number): UV[] => line.pts.map((p, i) => {
    const a = dirAt(line.pts, i) + Math.PI / 2, o = line.w[i]! * (shift + (rng.next() - .5) * wobble);
    return [p[0] + Math.cos(a) * o, p[1] + Math.sin(a) * o];
  });
  const addRidge = (pts: UV[], strength: number, width: number) => ridges.push({ pts, s: smoothRandom(pts.length, strength * .6, strength), w: width });
  if (style.ranges > 0) {
    const main = mass[0]!;
    if (style.twin) for (const side of [-1, 1]) addRidge(offsetLine(main, side * .55, .2), 1, .02 + rng.next() * .01);
    else addRidge(offsetLine(main, (rng.next() - .5) * .9, .3), 1, .022 + rng.next() * .012);
    for (let k = 1; k < mass.length; k++) if (mass[k]!.pts.length > 3 && rng.next() < .75) addRidge(offsetLine(mass[k]!, (rng.next() - .5) * .5, .3), .5 + rng.next() * .3, .016 + rng.next() * .008);
    // Spurs and sub-spurs: side ridges dropping off the crest, which the rivers then separate.
    const spur = (from: UV, a: number, len: number, strength: number, depth: number) => {
      const pts = walk(rng, from, a, len, 4, .5);
      ridges.push({ pts, s: pts.map((_, i) => strength * (1 - .55 * i / 3)), w: .012 + rng.next() * .006 });
      if (depth > 0) for (let i = 1; i < 3; i++) if (rng.next() < .5) spur(pts[i]!, a + (rng.next() < .5 ? -1 : 1) * (.7 + rng.next() * .5), len * .5, strength * .55, depth - 1);
    };
    for (const r of ridges.slice()) for (let i = 0; i < r.pts.length - 1; i++) {
      if (rng.next() > style.spurs) continue;
      const t = rng.next(), [ax, az] = r.pts[i]!, [bx, bz] = r.pts[i + 1]!, a = Math.atan2(bz - az, bx - ax);
      for (const side of [-1, 1]) if (rng.next() < .8) spur([ax + (bx - ax) * t, az + (bz - az) * t], a + side * (1.05 + rng.next() * .5), .04 + rng.next() * .07, r.s[i]! * .6, 1);
    }
  }
  return { mass, ridges };
}

/** Two-pass chamfer distance (in cells) to the nearest cell where `inside` differs. */
function chamfer(n: number, seedMask: Uint8Array): Float32Array {
  const d = new Float32Array(n * n);
  for (let k = 0; k < d.length; k++) d[k] = seedMask[k] ? 0 : 1e9;
  const r2 = Math.SQRT2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    let v = d[k]!;
    if (i > 0) v = Math.min(v, d[k - 1]! + 1);
    if (j > 0) { v = Math.min(v, d[k - n]! + 1); if (i > 0) v = Math.min(v, d[k - n - 1]! + r2); if (i < n - 1) v = Math.min(v, d[k - n + 1]! + r2); }
    d[k] = v;
  }
  for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
    const k = j * n + i;
    let v = d[k]!;
    if (i < n - 1) v = Math.min(v, d[k + 1]! + 1);
    if (j < n - 1) { v = Math.min(v, d[k + n]! + 1); if (i < n - 1) v = Math.min(v, d[k + n + 1]! + r2); if (i > 0) v = Math.min(v, d[k + n - 1]! + r2); }
    d[k] = v;
  }
  return d;
}

export interface CoarseLandform {
  n: number;
  /** Land (1) or sea (0) per coarse vertex. */
  land: Uint8Array;
  /** Signed distance to the coast in map units (+ inland). */
  coast: Float32Array;
  uplift: Float32Array;
  /** Normalised relief after stream-power erosion (0 at the sea, ~1 on the highest crests). */
  relief: Float32Array;
  /**
   * Map coordinates of the grid: u = origin + (i / (n − 1)) · span. Land without a sea is
   * simulated over a wider area draining off beyond the map, so the map's own edges are not
   * one long valley.
   */
  origin: number;
  span: number;
}

/** Steps 1–3 on the coarse grid: outline, uplift and the stream-power landscape. */
export function* coarseLandform(input: LandformInput): Generator<number, CoarseLandform> {
  const origin = input.island ? 0 : -.25, span = input.island ? 1 : 1.5;
  const n = simSize(input.size * span), N = n * n, last = n - 1, style = input.style;
  const warp = new Simplex2(seedNumber(input.seed, 'landform-warp')), shore = new Simplex2(seedNumber(input.seed, 'landform-shore'));
  const hillNoise = new Simplex2(seedNumber(input.seed, 'landform-hills'));
  const rng = new Rng(seedNumber(input.seed, 'landform-shape'));
  const { mass, ridges } = skeleton(input.seed, style);

  /* 1. The outline: closeness to the skeleton, bent and roughened, cut at the land share. */
  const field = new Float32Array(N), wu = new Float32Array(N), wv = new Float32Array(N);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u = origin + i / last * span, v = origin + j / last * span, k = j * n + i;
    const x = u + warp.noise(u * 2.2, v * 2.2) * .06 + warp.noise(u * 6.5 + 9, v * 6.5) * .018;
    const z = v + warp.noise(u * 2.2 + 31.7, v * 2.2 - 12.4) * .06 + warp.noise(u * 6.5 - 4, v * 6.5 + 17) * .018;
    wu[k] = x; wv[k] = z;
    let c = -Infinity;
    for (const m of mass) { const [d, w] = lineDistance(m.pts, m.w, x, z); c = Math.max(c, 1 - d / w); }
    c += fbm(shore, u * 3.5, v * 3.5, 3) * .35 + fbm(shore, u * 9 + 50, v * 9, 3) * .14;
    if (input.island) {
      // The sea all round, decided at the very edge only: the outline comes from the skeleton.
      const edge = Math.max(Math.abs(u - .5), Math.abs(v - .5));
      c -= 3 * smoothstep(.38, .49, edge);
    }
    field[k] = c;
  }
  const land = new Uint8Array(N);
  if (input.island) {
    const share = style.land[0] + rng.next() * (style.land[1] - style.land[0]);
    const sorted = Float32Array.from(field).sort();
    // The share bends the coast in or out a little; the outline itself stays the skeleton's
    // (an unbounded cut would fill the map to its square edge).
    const cut = Math.max(-.25, Math.min(.3, sorted[Math.min(N - 1, Math.floor(N * (1 - share)))]!));
    for (let k = 0; k < N; k++) land[k] = field[k]! > cut ? 1 : 0;
  } else land.fill(1);
  // Specks (one-cell islands or ponds) would only be noise: drop them.
  for (let j = 1; j < last; j++) for (let i = 1; i < last; i++) {
    const k = j * n + i;
    let same = 0;
    for (let d = 0; d < 8; d++) if (land[k + DI[d]! + DJ[d]! * n] === land[k]) same++;
    if (same <= 1) land[k] = land[k] ? 0 : 1;
  }
  const seaMask = new Uint8Array(N), landMask = new Uint8Array(N);
  for (let k = 0; k < N; k++) { seaMask[k] = land[k] ? 0 : 1; landMask[k] = land[k]!; }
  const toSea = chamfer(n, seaMask), toLand = chamfer(n, landMask), coast = new Float32Array(N);
  for (let k = 0; k < N; k++) coast[k] = (land[k] ? toSea[k]! : -toLand[k]!) / last;
  if (!input.island) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) coast[j * n + i] = Math.min(i, j, last - i, last - j) / last * span;
  yield .1;

  /* 2. Uplift: ranges along the ridge lines, a broad rise inland, rolling hills, and lowland
     basins (plains and wide valleys) away from the ranges where the ground hardly rises. */
  const uplift = new Float32Array(N), ridgeness = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    if (!land[k]) continue;
    const x = wu[k]!, z = wv[k]!;
    let r = 0;
    for (const ridge of ridges) {
      const [d, s] = lineDistance(ridge.pts, ridge.s, x, z);
      if (d < ridge.w * 3) r += s * Math.exp(-((d / ridge.w) ** 2));
    }
    ridgeness[k] = 1 - Math.exp(-1.4 * r);
  }
  const lowlands: Array<[number, number, number]> = [];
  for (let tries = 0; tries < 400 && lowlands.length < 1 + Math.round(style.hills * 2 + (1 - style.ranges) * 2); tries++) {
    const k = Math.floor(rng.next() * N), x = wu[k]!, z = wv[k]!;
    if (!land[k] || coast[k]! < .03 || ridgeness[k]! > .25 || lowlands.some(([px, pz]) => Math.hypot(px - x, pz - z) < .15)) continue;
    lowlands.push([x, z, .05 + rng.next() * .07]);
  }
  for (let k = 0; k < N; k++) {
    if (!land[k]) continue;
    const x = wu[k]!, z = wv[k]!, r = ridgeness[k]!;
    const inland = smoothstep(0, .2, coast[k]!), hills = fbm(hillNoise, x * 5, z * 5, 3) * .5 + .5, broad = fbm(hillNoise, x * 1.6 + 40, z * 1.6, 2) * .5 + .5;
    const jitter = 1 + fbm(warp, x * 14, z * 14, 2) * .35;
    let low = 1;
    for (const [px, pz, rad] of lowlands) low = Math.min(low, .15 + .85 * smoothstep(rad * .5, rad * 1.4, Math.hypot(x - px, z - pz)));
    uplift[k] = (.02 + inland * (style.base * (.4 + .7 * broad) * low + style.ranges * r * (.7 + .5 * hills) + style.hills * hills * hills * .5 * low)) * jitter;
  }
  yield .15;

  /* 3. Stream power: rivers cut down as fast as the ground rises, until the landscape settles. */
  const h = new Float64Array(N), recv = new Int32Array(N), order = new Int32Array(N), area = new Float64Array(N), dist = new Float32Array(N);
  const outlet = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const i = k % n, j = (k - i) / n;
    outlet[k] = !land[k] || (!input.island && (i === 0 || j === 0 || i === last || j === last)) ? 1 : 0;
    h[k] = outlet[k] ? 0 : uplift[k]! * .5 + (fbm(hillNoise, i * .09, j * .09, 3) * .5 + .5) * .08;
  }
  const heap = new IndexHeap(N), done = new Uint8Array(N), fill = new Float64Array(N);
  // Hillslopes no steeper than the angle of repose once scaled to the map's relief.
  // (Steep ~48° faces belong to high ranges; low hills keep gentler sides.)
  const K = .35, M = .5, DT = 1, STEPS = 110, TALUS = input.size * span / last * Math.min(1.1, .25 + input.maxHeight / 400) / input.maxHeight;
  let peak = 1e-3;
  const creep = style.creep;
  for (let step = 0; step < STEPS; step++) {
    // Drainage: Priority-Flood (+ε) from the outlets (the sea) fills the pits and gives the
    // order from the sea upstream.
    done.fill(0);
    let count = 0;
    for (let k = 0; k < N; k++) if (outlet[k]) { heap.push(k, h[k]!); done[k] = 1; recv[k] = k; fill[k] = h[k]!; }
    while (heap.size) {
      const c = heap.pop();
      order[count++] = c;
      const ci = c % n, cj = (c - ci) / n;
      for (let d = 0; d < 8; d++) {
        const i = ci + DI[d]!, j = cj + DJ[d]!;
        if (i < 0 || j < 0 || i > last || j > last) continue;
        const nb = j * n + i;
        if (done[nb]) continue;
        done[nb] = 1;
        fill[nb] = Math.max(h[nb]!, fill[c]! + 1e-6);
        heap.push(nb, fill[nb]!);
      }
    }
    // Every cell drains down the steepest way over the filled surface (which always has one).
    for (let q = 0; q < count; q++) {
      const c = order[q]!;
      if (outlet[c]) continue;
      const ci = c % n, cj = (c - ci) / n;
      let best = -1, bs = 0;
      for (let d = 0; d < 8; d++) {
        const i = ci + DI[d]!, j = cj + DJ[d]!;
        if (i < 0 || j < 0 || i > last || j > last) continue;
        const nb = j * n + i, s = (fill[c]! - fill[nb]!) / DD[d]!;
        if (s > bs) { bs = s; best = d; }
      }
      recv[c] = best < 0 ? c : (cj + DJ[best]!) * n + ci + DI[best]!; dist[c] = best < 0 ? 1 : DD[best]!;
    }
    // Drainage area (rain-weighted: the ranges catch more), upstream first.
    for (let k = 0; k < N; k++) area[k] = 1 + uplift[k]! * 1.5;
    for (let q = count - 1; q > 0; q--) { const c = order[q]!; if (recv[c] !== c) area[recv[c]!] += area[c]!; }
    // Implicit stream-power update, downstream first (each receiver already has its new height).
    for (let q = 0; q < count; q++) {
      const c = order[q]!, r = recv[c]!;
      if (r === c || outlet[c]) continue;
      const f = K * DT * area[c]! ** M / dist[c]!;
      let v = (h[c]! + DT * uplift[c]! * .05 + f * h[r]!) / (1 + f);
      // Hillslopes: nothing steeper than the angle of repose.
      const maxRise = TALUS * dist[c]! * peak;
      if (v - h[r]! > maxRise) v = h[r]! + maxRise;
      h[c] = v;
    }
    // Creep: material moves down the slopes (explicit diffusion in passes stable below 0.25).
    for (let pass = 0, passes = Math.ceil(creep / .2); pass < passes; pass++) {
      const c = creep / passes;
      fill.set(h);
      for (let j = 1; j < last; j++) for (let i = 1; i < last; i++) {
        const k = j * n + i;
        if (!outlet[k]) h[k] = fill[k]! + c * (fill[k - 1]! + fill[k + 1]! + fill[k - n]! + fill[k + n]! - 4 * fill[k]!);
      }
    }
    peak = 1e-3;
    for (let k = 0; k < N; k++) if (h[k]! > peak) peak = h[k]!;
    if (step % 10 === 9) yield .15 + .7 * (step + 1) / STEPS;
  }
  // Normalise: the highest crests (a robust percentile, not one spike) reach 1.
  const tops: number[] = [];
  for (let k = 0; k < N; k++) if (land[k]) tops.push(h[k]!);
  tops.sort((a, b) => a - b);
  const top = Math.max(1e-6, tops[Math.floor(tops.length * .997)] ?? 1);
  const relief = new Float32Array(N);
  for (let k = 0; k < N; k++) { const t = h[k]! / top; relief[k] = t > 1 ? 1 + (t - 1) * .3 : t; }
  yield .9;
  return { n, land, coast, uplift, relief, origin, span };
}

/** Catmull-Rom weights for a fractional offset. */
function cubicWeights(t: number, out: Float64Array): void {
  const t2 = t * t, t3 = t2 * t;
  out[0] = -.5 * t3 + t2 - .5 * t;
  out[1] = 1.5 * t3 - 2.5 * t2 + 1;
  out[2] = -1.5 * t3 + 2 * t2 + .5 * t;
  out[3] = .5 * t3 - .5 * t2;
}

/**
 * Steps 1–4: fills `hf.heights` with the landform (before the droplet erosion and hydrology).
 * Yields progress 0..1.
 */
export function* buildLandform(input: LandformInput, hf: Heightfield): Generator<number, CoarseLandform> {
  const coarse = yield* coarseLandform(input);
  const { n, relief, coast } = coarse, last = n - 1, sea = input.seaLevel, top = input.maxHeight;
  const rng = new Rng(seedNumber(input.seed, 'landform-final'));
  const shelfNoise = new Simplex2(seedNumber(input.seed, 'landform-shelf'));
  // Coarse heights in metres: low land rises gently from the beaches (γ > 1), the sea floor
  // drops off a shelf whose steepness varies along the coast.
  const coarseH = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, u = coarse.origin + i / last * coarse.span, v = coarse.origin + j / last * coarse.span;
    if (coarse.land[k]) coarseH[k] = sea + .7 + top * relief[k]! ** 1.5;
    else {
      const shelf = .012 + .05 * (shelfNoise.noise(u * 5, v * 5) * .5 + .5);
      coarseH[k] = sea - Math.min(70, 1.2 + -coast[k]! * input.size * shelf);
    }
  }
  // A plateau: the ground above a level is pressed flat; valleys below it stay as canyons.
  if (rng.next() < input.style.plateau) {
    const cand: number[] = [];
    for (let k = 0; k < n * n; k++) if (coast[k]! > .1 && relief[k]! > .25) cand.push(k);
    if (cand.length) {
      const c = cand[Math.floor(rng.next() * cand.length)]!, ci = c % n, cj = (c - ci) / n, R = (.06 + rng.next() * .05) * last;
      const inside: number[] = [];
      for (let j = Math.max(0, Math.floor(cj - R)); j <= Math.min(last, Math.ceil(cj + R)); j++) for (let i = Math.max(0, Math.floor(ci - R)); i <= Math.min(last, Math.ceil(ci + R)); i++) if (Math.hypot(i - ci, j - cj) < R) inside.push(coarseH[j * n + i]!);
      inside.sort((a, b) => a - b);
      const level = inside[Math.floor(inside.length * .55)]!;
      for (let j = Math.max(0, Math.floor(cj - R)); j <= Math.min(last, Math.ceil(cj + R)); j++) for (let i = Math.max(0, Math.floor(ci - R)); i <= Math.min(last, Math.ceil(ci + R)); i++) {
        const k = j * n + i, d = Math.hypot(i - ci, j - cj) + shelfNoise.noise(i * .15, j * .15) * R * .2, m = 1 - smoothstep(R * .7, R, d);
        if (m > 0 && coarseH[k]! > level) coarseH[k] = coarseH[k]! - (coarseH[k]! - level) * .8 * m;
      }
    }
  }
  yield .92;

  // Bicubic upsampling to the editing grid, through a slight warp (about a coarse cell) so the
  // simulation grid's axes leave no straight facets on the slopes.
  const cols = hf.cols, wx = new Float64Array(4), wz = new Float64Array(4), H = hf.heights;
  const uw = new Simplex2(seedNumber(input.seed, 'landform-upsample'));
  for (let j = 0; j < cols; j++) {
    for (let i = 0; i < cols; i++) {
      const ux = (i / (cols - 1) - coarse.origin) / coarse.span * last, uz = (j / (cols - 1) - coarse.origin) / coarse.span * last;
      const fx = Math.max(0, Math.min(last, ux + uw.noise(ux * .11, uz * .11) * .9 + uw.noise(ux * .37 + 5, uz * .37) * .35));
      const fz = Math.max(0, Math.min(last, uz + uw.noise(ux * .11 - 9, uz * .11 + 4) * .9 + uw.noise(ux * .37, uz * .37 - 7) * .35));
      const ci = Math.min(last - 1, Math.floor(fx)), cj = Math.min(last - 1, Math.floor(fz));
      cubicWeights(fx - ci, wx); cubicWeights(fz - cj, wz);
      let s = 0;
      for (let b = 0; b < 4; b++) {
        const jj = Math.max(0, Math.min(last, cj - 1 + b)) * n;
        let row = 0;
        for (let a = 0; a < 4; a++) row += coarseH[jj + Math.max(0, Math.min(last, ci - 1 + a))]! * wx[a]!;
        s += row * wz[b]!;
      }
      H[j * cols + i] = s;
    }
  }
  yield .95;

  // Detail on top of the landform: a metre or so on the plains, rocky texture on the heights,
  // layered rock (strata) on the steep faces. Wavelengths from four coarse cells down to two
  // grid cells.
  const det = new Simplex2(seedNumber(input.seed, 'landform-detail')), dwarp = new Simplex2(seedNumber(input.seed, 'landform-detail-warp'));
  const base = input.size * coarse.span / last * 8, octaves = Math.max(1, Math.min(input.detail, Math.floor(Math.log2(base / (2 * hf.cell))) + 1));
  // Detail in proportion to the relief: a few metres on 30 m hills, tens on a 360 m range.
  const reliefScale = Math.max(.15, Math.min(1.5, top / 250));
  const rough = .35 + input.roughness, cell = hf.cell, layer = Math.max(4 * cell, 7 + rng.next() * 5);
  const src = H.slice();
  for (let j = 0; j < cols; j++) for (let i = 0; i < cols; i++) {
    const k = j * cols + i, h0 = src[k]!, rel = h0 - sea;
    const x = i * cell / base, z = j * cell / base;
    if (rel < 0) { H[k] = h0 + det.noise(x * 2, z * 2) * .6; continue; }
    const t = Math.min(1, rel / top);
    const gx = (src[j * cols + Math.min(cols - 1, i + 1)]! - src[j * cols + Math.max(0, i - 1)]!) / (2 * cell);
    const gz = (src[Math.min(cols - 1, j + 1) * cols + i]! - src[Math.max(0, j - 1) * cols + i]!) / (2 * cell);
    const slope = Math.hypot(gx, gz);
    const ox = dwarp.noise(x * .7, z * .7) * .6, oz = dwarp.noise(x * .7 + 13, z * .7 - 7) * .6;
    const soft = fbm(det, x + ox, z + oz, octaves, .38), rocky = ridgedNoise(det, (x - oz) * 1.3, (z + ox) * 1.3, octaves) - .45;
    const amp = rough * (1.2 + 15 * t ** 1.2) * reliefScale * (1 + Math.min(1, slope) * .5);
    let hd = h0 + (soft * (1 - t) + rocky * t * 1.4) * amp * smoothstep(.5, 6, rel);
    // Strata: steep high ground breaks into ledges a few metres apart.
    const strata = smoothstep(.5, 1.1, slope) * smoothstep(.18, .4, t);
    if (strata > 0) {
      const lv = hd / layer, fl = Math.floor(lv), terraced = (fl + smoothstep(.2, .8, lv - fl)) * layer;
      hd += (terraced - hd) * .35 * strata;
    }
    H[k] = hd;
  }
  yield 1;
  return coarse;
}
