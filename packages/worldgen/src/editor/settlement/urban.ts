import { BUILDING_TYPE_INFO, isFacility, kindOfArea, settlementFacilities, smoothstep, type BuildingType, type Rng } from '@zion/shared';
import { Simplex2 } from '../../noise';
import { SpatialGrid, convexHull, densify, distanceToPolyline, obbOverlap, obbRadius, pointInPolygon, type Obb, type Vec2 } from '../geometry';
import { seedNumber, stream } from '../heightfield';
import type { CompositeOption, CompositeRecipe } from './composite';
import type { LotClass, SettlementSettings } from './presets';

/**
 * Urban layout ("Quy hoạch đô thị"): a terrain-aware street network traced through a tensor
 * field, street-front parcels cut from it, coherent districts, public services and a spatially
 * coherent state of abandonment. Used by generateSettlement when `layout` is 'urban'.
 *
 * Algorithms (ideas, not code, from the research in docs/urban-generation.md):
 * - Streets: Chen et al. 2008 "Interactive procedural street modeling" — a field of 2×2
 *   symmetric tensors built from weighted basis fields (grid, radial), here also the region's
 *   edges, the incoming roads and the terrain (streets follow the contours on slopes). Major and
 *   minor eigenvector fields are traced as streamlines (RK4) with a separation distance per road
 *   class (arterial → collector → lane), stopping on water, steep ground, the region edge or near
 *   a parallel street, and snapping their ends onto a nearby street to make junctions.
 * - Parcels: frontage subdivision (Vanegas et al. 2012 "Procedural generation of parcels") —
 *   lots along each street side, as deep as the block allows (half the distance to the street
 *   behind), higher-class streets first so corners go to them.
 * - Districts: weighted Voronoi of district seeds placed by planning rules (commercial core on
 *   the arterials, industry at the edge by the outgoing road or water, housing elsewhere), with
 *   noise-perturbed borders and shop-houses along the main streets.
 */

export type UrbanPattern = 'vietnamese' | 'planned' | 'mixed';
export const URBAN_PATTERNS: Array<{ id: UrbanPattern; name: string }> = [
  { id: 'vietnamese', name: 'Phố Việt tự phát' }, { id: 'planned', name: 'Quy hoạch bài bản' }, { id: 'mixed', name: 'Hỗn hợp' },
];
/** What a parcel is used for, beyond its district class. */
export type LotUse = 'park' | BuildingType;
export type BuildingCondition = 'intact' | 'abandoned' | 'ruined';
export interface District { id: string; cls: LotClass | 'green'; x: number; z: number }

export interface UrbanGround { water(x: number, z: number): boolean; slope(x: number, z: number): number; height(x: number, z: number): number }
type RoadKind = 'main' | 'secondary' | 'alley' | 'connector';
interface Road { id: string; kind: RoadKind; width: number; points: Vec2[] }
interface UrbanLot { id: string; block: string; polygon: Vec2[]; front: [Vec2, Vec2]; dir: Vec2; obb: Obb; cls: LotClass | 'green' | 'empty'; use?: LotUse; district?: string; wide?: boolean; road?: RoadKind }

/* ------------------------------------------------------------------------- tensor field */

interface Basis { kind: 'grid' | 'radial'; x: number; z: number; size: number; decay: number; angle: number; weight: number }

export class TensorField {
  private readonly noise: Simplex2;
  constructor(
    readonly bases: Basis[], private readonly ground: UrbanGround, private readonly terrainWeight: number,
    seed: number, private readonly noiseAngle: number, private readonly noiseScale: number,
  ) { this.noise = new Simplex2(seed); }

  /** Angle of the major eigenvector at (x, z); the minor family runs at right angles to it. */
  angle(x: number, z: number): number {
    let a = 0, b = 0;
    for (const q of this.bases) {
      const dx = x - q.x, dz = z - q.z, w = q.weight * Math.exp(-q.decay * (dx * dx + dz * dz) / (q.size * q.size));
      if (w < 1e-5) continue;
      const th = q.kind === 'grid' ? q.angle : Math.atan2(dz, dx);
      a += w * Math.cos(2 * th); b += w * Math.sin(2 * th);
    }
    if (this.terrainWeight > 0) {
      // On a slope the streets follow the contours, and the cross streets climb straight up.
      const e = 6, h = this.ground;
      const gx = (h.height(x + e, z) - h.height(x - e, z)) / (2 * e), gz = (h.height(x, z + e) - h.height(x, z - e)) / (2 * e);
      const w = this.terrainWeight * 3 * smoothstep(.03, .18, Math.hypot(gx, gz));
      if (w > 0) { const th = Math.atan2(gz, gx) + Math.PI / 2; a += w * Math.cos(2 * th); b += w * Math.sin(2 * th); }
    }
    let th = Math.atan2(b, a) / 2;
    if (this.noiseAngle) th += this.noise.noise(x * this.noiseScale, z * this.noiseScale) * this.noiseAngle;
    return th;
  }
  dir(x: number, z: number, minor: boolean): Vec2 {
    const th = this.angle(x, z) + (minor ? Math.PI / 2 : 0);
    return [Math.cos(th), Math.sin(th)];
  }
}

export interface FieldInput { polygon: Vec2[]; center: Vec2; angle: number; radius: number; pattern: UrbanPattern; seed: string; ground: UrbanGround; externalRoads: Array<{ points: Vec2[] }>; randomness: number }

/** The tensor field of a settlement: its planning pattern, the region's edges, the incoming roads and the terrain. */
export function urbanField(f: FieldInput): TensorField {
  const R = Math.max(80, f.radius), [cx, cz] = f.center, rng = stream(f.seed, 'urban-field');
  const bases: Basis[] = [];
  if (f.pattern === 'planned') {
    bases.push({ kind: 'grid', x: cx, z: cz, size: R * 1.6, decay: 1, angle: f.angle, weight: 2 });
    // A second neighbourhood laid out on its own grid, a little turned.
    const a = rng.next() * Math.PI * 2, d = R * (.45 + rng.next() * .25);
    bases.push({ kind: 'grid', x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d, size: R * .55, decay: 2, angle: f.angle + (rng.next() - .5) * .8, weight: 1.6 });
  } else if (f.pattern === 'vietnamese') {
    // Streets fan out from the market and bend with the old field boundaries.
    bases.push({ kind: 'radial', x: cx, z: cz, size: R * .55, decay: 2.5, angle: 0, weight: 1.4 });
    bases.push({ kind: 'grid', x: cx, z: cz, size: R * 1.2, decay: 1.2, angle: f.angle, weight: .9 });
  } else {
    // Planned core, organic outskirts.
    bases.push({ kind: 'grid', x: cx, z: cz, size: R * .6, decay: 1.4, angle: f.angle, weight: 3 });
    bases.push({ kind: 'radial', x: cx, z: cz, size: R * 1.3, decay: .9, angle: 0, weight: .7 });
  }
  // Streets near the edge run along it (rivers, hills and fields bound real towns).
  const edge = densify(f.polygon, Math.max(30, R / 3));
  for (let i = 0; i < edge.length; i++) {
    const p = edge[i]!, q = edge[(i + 1) % edge.length]!;
    bases.push({ kind: 'grid', x: (p[0] + q[0]) / 2, z: (p[1] + q[1]) / 2, size: R * .22, decay: 2, angle: Math.atan2(q[1] - p[1], q[0] - p[0]), weight: f.pattern === 'planned' ? .5 : 1 });
  }
  // The highway into town sets the direction of the street it becomes.
  for (const r of f.externalRoads) for (let i = 1; i < r.points.length; i++) {
    const a = r.points[i - 1]!, b = r.points[i]!, mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    if (Math.hypot(mx - cx, mz - cz) > R * 1.3) continue;
    bases.push({ kind: 'grid', x: mx, z: mz, size: R * .3, decay: 2, angle: Math.atan2(b[1] - a[1], b[0] - a[0]), weight: 1.2 });
  }
  const noise = f.pattern === 'vietnamese' ? .35 + .3 * f.randomness : f.pattern === 'mixed' ? .12 + .2 * f.randomness : .04 * f.randomness;
  return new TensorField(bases, f.ground, f.pattern === 'planned' ? .5 : 1, seedNumber(f.seed, 'urban-noise'), noise, 1 / 320);
}

/* ------------------------------------------------------------------------ street network */

interface Level { kind: RoadKind; width: number; dsep: number; dtest: number; maxLen: number; minLen: number; tries: number; deadEnds?: boolean; keep?: (x: number, z: number) => number }
interface Sample { x: number; z: number; road: number; minor: boolean }

const H = 4;
function simplify(points: Vec2[], tol: number): Vec2[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let worst = -1, at = -1;
    for (let k = i + 1; k < j; k++) { const d = distanceToPolyline(points[k]![0], points[k]![1], [points[i]!, points[j]!]); if (d > worst) { worst = d; at = k; } }
    if (worst > tol) { keep[at] = 1; stack.push([i, at], [at, j]); }
  }
  return points.filter((_, k) => keep[k]);
}
const lineLength = (pts: readonly Vec2[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]) : 0), 0);

export interface StreetInput {
  field: TensorField; polygon: Vec2[]; ground: UrbanGround; center: Vec2; radius: number; pattern: UrbanPattern; seed: string;
  /** Can a street run from a to b (ground, grade, water)? */
  passable(a: Vec2, b: Vec2): boolean;
  settings: Pick<SettlementSettings, 'mainRoadWidth' | 'secondaryRoadWidth' | 'alleyWidth' | 'blockSize' | 'lotDepth' | 'lotWidth' | 'density'>;
  /** Where the outside roads come in: the arterials start there. */
  entries: Vec2[];
}

/**
 * Streets traced as streamlines of the field, class by class: arterials far apart, collectors
 * between them, then (in Vietnamese and mixed towns) lanes off the streets into the deep blocks.
 */
export function traceStreets(input: StreetInput): Road[] {
  const { field, polygon, ground, pattern, settings: st } = input;
  const rng = stream(input.seed, 'urban-streets');
  const R = Math.max(80, input.radius), bs = st.blockSize;
  const roads: Road[] = [];
  const fam = [new SpatialGrid<Sample>(32, () => 0), new SpatialGrid<Sample>(32, () => 0)];
  const all = new SpatialGrid<Sample>(24, () => 0);
  const inside = (p: Vec2) => pointInPolygon(p[0], p[1], polygon);
  const near = (grid: SpatialGrid<Sample>, p: Vec2, r: number, skip = -1) => {
    let best: Sample | null = null, d = r;
    for (const s of grid.query(p[0], p[1], r)) { if (s.road === skip) continue; const e = Math.hypot(s.x - p[0], s.z - p[1]); if (e < d) { d = e; best = s; } }
    return best;
  };
  const rk4 = (p: Vec2, d: Vec2, minor: boolean): Vec2 => {
    const f = (x: number, z: number): Vec2 => { const v = field.dir(x, z, minor); return v[0] * d[0] + v[1] * d[1] < 0 ? [-v[0], -v[1]] : v; };
    const k1 = f(p[0], p[1]), k2 = f(p[0] + k1[0] * H / 2, p[1] + k1[1] * H / 2), k3 = f(p[0] + k2[0] * H / 2, p[1] + k2[1] * H / 2), k4 = f(p[0] + k3[0] * H, p[1] + k3[1] * H);
    const x = k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0], z = k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1], l = Math.hypot(x, z) || 1;
    return [x / l, z / l];
  };
  /** One direction of a streamline from `seed`; ends snapped onto a nearby street when there is one. */
  const half = (seed: Vec2, start: Vec2, minor: boolean, L: Level, id: number): Vec2[] => {
    const out: Vec2[] = [];
    let p = seed, d = start, len = 0;
    const same = fam[minor ? 1 : 0]!;
    while (len < L.maxLen / (L.deadEnds ? 1 : 2)) {
      d = rk4(p, d, minor);
      const q: Vec2 = [p[0] + d[0] * H, p[1] + d[1] * H];
      if (!inside(q) || !input.passable(p, q)) break;
      // Converging on a parallel street: stop here and join it.
      if (len > H * 2 && near(same, q, L.dtest)) break;
      out.push(q); p = q; len += H;
    }
    // Snap the loose end onto the closest street ahead (a junction instead of a stub).
    const reach = L.deadEnds ? H * 3 : Math.min(36, L.dsep * .5);
    let best: Sample | null = null, bd = reach;
    for (const s of all.query(p[0], p[1], reach)) {
      if (s.road === id) continue;
      const dx = s.x - p[0], dz = s.z - p[1], e = Math.hypot(dx, dz);
      if (e < bd && (e < 1 || (dx * d[0] + dz * d[1]) / e > .2)) { bd = e; best = s; }
    }
    if (best && bd > .5 && input.passable(p, [best.x, best.z])) out.push([best.x, best.z]);
    return out;
  };
  const accept = (pts: Vec2[], minor: boolean, L: Level) => {
    const road: Road = { id: `u${roads.length}`, kind: L.kind, width: L.width, points: simplify(pts, .35) };
    const id = roads.length;
    roads.push(road);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!, n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / H));
      for (let k = 0; k <= n; k++) {
        const s: Sample = { x: a[0] + (b[0] - a[0]) * k / n, z: a[1] + (b[1] - a[1]) * k / n, road: id, minor };
        fam[minor ? 1 : 0]!.insert(s); all.insert(s);
      }
    }
  };
  const trace = (seed: Vec2, minor: boolean, L: Level, side?: Vec2): boolean => {
    if (!inside(seed) || ground.water(seed[0], seed[1])) return false;
    if (near(fam[minor ? 1 : 0]!, seed, L.dsep)) return false;
    const id = roads.length;
    const d0 = field.dir(seed[0], seed[1], minor);
    let pts: Vec2[];
    if (L.deadEnds && side) {
      // A lane goes one way only: away from the street it leaves.
      const s = d0[0] * side[0] + d0[1] * side[1] < 0 ? -1 : 1;
      if (Math.abs(d0[0] * side[0] + d0[1] * side[1]) < .5) return false;
      pts = [seed, ...half(seed, [d0[0] * s, d0[1] * s], minor, L, id)];
    } else {
      const fwd = half(seed, d0, minor, L, id), back = half(seed, [-d0[0], -d0[1]], minor, L, id);
      pts = [...back.reverse(), seed, ...fwd];
    }
    if (lineLength(pts) < L.minLen) return false;
    accept(pts, minor, L);
    return true;
  };
  // Road classes by pattern: arterials, collectors, lanes.
  const core = (x: number, z: number) => Math.min(1, Math.hypot(x - input.center[0], z - input.center[1]) / R);
  const levels: Level[] = [
    { kind: 'main', width: st.mainRoadWidth, dsep: bs * (pattern === 'planned' ? 2.2 : 2.6), dtest: bs * .7, maxLen: R * 3, minLen: Math.min(120, R * .5), tries: 30 },
    { kind: 'secondary', width: st.secondaryRoadWidth, dsep: bs * (pattern === 'planned' ? .66 : pattern === 'mixed' ? .85 : 1.05), dtest: bs * (pattern === 'planned' ? .3 : .38), maxLen: R * (pattern === 'vietnamese' ? 1.1 : 2), minLen: 30, tries: 400 },
  ];
  if (pattern !== 'planned') levels.push({
    kind: 'alley', width: st.alleyWidth, dsep: Math.max(st.lotWidth * 1.6, 26), dtest: 9, maxLen: st.lotDepth * (2.2 + rng.next()), minLen: 14, tries: 900, deadEnds: true,
    // Lanes (hẻm, ngõ) everywhere in a Vietnamese town; only off the planned core in a mixed one.
    keep: pattern === 'mixed' ? (x, z) => smoothstep(.35, .7, core(x, z)) : () => 1,
  });
  for (const L of levels) {
    let made = 0;
    if (L.kind === 'main') {
      for (const e of input.entries) for (const minor of [false, true]) if (trace(e, minor, L)) made++;
      if (trace(input.center, false, L)) made++;
      if (trace(input.center, true, L)) made++;
    }
    for (let t = 0; t < L.tries; t++) {
      let seed: Vec2, side: Vec2 | undefined;
      if (roads.length && (L.kind === 'main' ? rng.next() < .5 : rng.next() < .9)) {
        // Off an existing street (a junction), at a random point along it — the network grows outwards.
        const r = roads[Math.floor(rng.next() * roads.length)]!;
        if (L.deadEnds && r.kind === 'alley') continue;
        const k = Math.floor(rng.next() * (r.points.length - 1)), a = r.points[k]!, b = r.points[k + 1]!, u = rng.next();
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, sgn = rng.next() < .5 ? -1 : 1;
        side = [-(b[1] - a[1]) / l * sgn, (b[0] - a[0]) / l * sgn];
        const off = L.deadEnds ? r.width / 2 : 0;
        seed = [a[0] + (b[0] - a[0]) * u + side[0] * off, a[1] + (b[1] - a[1]) * u + side[1] * off];
      } else {
        const ang = rng.next() * Math.PI * 2, rad = Math.sqrt(rng.next()) * R;
        seed = [input.center[0] + Math.cos(ang) * rad, input.center[1] + Math.sin(ang) * rad];
      }
      if (L.keep && rng.next() > L.keep(seed[0], seed[1]) * (.55 + st.density * .45)) continue;
      const minor = L.deadEnds && side ? Math.abs(field.dir(seed[0], seed[1], false)[0] * side[0] + field.dir(seed[0], seed[1], false)[1] * side[1]) < .7 : rng.next() < .5;
      if (trace(seed, minor, L, side)) made++;
    }
    if (L.kind === 'main' && !made) break;
  }
  return roads;
}

/* ----------------------------------------------------------------------------- parcels */

export interface ParcelInput {
  roads: Road[]; polygon: Vec2[]; ground: UrbanGround; pattern: UrbanPattern; seed: string; center: Vec2; radius: number;
  settings: Pick<SettlementSettings, 'lotWidth' | 'lotDepth' | 'maxSlope' | 'randomness'>;
  /** Distance from a point to the nearest road edge (Infinity beyond `range`). */
  roadEdge(x: number, z: number, range: number): number;
  /** Does a box reach a road surface? */
  roadHits(b: Obb, clearance: number): boolean;
}

/**
 * Street-front parcels: each side of each street (arterials first, so corners go to them) cut
 * into lots as deep as the block allows — half way to the street behind, or to the region edge.
 * Vietnamese frontages are narrow and deep (nhà ống, 4–8 m wide); planned ones regular.
 */
export function frontageParcels(input: ParcelInput): { lots: UrbanLot[]; blocks: Array<{ id: string; polygon: Vec2[] }> } {
  const { polygon, ground, pattern, settings: st } = input;
  const rng = stream(input.seed, 'urban-lots');
  const R = Math.max(80, input.radius);
  const lots: UrbanLot[] = [], blocks: Array<{ id: string; polygon: Vec2[] }> = [];
  const grid = new SpatialGrid<Obb & { id: string }>(32, obbRadius);
  const rank: Record<RoadKind, number> = { main: 0, secondary: 1, alley: 2, connector: 3 };
  const order = input.roads.filter((r) => r.kind !== 'connector').sort((a, b) => rank[a.kind] - rank[b.kind] || lineLength(b.points) - lineLength(a.points));
  const planned = (x: number, z: number) => pattern === 'planned' ? 1 : pattern === 'vietnamese' ? 0 : 1 - smoothstep(.3, .6, Math.hypot(x - input.center[0], z - input.center[1]) / R);
  for (const road of order) {
    // Arc-length samples every metre with the unit tangent.
    const S: Array<{ x: number; z: number; dx: number; dz: number }> = [];
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!, b = road.points[i]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 1e-6) continue;
      for (let t = 0; t < l; t += 1) S.push({ x: a[0] + (b[0] - a[0]) * t / l, z: a[1] + (b[1] - a[1]) * t / l, dx: (b[0] - a[0]) / l, dz: (b[1] - a[1]) / l });
    }
    if (S.length < 8) continue;
    for (const side of [-1, 1]) {
      let run: UrbanLot[] = [];
      const flush = () => {
        if (run.length) {
          const id = `b${blocks.length}`;
          blocks.push({ id, polygon: convexHull(run.flatMap((l) => l.polygon)) });
          for (const l of run) { l.block = id; l.id = `${id}-${l.id}`; }
          lots.push(...run);
        }
        run = [];
      };
      // Keep clear of the junction at each end of the street.
      let s = Math.round(road.width + 2);
      while (s < S.length - 4) {
        const m = S[Math.min(S.length - 1, s)]!;
        const pl = planned(m.x, m.z);
        // Lot width: tube-house frontages in the irregular town, regular plots where planned; now and then a wide plot.
        const wide = rng.next() < (road.kind === 'alley' ? .02 : .07);
        // (A wide plot is never a narrow tube-house frontage.)
        const tube = road.kind !== 'alley' && rng.next() > pl && !wide;
        const w = wide ? 22 + rng.next() * 14 : tube ? 4.5 + rng.next() * (3 + st.randomness * 2) : road.kind === 'alley' && pl < .5 ? 7 + rng.next() * 6 : st.lotWidth * (.8 + rng.next() * (.25 + st.randomness * .3));
        const s0 = s, s1 = Math.min(S.length - 1, s + Math.round(w));
        const gap = tube ? 0 : pl > .5 ? 1 : .5;
        s = s1 + Math.round(gap);
        if (s1 - s0 < Math.min(4, w * .8)) { flush(); continue; }
        const A = S[s0]!, B = S[s1]!, mid = S[Math.round((s0 + s1) / 2)]!;
        const nx = -mid.dz * side, nz = mid.dx * side, off = road.width / 2 + (pl > .5 ? 2.2 : 1);
        // Depth: half way to the next street behind (or up to the edge, the water, the cliff).
        const maxDepth = tube ? 14 + rng.next() * 10 : road.kind === 'alley' ? st.lotDepth * .7 : st.lotDepth * (.85 + rng.next() * .3 * st.randomness);
        let free = maxDepth * 2 + 4, otherRoad = false;
        for (let t = 2; t <= maxDepth * 2 + 4; t += 2) {
          const qx = mid.x + nx * (off + t), qz = mid.z + nz * (off + t);
          if (!pointInPolygon(qx, qz, polygon) || ground.water(qx, qz) || ground.slope(qx, qz) > st.maxSlope * 2.2) { free = t; break; }
          const own = distanceToPolyline(qx, qz, road.points) - road.width / 2;
          if (input.roadEdge(qx, qz, 4) < 1 && own > 3) { free = t; otherRoad = true; break; }
        }
        const depth = Math.min(maxDepth, otherRoad ? free / 2 - .5 : free - 1);
        if (depth < (tube ? 9 : 8)) { flush(); continue; }
        const an = [-A.dz * side, A.dx * side], bn = [-B.dz * side, B.dx * side];
        const f0: Vec2 = [A.x + an[0]! * off, A.z + an[1]! * off], f1: Vec2 = [B.x + bn[0]! * off, B.z + bn[1]! * off];
        const k0: Vec2 = [f0[0] + an[0]! * depth, f0[1] + an[1]! * depth], k1: Vec2 = [f1[0] + bn[0]! * depth, f1[1] + bn[1]! * depth];
        const width = Math.hypot(f1[0] - f0[0], f1[1] - f0[1]);
        const cx = (f0[0] + f1[0] + k0[0] + k1[0]) / 4, cz = (f0[1] + f1[1] + k0[1] + k1[1]) / 4;
        const obb: Obb = { x: cx, z: cz, hx: width / 2, hz: depth / 2, yaw: Math.atan2(nx, nz) };
        const inner: Obb = { ...obb, hx: obb.hx - .4, hz: obb.hz - .4 };
        const poly = [f0, f1, k1, k0];
        if (poly.some(([x, z]) => !pointInPolygon(x, z, polygon)) || ground.water(cx, cz) || input.roadHits(inner, .2) ||
          grid.query(cx, cz, obbRadius(obb)).some((o) => obbOverlap(o, inner))) { flush(); continue; }
        const lot: UrbanLot = { id: `l${run.length}`, block: '', polygon: side > 0 ? poly : [f1, f0, k0, k1], front: side > 0 ? [f1, f0] : [f0, f1], dir: [-nx, -nz], obb, cls: 'empty', road: road.kind, ...(wide ? { wide: true } : {}), ...(tube ? { use: 'tube' as const } : {}) };
        grid.insert({ ...obb, id: lot.id });
        run.push(lot);
      }
      flush();
    }
  }
  return { lots, blocks };
}

/* --------------------------------------------------------------------------- districts */

export interface DistrictInput {
  lots: UrbanLot[]; roads: Road[]; polygon: Vec2[]; ground: UrbanGround; pattern: UrbanPattern; seed: string; center: Vec2; radius: number; area: number;
  settings: Pick<SettlementSettings, 'zoning' | 'density' | 'concentration' | 'decay' | 'preset'>;
  externalRoads: Array<{ points: Vec2[] }>;
}

/**
 * Districts as a weighted Voronoi of seeds placed by planning rules; lots take their district's
 * class, shop-houses line the main streets, public services take the wide plots, and the rest
 * are built according to density (denser towards the centre).
 */
export function planDistricts(input: DistrictInput): District[] {
  const { lots, pattern, settings: st } = input;
  const rng = stream(input.seed, 'urban-districts'), wobble = new Simplex2(seedNumber(input.seed, 'urban-district-edges'));
  const R = Math.max(80, input.radius), [cx, cz] = input.center;
  const k = Math.max(3, Math.min(16, Math.round(input.area / (170 * 170))));
  // Seeds: best-candidate sampling over the lots (spread out, on built land).
  const seeds: Vec2[] = [];
  if (lots.length) {
    const near = lots.reduce((best, l) => (Math.hypot(l.obb.x - cx, l.obb.z - cz) < Math.hypot(best.obb.x - cx, best.obb.z - cz) ? l : best), lots[0]!);
    seeds.push([near.obb.x, near.obb.z]);
    while (seeds.length < Math.min(k, lots.length)) {
      let best: Vec2 | null = null, bd = -1;
      for (let t = 0; t < 12; t++) {
        const l = lots[Math.floor(rng.next() * lots.length)]!, d = Math.min(...seeds.map((s) => Math.hypot(s[0] - l.obb.x, s[1] - l.obb.z)));
        if (d > bd) { bd = d; best = [l.obb.x, l.obb.z]; }
      }
      seeds.push(best!);
    }
  }
  // Rules: the core is commercial, industry goes to the edge by the way out or the water, the military takes its share, the rest is housing.
  const outlet = (x: number, z: number) => Math.min(...input.externalRoads.map((r) => distanceToPolyline(x, z, r.points)), Infinity);
  const wetNear = (x: number, z: number) => [[40, 0], [-40, 0], [0, 40], [0, -40]].some(([a, b]) => input.ground.water(x + a!, z + b!));
  const total = st.zoning.residential + st.zoning.commercial + st.zoning.industrial + st.zoning.military || 1;
  const want = { commercial: Math.round(seeds.length * st.zoning.commercial / total), industrial: Math.round(seeds.length * st.zoning.industrial / total), military: Math.round(seeds.length * st.zoning.military / total) };
  if (st.zoning.commercial > 0) want.commercial = Math.max(1, want.commercial);
  const cls: Array<LotClass | 'green'> = seeds.map(() => 'residential');
  const free = () => seeds.map((_, i) => i).filter((i) => cls[i] === 'residential');
  const take = (n: number, score: (s: Vec2) => number, c: LotClass) => {
    for (const i of free().sort((a, b) => score(seeds[b]!) - score(seeds[a]!)).slice(0, n)) cls[i] = c;
  };
  const rc = (s: Vec2) => Math.hypot(s[0] - cx, s[1] - cz) / R;
  take(want.military, (s) => rc(s) + rng.next() * .2, 'military');
  take(want.industrial, (s) => rc(s) + (outlet(s[0], s[1]) < 120 ? .5 : 0) + (wetNear(s[0], s[1]) ? .4 : 0) - input.ground.slope(s[0], s[1]) * 3 + rng.next() * .2, 'industrial');
  take(want.commercial, (s) => -rc(s) + rng.next() * .15, 'commercial');
  // A park in planned towns: a housing district near the centre turned green.
  if (pattern !== 'vietnamese' && seeds.length >= 5) { const i = free().sort((a, b) => rc(seeds[a]!) - rc(seeds[b]!))[1]; if (i !== undefined && rng.next() < .7) cls[i] = 'green'; }
  const districts: District[] = seeds.map((s, i) => ({ id: `d${i}`, cls: cls[i]!, x: s[0], z: s[1] }));
  // Lots: the nearest seed by a wobbled distance (district borders are not straight lines).
  for (const l of lots) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < seeds.length; i++) {
      const d = Math.hypot(seeds[i]![0] - l.obb.x, seeds[i]![1] - l.obb.z) * (1 + wobble.noise(l.obb.x / 90 + i * 7.1, l.obb.z / 90) * .25);
      if (d < bd) { bd = d; best = i; }
    }
    const d = districts[best]!;
    l.district = d.id;
    const c = d.cls;
    const lc = Math.hypot(l.obb.x - cx, l.obb.z - cz) / R;
    const p = Math.max(.08, st.density * (1 - st.concentration * .8 * lc * lc));
    const roll = rng.next();
    if (c === 'green') { l.cls = 'green'; l.use = 'park'; continue; }
    // Shop-houses: ground-floor shops along the main streets of housing districts.
    const shop = c === 'residential' && (l.road === 'main' || (l.road === 'secondary' && pattern === 'vietnamese')) && rng.next() < (pattern === 'planned' ? .3 : .7);
    l.cls = roll < p ? (shop ? 'commercial' : c) : roll < p + (1 - st.density) * .2 && c !== 'industrial' ? 'green' : 'empty';
    if (shop && l.cls === 'commercial') l.use = 'shophouse';
  }
  // Public buildings (schools, a clinic, a market, a hospital, a stadium…) on wide plots, spaced apart.
  assignFacilities(lots, settlementFacilities(kindOfArea(st.preset), input.area), cx, cz, R, rng, (l) => l.wide === true, (l) => l.road === 'main' || l.road === 'secondary');
  return districts;
}

/** The block's class: the commonest class of its built lots. */
export function blockClass(lots: UrbanLot[]): LotClass | 'green' {
  const count = new Map<string, number>();
  for (const l of lots) if (l.cls !== 'empty') count.set(l.cls, (count.get(l.cls) ?? 0) + 1);
  return ([...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as LotClass | 'green' | undefined) ?? 'green';
}

/* --------------------------------------------------------------------- state of decay */

/**
 * How far each place has gone: a smooth field (whole streets abandoned together, not one house
 * in ten), raised by the settlement's decay. Abandoned: complete but long unused; ruined: shells.
 */
export function conditionField(seed: string, decay: number): (x: number, z: number) => { value: number; condition: BuildingCondition } {
  const n = new Simplex2(seedNumber(seed, 'urban-decay')), fine = new Simplex2(seedNumber(seed, 'urban-decay-fine'));
  return (x, z) => {
    const value = decay * .85 + n.noise(x / 240, z / 240) * .3 + fine.noise(x / 40, z / 40) * .1 - .05;
    return { value, condition: value > .82 ? 'ruined' : value > .5 ? 'abandoned' : 'intact' };
  };
}

/* ------------------------------------------------------------------- building options */

/** Kit buildings for public services and tube houses (nhà ống: narrow, deep, several storeys). */
export function urbanBuildingOptions(use: LotUse | undefined, rng: Rng, availW: number, availD: number): CompositeOption[] {
  const out: CompositeOption[] = [];
  const seed = rng.nextU32();
  const add = (kind: CompositeRecipe['kind'], w: number, d: number, floors: number, finish?: CompositeRecipe['finish']) => {
    if (w <= availW && d <= availD) out.push({ recipe: { kind, w, d, floors, ...(finish ? { finish } : {}), seed }, w, d, height: floors * 3.2 + 1 });
  };
  switch (use) {
    case 'school': for (const w of [30, 24, 18]) add('concrete', w, 12, 2 + Math.floor(rng.next() * 2), 'ivory'); break;
    case 'clinic': add('concrete', 18, 12, 2 + Math.floor(rng.next() * 2), 'ivory'); add('concrete', 12, 12, 2, 'ivory'); break;
    case 'office': for (const w of [24, 18]) add('concrete', w, 12, 4 + Math.floor(rng.next() * 4), 'gray'); break;
    case 'market': for (const w of [30, 24, 18]) add('concrete', w, 12, 1, rng.next() < .5 ? 'gray' : 'ivory'); break;
    case 'temple': add('brick', 12, 10, 1); add('brick', 10, 8, 1); break;
    case 'hospital': case 'hotel': case 'university': for (const w of [30, 24]) add('concrete', w, 14, 4 + Math.floor(rng.next() * 3), 'ivory'); break;
    case 'tube': case 'shophouse': {
      // Brick widths are multiples of 2 m; depth fills the plot behind a small yard.
      for (const w of [8, 6, 4]) {
        const d = Math.min(18, Math.floor((availD - 1) / 2) * 2);
        if (d >= 8) add('brick', w, d, 2 + Math.floor(rng.next() * (use === 'shophouse' ? 4 : 3)));
      }
      break;
    }
    default: if (isFacility(use)) { add('concrete', 18, 12, 2, 'ivory'); add('concrete', 12, 10, 2, 'gray'); } break;
  }
  return out;
}

export const isPublicUse = (use?: LotUse) => use === 'office' || isFacility(use);

type FacilityLot = { obb: Obb; cls: LotClass | 'green' | 'empty'; use?: LotUse; road?: RoadKind };
/**
 * Sets plots aside for a settlement's public buildings: each on the free plot that suits it
 * best — big enough for it (a stadium needs a field), the core for the town hall, the market on
 * a through street, the big grounds (stadium, university, hospital) further out where the plots
 * are larger — and the same buildings spaced apart (two schools serve two quarters).
 */
export function assignFacilities<L extends FacilityLot>(lots: L[], plan: readonly BuildingType[], cx: number, cz: number, R: number, rng: Rng, preferred: (l: L) => boolean = () => false, onStreet: (l: L) => boolean = () => true): void {
  const placed: Array<{ use: LotUse; x: number; z: number }> = [];
  // The biggest first: they need the rare large plots.
  const order = [...plan].sort((a, b) => (BUILDING_TYPE_INFO[b].plot ?? 0) - (BUILDING_TYPE_INFO[a].plot ?? 0));
  for (const use of order) {
    const info = BUILDING_TYPE_INFO[use], need = info.plot ?? 300, big = need >= 1500;
    const spacing = use === 'school' || use === 'kindergarten' ? 240 : 120;
    let best: L | undefined, bs = Infinity;
    for (const l of lots) {
      if (l.use && l.use !== 'tube' && l.use !== 'shophouse') continue;
      if (l.cls === 'military' || (l.cls === 'industrial' && !info.lots.includes('industrial'))) continue;
      const a = l.obb.hx * l.obb.hz * 4;
      if (a < Math.min(250, need) || !placed.every((p) => Math.hypot(p.x - l.obb.x, p.z - l.obb.z) > (p.use === use ? spacing : 30))) continue;
      const rc = Math.hypot(l.obb.x - cx, l.obb.z - cz) / R;
      if (rc > 1.05) continue;
      // Civic buildings near the core, big grounds where there is room; wide plots and through streets first.
      const score = (big ? Math.abs(rc - .6) - Math.min(1, a / (need * 3)) * .4 : use === 'town-hall' || use === 'market' || use === 'post-office' || use === 'bank' ? rc : rc * .6)
        // A plot smaller than it wants only when no plot is big enough (the generator then fits a smaller model).
        + (a < need * .8 ? 2 - a / need : 0)
        - (preferred(l) ? .3 : 0) - (use === 'market' || use === 'gas-station' ? (onStreet(l) ? .3 : 0) : 0) + rng.next() * .15;
      if (score < bs) { bs = score; best = l; }
    }
    if (!best) continue;
    best.use = use;
    best.cls = info.lots[0]!;
    placed.push({ use, x: best.obb.x, z: best.obb.z });
  }
}
