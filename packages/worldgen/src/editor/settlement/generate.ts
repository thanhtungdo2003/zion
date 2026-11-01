import { smoothstep, type Rng } from '@zion/shared';
import { Simplex2 } from '../../noise';
import {
  SpatialGrid, clipLineToPolygon, clipToConvex, convexHull, densify, distanceToPolyline, isSimplePolygon, obbCorners, obbInsidePolygon, obbOverlap,
  obbRadius, pointInPolygon, polygonArea, polygonCentroid, principalAngle, segmentIntersection, type Obb, type Vec2,
} from '../geometry';
import { levelRegion } from '../brushes';
import { seedNumber, stream, type CellRect, type Heightfield } from '../heightfield';
import { riverLevels, waterLevelAt, type WaterData } from '../water';
import type { Catalog, CatalogItem, PropKind } from './catalog';
import type { LotClass, SettlementSettings } from './presets';
import { compositeOptions, type CompositeRecipe } from './composite';
import { blockClass, conditionField, frontageParcels, isPublicUse, planDistricts, traceStreets, urbanBuildingOptions, urbanField, type BuildingCondition, type District, type LotUse } from './urban';

export type RoadKind = 'main' | 'secondary' | 'alley' | 'connector';
export interface SettlementRoad { id: string; kind: RoadKind; width: number; points: Vec2[] }
export interface Block { id: string; polygon: Vec2[]; cls: LotClass | 'green' }
export type ParcelKind = 'rect' | 'skew' | 'L' | 'U' | 'wide';
/** How a parcel is used and dressed: each one has its own character. */
export type LotStyle = 'yard' | 'full' | 'garden' | 'orchard' | 'farm' | 'walled' | 'overgrown' | 'vacant' | 'work';
export type FenceKind = 'none' | 'wood' | 'iron' | 'wall' | 'hedge' | 'wire';
export interface Lot { id: string; block: string; polygon: Vec2[]; front: [Vec2, Vec2]; dir: Vec2; obb: Obb; cls: LotClass | 'green' | 'empty'; shape?: ParcelKind; style?: LotStyle; fence?: FenceKind; flora?: number; /** Urban layout: what the plot is for, and its district. */ use?: LotUse; district?: string }

interface ParcelShape { kind: ParcelKind; a: number; b: number; depth: number; outline: Vec2[] }
/**
 * Cuts a run of street-front plots into a jigsaw: side boundaries lean (trapezoids, rhomboids),
 * some plots take their neighbour's back half (L), wrap round a small front plot (U) or join
 * into one wide plot. Neighbours share every cut exactly, so the pieces tile the block.
 * Coordinates: along the street, and depth t from the front.
 */
function parcelRun(run: Array<{ a: number; b: number }>, D: number, rng: Rng, randomness: number): ParcelShape[] {
  const cuts = [run[0]!.a, ...run.map((r) => r.b)], n = run.length;
  const skew = cuts.map((_, k) => {
    if (k === 0 || k === n) return 0;
    const room = Math.min(cuts[k]! - cuts[k - 1]!, cuts[k + 1]! - cuts[k]!) * .38;
    return (rng.next() * 2 - 1) * room * (.3 + randomness);
  });
  const at = (k: number, t: number): Vec2 => [cuts[k]! + skew[k]! * t / D, t];
  const out: ParcelShape[] = [];
  for (let i = 0; i < n;) {
    const roll = rng.next(), m = D * (.4 + rng.next() * .25);
    if (roll < .1 && i + 2 < n) {
      // U: wraps round a small shop / kiosk plot on the street.
      out.push({ kind: 'U', a: cuts[i]!, b: cuts[i + 3]!, depth: D, outline: [at(i, 0), at(i + 1, 0), at(i + 1, m), at(i + 2, m), at(i + 2, 0), at(i + 3, 0), at(i + 3, D), at(i, D)] });
      out.push({ kind: 'rect', a: cuts[i + 1]!, b: cuts[i + 2]!, depth: m, outline: [at(i + 1, 0), at(i + 2, 0), at(i + 2, m), at(i + 1, m)] });
      i += 3;
    } else if (roll < .3 && i + 1 < n) {
      // L: this plot takes the back of the next one.
      out.push({ kind: 'L', a: cuts[i]!, b: cuts[i + 1]!, depth: D, outline: [at(i, 0), at(i + 1, 0), at(i + 1, m), at(i + 2, m), at(i + 2, D), at(i, D)] });
      out.push({ kind: 'rect', a: cuts[i + 1]!, b: cuts[i + 2]!, depth: m, outline: [at(i + 1, 0), at(i + 2, 0), at(i + 2, m), at(i + 1, m)] });
      i += 2;
    } else if (roll < .42 && i + 1 < n) {
      out.push({ kind: 'wide', a: cuts[i]!, b: cuts[i + 2]!, depth: D, outline: [at(i, 0), at(i + 2, 0), at(i + 2, D), at(i, D)] });
      i += 2;
    } else {
      out.push({ kind: skew[i] || skew[i + 1] ? 'skew' : 'rect', a: cuts[i]!, b: cuts[i + 1]!, depth: D, outline: [at(i, 0), at(i + 1, 0), at(i + 1, D), at(i, D)] });
      i++;
    }
  }
  return out;
}
export interface PlacedBuilding { id: string; asset: number; x: number; z: number; y: number; yaw: number; obb: Obb; door: Vec2; lot?: string; cls: LotClass; manual?: boolean; /** Kit building (brick / concrete / modular storeys) instead of one model. */ recipe?: CompositeRecipe; /** Abandoned: complete but long unused; ruined: a gutted shell among debris. */ condition?: BuildingCondition }
export interface PlacedProp { id: string; asset: number; kind: PropKind; x: number; z: number; y: number; yaw: number; scale: number; obb: Obb; manual?: boolean; /** Stretch along the model's x (fence pieces fitted to a side). */ sx?: number }
export interface SettlementIssue { severity: 'error' | 'warning' | 'info'; code: string; message: string; x?: number; z?: number }
export type SettlementLayer = 'roads' | 'buildings' | 'props';

export interface SettlementAnalysis { area: number; buildableShare: number; waterShare: number; steepShare: number; meanHeight: number; center: Vec2; angle: number; radius: number }
export interface SettlementResult {
  version: 1;
  seed: string;
  settings: SettlementSettings;
  analysis: SettlementAnalysis;
  roads: SettlementRoad[];
  blocks: Block[];
  lots: Lot[];
  buildings: PlacedBuilding[];
  props: PlacedProp[];
  issues: SettlementIssue[];
  stats: Record<string, number>;
  /** Urban layout: the districts (seed points; lots carry their district id). */
  districts?: District[];
  /** Cut and fill the region needs (applied to the map with the result; never stored in it). */
  grading?: { rect: CellRect; heights: Float32Array; surface: Uint8Array };
}

export interface SettlementInput {
  polygon: Vec2[];
  seed: string;
  settings: SettlementSettings;
  terrain: Heightfield;
  water: WaterData;
  seaLevel: number;
  /** Roads outside the region the main street should join. */
  externalRoads: Array<{ points: Vec2[]; width: number }>;
  /** Footprints that must stay clear: other regions' buildings, base structures. */
  obstacles: Obb[];
  catalog: Catalog;
  /** The current result: its hand-edited items are kept, and layers not regenerated are reused. */
  previous?: SettlementResult;
  /** Lowest layer to rebuild; everything above it is rebuilt too (default: roads, i.e. all). */
  from?: SettlementLayer;
}

export interface SettlementProgress { stage: number; label: string; progress: number }
export const SETTLEMENT_STAGES = [
  'Phân tích vùng và địa hình', 'Xác định trung tâm và phân khu', 'Sinh mạng lưới đường', 'Chia ô phố', 'Chia lô đất',
  'Phân loại khu vực', 'Bố trí công trình', 'Bố trí cây và vật thể phụ', 'Kiểm tra va chạm và kết nối', 'Hoàn tất bản xem trước',
] as const;

export class SettlementError extends Error {
  constructor(readonly issues: SettlementIssue[]) { super(issues.map((i) => i.message).join(' ')); this.name = 'SettlementError'; }
}

const MIN_AREA = 2500;

/** Checks a drawn region before anything is generated. */
export function validateRegion(polygon: readonly Vec2[], size: number): SettlementIssue[] {
  const out: SettlementIssue[] = [];
  if (polygon.length < 3) out.push({ severity: 'error', code: 'too-few-points', message: 'Vùng cần ít nhất 3 điểm.' });
  else {
    if (!isSimplePolygon(polygon)) out.push({ severity: 'error', code: 'self-intersect', message: 'Đường biên tự cắt nhau — hãy kéo lại các điểm.' });
    const area = Math.abs(polygonArea(polygon));
    if (area < MIN_AREA) out.push({ severity: 'error', code: 'too-small', message: `Diện tích ${Math.round(area)} m² nhỏ hơn tối thiểu ${MIN_AREA} m².` });
  }
  if (polygon.some(([x, z]) => x < 0 || z < 0 || x > size || z > size)) out.push({ severity: 'error', code: 'outside-map', message: 'Có điểm nằm ngoài bản đồ.' });
  return out;
}

/* ------------------------------------------------------------------------------ helpers */

interface Frame { cx: number; cz: number; c: number; s: number; angle: number }
const toLocal = (f: Frame, x: number, z: number): Vec2 => [(x - f.cx) * f.c + (z - f.cz) * f.s, -(x - f.cx) * f.s + (z - f.cz) * f.c];
const toWorld = (f: Frame, u: number, v: number): Vec2 => [f.cx + u * f.c - v * f.s, f.cz + u * f.s + v * f.c];
const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng.next() * list.length)]!;
const length = (pts: readonly Vec2[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]) : 0), 0);

/** Points every `step` metres along a polyline, with the unit direction there. */
function walk(points: readonly Vec2[], step: number, offset = 0): Array<{ x: number; z: number; dx: number; dz: number; at: number }> {
  const out: Array<{ x: number; z: number; dx: number; dz: number; at: number }> = [];
  let carry = offset, total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
    let t = carry;
    for (; t <= len; t += step) out.push({ x: a[0] + dx * t, z: a[1] + dz * t, dx, dz, at: total + t });
    carry = t - len; total += len;
  }
  return out;
}

/** Item footprint as an oriented box for a model at (x, z) with yaw. */
export function footprint(item: CatalogItem, x: number, z: number, yaw: number, scale = 1): Obb {
  const c = Math.cos(yaw), s = Math.sin(yaw), ox = item.ox * scale, oz = item.oz * scale;
  return { x: x + ox * c + oz * s, z: z - ox * s + oz * c, hx: item.w * scale / 2, hz: item.d * scale / 2, yaw };
}

class Ground {
  private readonly waterData: WaterData;
  constructor(private readonly input: SettlementInput, private readonly terrain: Heightfield) {
    // River levels once, not per query.
    this.waterData = { lakes: input.water.lakes, rivers: input.water.rivers.map((r) => ({ ...r, levels: r.levels ?? riverLevels(input.terrain, r) })) };
  }
  water(x: number, z: number): boolean {
    const { seaLevel } = this.input;
    return this.terrain.heightAt(x, z) < seaLevel + .8 || waterLevelAt(this.terrain, this.waterData, seaLevel, x, z) !== null;
  }
  slope(x: number, z: number): number { return this.terrain.slopeAt(x, z); }
  height(x: number, z: number): number { return this.terrain.heightAt(x, z); }
  buildable(x: number, z: number, maxSlope: number): boolean { return !this.water(x, z) && this.slope(x, z) <= maxSlope * 1.6; }
}

/** Road centre-line samples (every 2 m) in a spatial grid: clearance tests for boxes. */
class RoadIndex {
  readonly grid = new SpatialGrid<{ x: number; z: number; hw: number; dx: number; dz: number }>(16, (p) => p.hw);
  add(road: { points: readonly Vec2[]; width: number }): void {
    for (const p of walk(road.points, 2)) this.grid.insert({ x: p.x, z: p.z, hw: road.width / 2, dx: p.dx, dz: p.dz });
    const last = road.points[road.points.length - 1]!;
    this.grid.insert({ x: last[0], z: last[1], hw: road.width / 2, dx: 0, dz: 0 });
  }
  /** True when the box (plus `clearance`) reaches a road surface. */
  hits(b: Obb, clearance: number): boolean {
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    for (const p of this.grid.query(b.x, b.z, obbRadius(b) + clearance)) {
      const dx = p.x - b.x, dz = p.z - b.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < b.hx + p.hw + clearance && Math.abs(lz) < b.hz + p.hw + clearance) return true;
    }
    return false;
  }
  /** Distance from a point to the nearest road edge (Infinity when none is within `range`). */
  edgeDistance(x: number, z: number, range: number): number {
    let best = Infinity;
    for (const p of this.grid.query(x, z, range)) best = Math.min(best, Math.hypot(p.x - x, p.z - z) - p.hw);
    return best;
  }
}

type Solid = Obb & { tag: string };
const solidGrid = () => new SpatialGrid<Solid>(24, obbRadius);
const blocked = (grid: SpatialGrid<Solid>, b: Obb, margin: number, ignore?: (s: Solid) => boolean) =>
  grid.query(b.x, b.z, obbRadius(b) + margin).some((o) => !ignore?.(o) && obbOverlap(o, b, margin));

/* ----------------------------------------------------------------------------- pipeline */

/**
 * Procedural settlement in ten stages (see SETTLEMENT_STAGES). A generator: it yields progress
 * between steps so a worker can report it and stop early, and returns the reviewable result.
 */
export function* generateSettlement(input: SettlementInput): Generator<SettlementProgress, SettlementResult> {
  const t0 = Date.now();
  const { polygon, settings: st, seed, catalog } = input;
  const prev = input.previous;
  const from: SettlementLayer = prev ? input.from ?? 'roads' : 'roads';
  const keepRoads = from !== 'roads', keepBuildings = from === 'props';
  // How far each place has decayed: smooth over the town, so whole streets go together.
  const decayAt = conditionField(seed, st.decay);
  let districts: District[] | undefined = keepRoads ? prev?.districts : undefined;
  // Cut and fill on a copy: the map changes only when the result is applied.
  let terrain = input.terrain, grading: SettlementResult['grading'];
  if (!keepRoads && st.grading > 0 && validateRegion(polygon, terrain.size).every((i) => i.severity !== 'error')) {
    terrain = input.terrain.clone();
    const rect = levelRegion(terrain, polygon, 40, st.grading);
    if (rect) grading = terrain.snapshot(rect);
  } else if (keepRoads && prev?.grading) {
    // Rebuilding on top of a preview that was never applied: keep its cut and fill.
    terrain = input.terrain.clone(); terrain.restore(prev.grading); grading = prev.grading;
  }
  const ground = new Ground(input, terrain);
  const issues: SettlementIssue[] = [];
  const progress = (stage: number, p = 0): SettlementProgress => ({ stage, label: SETTLEMENT_STAGES[stage - 1]!, progress: p });

  /* 1. Analyse the polygon, the ground and the no-build areas. */
  yield progress(1);
  const pre = validateRegion(polygon, terrain.size);
  if (pre.some((i) => i.severity === 'error')) throw new SettlementError(pre);
  const area = Math.abs(polygonArea(polygon));
  const xs = polygon.map((p) => p[0]), zs = polygon.map((p) => p[1]);
  const step = Math.max(4, Math.min(16, Math.sqrt(area) / 60));
  let inside = 0, buildable = 0, wet = 0, steep = 0, sumH = 0, wx = 0, wz = 0;
  const obstacleGrid = solidGrid();
  for (const o of input.obstacles) obstacleGrid.insert({ ...o, tag: 'obstacle' });
  const samples: Vec2[] = [];
  for (let z = Math.min(...zs); z <= Math.max(...zs); z += step) for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) {
    if (!pointInPolygon(x, z, polygon)) continue;
    inside++;
    const isWet = ground.water(x, z), isSteep = ground.slope(x, z) > st.maxSlope * 1.6;
    const isBlocked = blocked(obstacleGrid, { x, z, hx: .5, hz: .5, yaw: 0 }, 0);
    if (isWet) wet++; else if (isSteep) steep++;
    sumH += ground.height(x, z);
    if (!isWet && !isSteep && !isBlocked) { buildable++; wx += x; wz += z; samples.push([x, z]); }
  }
  if (!inside || buildable / inside < .08) throw new SettlementError([{ severity: 'error', code: 'unbuildable', message: `Chỉ ${Math.round(buildable / Math.max(1, inside) * 100)}% diện tích xây được (nước, dốc hoặc công trình có sẵn).` }]);
  if (wet / inside > .3) issues.push({ severity: 'warning', code: 'wet', message: `${Math.round(wet / inside * 100)}% vùng là mặt nước — sẽ được bỏ qua.` });
  if (steep / inside > .3) issues.push({ severity: 'warning', code: 'steep', message: `${Math.round(steep / inside * 100)}% vùng quá dốc để xây.` });

  /* 2. Centre, orientation and planning zones. */
  yield progress(2);
  let analysis: SettlementAnalysis;
  if (keepRoads && prev) analysis = prev.analysis;
  else {
    let center: Vec2 = [wx / buildable, wz / buildable];
    if (!pointInPolygon(center[0], center[1], polygon) || !ground.buildable(center[0], center[1], st.maxSlope)) {
      center = samples.reduce((best, p) => (Math.hypot(p[0] - center[0], p[1] - center[1]) < Math.hypot(best[0] - center[0], best[1] - center[1]) ? p : best), samples[0]!);
    }
    const rng = stream(seed, 'plan');
    const angle = principalAngle(densify(polygon, 10)) + (rng.next() - .5) * .25 * st.randomness;
    const radius = Math.max(...polygon.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1])));
    analysis = { area, buildableShare: buildable / inside, waterShare: wet / inside, steepShare: steep / inside, meanHeight: sumH / inside, center, angle, radius };
  }
  const frame: Frame = { cx: analysis.center[0], cz: analysis.center[1], c: Math.cos(analysis.angle), s: Math.sin(analysis.angle), angle: analysis.angle };
  const local = polygon.map(([x, z]) => toLocal(frame, x, z));
  const umin = Math.min(...local.map((p) => p[0])), umax = Math.max(...local.map((p) => p[0]));
  const vmin = Math.min(...local.map((p) => p[1])), vmax = Math.max(...local.map((p) => p[1]));

  /* 3. Road network: main streets, secondary streets, then (in 4) alleys. */
  yield progress(3);
  let roads: SettlementRoad[], blocks: Block[], lots: Lot[];
  const uLines: Array<{ at: number; width: number }> = [], vLines: Array<{ at: number; width: number }> = [];
  if (keepRoads && prev) { roads = prev.roads; blocks = prev.blocks; lots = prev.lots; }
  else {
    const rng = stream(seed, 'roads'), bend = new Simplex2(seedNumber(seed, 'roads-bend'));
    const pieces: SettlementRoad[] = [];
    let n = 0;
    const roadOk = (a: Vec2, b: Vec2) => {
      const dz = ground.height(b[0], b[1]) - ground.height(a[0], a[1]), run = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return !ground.water(b[0], b[1]) && Math.abs(dz) / run <= .22 && ground.slope(b[0], b[1]) <= .6;
    };
    /** A local-frame polyline clipped to the region and cut where the ground is impassable. */
    const addLine = (kind: RoadKind, width: number, line: Vec2[], minLength: number) => {
      const world = line.map(([u, v]) => toWorld(frame, u, v));
      const cut: Vec2[][] = [];
      for (let i = 1; i < world.length; i++) for (const [a, b] of clipLineToPolygon(world[i - 1]!, world[i]!, polygon)) {
        const last = cut[cut.length - 1];
        if (last && Math.hypot(last[last.length - 1]![0] - a[0], last[last.length - 1]![1] - a[1]) < .01) last.push(b); else cut.push([a, b]);
      }
      for (const piece of cut) {
        let run: Vec2[] = [];
        const flush = () => { if (run.length > 1 && length(run) >= minLength) pieces.push({ id: `r${n++}`, kind, width, points: run }); run = []; };
        const pts = walk(piece, 5).map((p): Vec2 => [p.x, p.z]);
        pts.push(piece[piece.length - 1]!);
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i]!;
          if (i && !roadOk(pts[i - 1]!, p)) { flush(); continue; }
          if (!i && ground.water(p[0], p[1])) continue;
          run.push(p);
        }
        flush();
      }
    };
    const extentU = umax - umin, extentV = vmax - vmin, bs = st.blockSize;
    const jitter = () => (rng.next() - .5) * .3 * bs * st.randomness;
    if (st.layout === 'urban') {
      // Streets traced through a tensor field (planning pattern, edges, incoming roads, terrain).
      const pattern = st.pattern ?? 'mixed';
      const field = urbanField({ polygon, center: analysis.center, angle: analysis.angle, radius: analysis.radius, pattern, seed, ground, externalRoads: input.externalRoads, randomness: st.randomness });
      // The arterials start where the outside roads come closest.
      const entries: Vec2[] = [];
      for (const ext of input.externalRoads) {
        let best: { p: Vec2; d: number } | null = null;
        for (const s of walk(ext.points, 8)) {
          if (!pointInPolygon(s.x, s.z, polygon)) { const d = Math.hypot(s.x - analysis.center[0], s.z - analysis.center[1]); if (!best || d < best.d) best = { p: [s.x, s.z], d }; continue; }
          best = { p: [s.x, s.z], d: 0 }; break;
        }
        if (best) {
          // Just inside the edge, towards the centre.
          const [x, z] = best.p, dx = analysis.center[0] - x, dz = analysis.center[1] - z, l = Math.hypot(dx, dz) || 1;
          for (let t = 0; t < l; t += 6) if (pointInPolygon(x + dx / l * t, z + dz / l * t, polygon)) { entries.push([x + dx / l * (t + 4), z + dz / l * (t + 4)]); break; }
        }
      }
      for (const r of traceStreets({ field, polygon, ground, center: analysis.center, radius: analysis.radius, pattern, seed, passable: roadOk, settings: st, entries: entries.slice(0, 4) })) {
        if (r.points.length > 1) pieces.push({ ...r, id: `r${n++}` });
      }
    } else {
    // Main street along the long axis (winding in organic layouts); a cross avenue in larger grids.
    const amp = st.layout === 'organic' ? bs * (.15 + .25 * st.randomness) : 0;
    const mainLine: Vec2[] = [];
    for (let u = umin - 10; u <= umax + 10; u += 10) mainLine.push([u, amp ? bend.noise(u / (bs * 2.2), 3.7) * amp : 0]);
    addLine('main', st.mainRoadWidth, mainLine, 40);
    vLines.push({ at: 0, width: st.mainRoadWidth });
    if (st.layout === 'grid' && extentV > bs * 1.5 && extentU > bs * 1.5) { addLine('main', st.mainRoadWidth, [[0, vmin - 10], [0, vmax + 10]], 40); uLines.push({ at: 0, width: st.mainRoadWidth }); }
    if (st.layout === 'grid') {
      for (let k = 1; k * bs < Math.max(-umin, umax); k++) for (const sgn of [-1, 1]) {
        const at = sgn * k * bs + jitter();
        if (at <= umin + 20 || at >= umax - 20) continue;
        addLine('secondary', st.secondaryRoadWidth, [[at, vmin - 10], [at, vmax + 10]], 25); uLines.push({ at, width: st.secondaryRoadWidth });
      }
      for (let k = 1; k * bs < Math.max(-vmin, vmax); k++) for (const sgn of [-1, 1]) {
        const at = sgn * k * bs + jitter();
        if (at <= vmin + 20 || at >= vmax - 20) continue;
        addLine('secondary', st.secondaryRoadWidth, [[umin - 10, at], [umax + 10, at]], 25); vLines.push({ at, width: st.secondaryRoadWidth });
      }
    } else {
      // Lanes branching off the main street, each to one or both sides.
      for (let k = 1; k * bs * .8 < Math.max(-umin, umax); k++) for (const sgn of [-1, 1]) {
        const at = sgn * k * bs * .8 + jitter();
        if (at <= umin + 20 || at >= umax - 20 || rng.next() > .55 + st.density * .4) continue;
        const reach = st.lotDepth * 2.4 + rng.next() * bs * .5, base = amp ? bend.noise(at / (bs * 2.2), 3.7) * amp : 0, side = rng.next();
        addLine('secondary', st.secondaryRoadWidth, [[at, side < .35 ? base : base - reach], [at, side > .65 ? base : base + reach]], 25);
        uLines.push({ at, width: st.secondaryRoadWidth });
      }
    }
    }
    yield progress(3, .5);
    // Keep one connected network: join stray pieces to it, drop what cannot be joined.
    const touches = (a: SettlementRoad, b: SettlementRoad) => {
      for (let i = 1; i < a.points.length; i++) for (let j = 1; j < b.points.length; j++) if (segmentIntersection(a.points[i - 1]!, a.points[i]!, b.points[j - 1]!, b.points[j]!)) return true;
      const ends = [a.points[0]!, a.points[a.points.length - 1]!, b.points[0]!, b.points[b.points.length - 1]!];
      return ends.slice(0, 2).some(([x, z]) => distanceToPolyline(x, z, b.points) < b.width / 2 + 1) || ends.slice(2).some(([x, z]) => distanceToPolyline(x, z, a.points) < a.width / 2 + 1);
    };
    const mains = pieces.filter((p) => p.kind === 'main').sort((a, b) => length(b.points) - length(a.points));
    const net: SettlementRoad[] = mains.length ? [mains[0]!] : pieces.length ? [pieces[0]!] : [];
    let rest = pieces.filter((p) => p !== net[0]);
    for (let changed = true; changed;) {
      changed = false;
      for (const p of rest) if (net.some((q) => touches(p, q))) { net.push(p); changed = true; }
      rest = rest.filter((p) => !net.includes(p));
    }
    let dropped = 0;
    for (const stray of rest.sort((a, b) => length(b.points) - length(a.points))) {
      if (net.some((q) => touches(stray, q))) { net.push(stray); continue; }
      // Short link from the stray's nearest end to the network.
      let best: { a: Vec2; b: Vec2; d: number } | null = null;
      for (const end of [stray.points[0]!, stray.points[stray.points.length - 1]!]) for (const q of net) for (const s of walk(q.points, 4)) {
        const d = Math.hypot(s.x - end[0], s.z - end[1]);
        if (!best || d < best.d) best = { a: end, b: [s.x, s.z], d };
      }
      if (best && best.d <= bs * .7 && walk([best.a, best.b], 4).every((s, i, all) => !i || roadOk([all[i - 1]!.x, all[i - 1]!.z], [s.x, s.z]))) {
        net.push(stray, { id: `r${n++}`, kind: 'alley', width: st.alleyWidth, points: [best.a, best.b] });
      } else dropped++;
    }
    if (dropped) issues.push({ severity: 'info', code: 'dropped-street', message: `Bỏ ${dropped} đoạn phố không nối được vào mạng lưới (bị nước hoặc dốc chia cắt).` });
    // Join the main street to the nearest road outside the region.
    const ends = net.filter((r) => r.kind === 'main').flatMap((r) => [r.points[0]!, r.points[r.points.length - 1]!]);
    let link: { a: Vec2; b: Vec2; d: number } | null = null;
    for (const ext of input.externalRoads) for (const s of walk(ext.points, 8)) for (const e of ends) {
      const d = Math.hypot(s.x - e[0], s.z - e[1]);
      if (d > 2 && (!link || d < link.d)) link = { a: e, b: [s.x, s.z], d };
    }
    if (link && link.d <= 900) {
      const pts = walk([link.a, link.b], 6);
      if (pts.every((s, i) => !i || roadOk([pts[i - 1]!.x, pts[i - 1]!.z], [s.x, s.z]))) net.push({ id: `r${n++}`, kind: 'connector', width: st.mainRoadWidth, points: [link.a, link.b] });
      else issues.push({ severity: 'warning', code: 'no-connector', message: 'Không nối được đường chính ra mạng đường bên ngoài (nước hoặc dốc trên tuyến nối).', x: link.a[0], z: link.a[1] });
    } else if (input.externalRoads.length) issues.push({ severity: 'info', code: 'far-from-roads', message: 'Vùng cách mạng đường hiện có hơn 900 m — chưa nối ra ngoài.' });
    roads = net;
    pieces.length = 0;
    if (!roads.length) throw new SettlementError([{ severity: 'error', code: 'no-roads', message: 'Không sinh được đường nào trong vùng (địa hình quá dốc hoặc ngập nước).' }]);

    /* 4. City blocks: cells between the street lines, clipped to the region; alleys split deep ones. */
    yield progress(4);
    const roadIndex0 = new RoadIndex();
    for (const r of roads) roadIndex0.add(r);
    const us = [{ at: umin - 1, width: 0 }, ...uLines.sort((a, b) => a.at - b.at), { at: umax + 1, width: 0 }];
    const vs = [{ at: vmin - 1, width: 0 }, ...vLines.sort((a, b) => a.at - b.at), { at: vmax + 1, width: 0 }];
    interface Cell { u0: number; u1: number; v0: number; v1: number; sides: Record<'u0' | 'u1' | 'v0' | 'v1', boolean> }
    const cells: Cell[] = [];
    let alleyCount = 0;
    const alleys = st.layout === 'grid' && (st.preset === 'dense-town' || st.preset === 'small-city' || st.preset === 'residential-district');
    if (st.layout === 'grid') for (let a = 1; a < us.length; a++) for (let b = 1; b < vs.length; b++) {
      const L = us[a - 1]!, R = us[a]!, T = vs[b - 1]!, B = vs[b]!;
      const pad = (w: number) => (w ? w / 2 + 1.5 : 0);
      const cell: Cell = { u0: L.at + pad(L.width), u1: R.at - pad(R.width), v0: T.at + pad(T.width), v1: B.at - pad(B.width), sides: { u0: !!L.width, u1: !!R.width, v0: !!T.width, v1: !!B.width } };
      if (cell.u1 - cell.u0 < 12 || cell.v1 - cell.v0 < 12) continue;
      const spanU = cell.u1 - cell.u0, spanV = cell.v1 - cell.v0;
      const need = st.lotDepth * 2 + st.alleyWidth + 6;
      if (alleys && Math.min(spanU, spanV) > need && Math.max(spanU, spanV) > st.lotWidth * 3) {
        // Alley through the middle, parallel to the long side, reaching the streets at both ends.
        const alongU = spanU >= spanV, mid = alongU ? (cell.v0 + cell.v1) / 2 : (cell.u0 + cell.u1) / 2, hw = st.alleyWidth / 2 + 1;
        const line: Vec2[] = alongU ? [[cell.u0 - pad(L.width), mid], [cell.u1 + pad(R.width), mid]] : [[mid, cell.v0 - pad(T.width)], [mid, cell.v1 + pad(B.width)]];
        addLine('alley', st.alleyWidth, line, 20);
        // Only alley pieces that actually reach a street (a corner clip can leave a stub).
        const added = pieces.splice(0).filter((p) => roads.some((q) => touches(p, q)));
        if (added.length) {
          roads.push(...added); alleyCount += added.length;
          for (const r of added) roadIndex0.add(r);
          if (alongU) cells.push({ ...cell, v1: mid - hw, sides: { ...cell.sides, v1: true } }, { ...cell, v0: mid + hw, sides: { ...cell.sides, v0: true } });
          else cells.push({ ...cell, u1: mid - hw, sides: { ...cell.sides, u1: true } }, { ...cell, u0: mid + hw, sides: { ...cell.sides, u0: true } });
          continue;
        }
      }
      cells.push(cell);
    }
    blocks = [];
    lots = [];
    const zoningRng = stream(seed, 'zoning'), lotRng = stream(seed, 'lots');
    const R0 = Math.max(1, analysis.radius);
    const cellBlocks: Array<{ cell: Cell; block: Block; localPoly: Vec2[] }> = [];
    for (const cell of cells) {
      const rect: Vec2[] = [[cell.u0, cell.v0], [cell.u1, cell.v0], [cell.u1, cell.v1], [cell.u0, cell.v1]];
      const clipped = clipToConvex(local, rect);
      if (clipped.length < 3 || Math.abs(polygonArea(clipped)) < 300) continue;
      const world = clipped.map(([u, v]) => toWorld(frame, u, v));
      const block: Block = { id: `b${blocks.length}`, polygon: world, cls: 'residential' };
      blocks.push(block); cellBlocks.push({ cell, block, localPoly: clipped });
    }

    /* 5. Lots along each street side of a block, longest sides first so corners go to them. */
    yield progress(5);
    const lotBoxes: Array<{ u0: number; u1: number; v0: number; v1: number }> = [];
    const overlapShare = (r: { u0: number; u1: number; v0: number; v1: number }) => {
      const a = (r.u1 - r.u0) * (r.v1 - r.v0);
      let worst = 0;
      for (const o of lotBoxes) {
        const w = Math.min(r.u1, o.u1) - Math.max(r.u0, o.u0), h = Math.min(r.v1, o.v1) - Math.max(r.v0, o.v0);
        if (w > 0 && h > 0) worst = Math.max(worst, w * h / a);
      }
      return worst;
    };
    for (const { cell, block, localPoly } of cellBlocks) {
      const sides = (Object.keys(cell.sides) as Array<keyof Cell['sides']>).filter((k) => cell.sides[k])
        .sort((a, b) => ((b[0] === 'u' ? cell.v1 - cell.v0 : cell.u1 - cell.u0) - (a[0] === 'u' ? cell.v1 - cell.v0 : cell.u1 - cell.u0)));
      let made = 0;
      for (const side of sides) {
        const horizontal = side[0] === 'v';
        const span0 = horizontal ? cell.u0 : cell.v0, span1 = horizontal ? cell.u1 : cell.v1;
        const deep = horizontal ? cell.v1 - cell.v0 : cell.u1 - cell.u0;
        const opposite = horizontal ? (side === 'v0' ? cell.sides.v1 : cell.sides.v0) : (side === 'u0' ? cell.sides.u1 : cell.sides.u0);
        const depth = Math.min(st.lotDepth * (1 + (lotRng.next() - .5) * .3 * st.randomness), opposite ? deep / 2 : deep);
        if (depth < 8) continue;
        // Collect runs of neighbouring lots, then cut them into irregular parcels that still fit together.
        const P = (along: number, t: number): Vec2 => side === 'v0' ? [along, cell.v0 + t] : side === 'v1' ? [along, cell.v1 - t] : side === 'u0' ? [cell.u0 + t, along] : [cell.u1 - t, along];
        const dirL: Vec2 = side === 'v0' ? [0, -1] : side === 'v1' ? [0, 1] : side === 'u0' ? [-1, 0] : [1, 0];
        const dir: Vec2 = [dirL[0] * frame.c - dirL[1] * frame.s, dirL[0] * frame.s + dirL[1] * frame.c];
        let run: Array<{ a: number; b: number }> = [];
        const flush = () => { if (run.length) for (const shape of parcelRun(run, depth, lotRng, st.randomness)) addParcel(shape); run = []; };
        const addParcel = (shape: ParcelShape) => {
          const local = shape.outline.map(([al, t]) => P(al, t));
          const inside = local.every(([u, v]) => pointInPolygon(u, v, localPoly));
          const rectL = [P(shape.a, 0), P(shape.b, 0), P(shape.b, depth), P(shape.a, depth)];
          const poly = inside ? local : clipToConvex(localPoly, rectL);
          if (poly.length < 3) return;
          const w = shape.b - shape.a, c = toWorld(frame, ...P((shape.a + shape.b) / 2, shape.depth / 2));
          const box = side[0] === 'v' ? { u0: Math.min(rectL[0]![0], rectL[1]![0]), u1: Math.max(rectL[0]![0], rectL[1]![0]), v0: Math.min(rectL[0]![1], rectL[2]![1]), v1: Math.max(rectL[0]![1], rectL[2]![1]) }
            : { u0: Math.min(rectL[0]![0], rectL[2]![0]), u1: Math.max(rectL[0]![0], rectL[2]![0]), v0: Math.min(rectL[0]![1], rectL[1]![1]), v1: Math.max(rectL[0]![1], rectL[1]![1]) };
          lotBoxes.push(box);
          lots.push({
            id: `${block.id}-l${made++}`, block: block.id, polygon: poly.map(([u, v]) => toWorld(frame, u, v)),
            front: [toWorld(frame, ...P(shape.a, 0)), toWorld(frame, ...P(shape.b, 0))], dir,
            obb: { x: c[0], z: c[1], hx: (side[0] === 'v' ? w : shape.depth) / 2, hz: (side[0] === 'v' ? shape.depth : w) / 2, yaw: -frame.angle },
            cls: 'empty', shape: shape.kind,
          });
        };
        for (let s = span0; s < span1 - 6;) {
          // Big-city cores get wide parcels, so the large blocks of flats have somewhere to go.
          const probe = horizontal ? toWorld(frame, s + st.lotWidth / 2, (cell.v0 + cell.v1) / 2) : toWorld(frame, (cell.u0 + cell.u1) / 2, s + st.lotWidth / 2);
          const core = st.sizeBias > .7 && Math.hypot(probe[0] - frame.cx, probe[1] - frame.cz) < R0 * .5 ? 1.75 : 1;
          // Real streets: narrow plots next to wide ones.
          const w = Math.min(span1 - s, st.lotWidth * core * (.55 + lotRng.next() * (.6 + st.randomness * .9)));
          if (w < Math.min(8, st.lotWidth * .5)) break;
          const r = horizontal
            ? (side === 'v0' ? { u0: s, u1: s + w, v0: cell.v0, v1: cell.v0 + depth } : { u0: s, u1: s + w, v0: cell.v1 - depth, v1: cell.v1 })
            : (side === 'u0' ? { u0: cell.u0, u1: cell.u0 + depth, v0: s, v1: s + w } : { u0: cell.u1 - depth, u1: cell.u1, v0: s, v1: s + w });
          const a = s; s += w;
          const rect: Vec2[] = [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]];
          const clipped = clipToConvex(localPoly, rect);
          const fm = toWorld(frame, ...P(a + w / 2, 0));
          // Only where a street really runs (pieces may be missing over water or cliffs).
          if (overlapShare(r) > .05 || clipped.length < 3 || Math.abs(polygonArea(clipped)) < (r.u1 - r.u0) * (r.v1 - r.v0) * .55 || roadIndex0.edgeDistance(fm[0], fm[1], 30) > 6) { flush(); continue; }
          run.push({ a, b: s });
        }
        flush();
      }
    }
    if (st.layout === 'organic') {
      // Lots follow the winding streets: one row each side, a block per uninterrupted run.
      const lotGrid = new SpatialGrid<Obb & { id: string }>(32, obbRadius);
      for (const r of roads) {
        if (r.kind === 'connector' || r.kind === 'alley') continue;
        for (const side of [-1, 1]) {
          let run: Lot[] = [];
          const flush = () => {
            if (run.length) {
              const block: Block = { id: `b${blocks.length}`, polygon: convexHull(run.flatMap((l) => obbCorners(l.obb))), cls: 'residential' };
              for (const l of run) { l.block = block.id; l.id = `${block.id}-${l.id}`; }
              blocks.push(block); lots.push(...run);
            }
            run = [];
          };
          for (const p of walk(r.points, st.lotWidth, st.lotWidth / 2)) {
            const w = st.lotWidth * (1 + (lotRng.next() - .5) * .3 * st.randomness) * .96;
            const depth = st.lotDepth * (1 + (lotRng.next() - .5) * .3 * st.randomness);
            const nx = -p.dz * side, nz = p.dx * side, off = r.width / 2 + 1.5 + depth / 2;
            const obb: Obb = { x: p.x + nx * off, z: p.z + nz * off, hx: w / 2, hz: depth / 2, yaw: Math.atan2(nx, nz) };
            const inner: Obb = { ...obb, hx: obb.hx - .5, hz: obb.hz - .5 };
            const corners = obbCorners(obb);
            if (corners.filter(([x, z]) => pointInPolygon(x, z, polygon)).length < 3 || roadIndex0.hits(inner, .5) ||
              lotGrid.query(obb.x, obb.z, obbRadius(obb)).some((o) => obbOverlap(o, inner))) { flush(); continue; }
            const dir: Vec2 = [-nx, -nz];
            const f0: Vec2 = [p.x + nx * (r.width / 2 + 1.5) - p.dx * w / 2, p.z + nz * (r.width / 2 + 1.5) - p.dz * w / 2];
            const f1: Vec2 = [f0[0] + p.dx * w, f0[1] + p.dz * w];
            const lot: Lot = { id: `l${run.length}`, block: '', polygon: corners, front: side > 0 ? [f1, f0] : [f0, f1], dir, obb, cls: 'empty' };
            lotGrid.insert({ ...obb, id: lot.id });
            run.push(lot);
          }
          flush();
        }
      }
    }

    if (st.layout === 'urban') {
      const cut = frontageParcels({ roads, polygon, ground, pattern: st.pattern ?? 'mixed', seed, center: analysis.center, radius: analysis.radius, settings: st,
        roadEdge: (x, z, range) => roadIndex0.edgeDistance(x, z, range), roadHits: (b, c) => roadIndex0.hits(b, c) });
      for (const b of cut.blocks) blocks.push({ ...b, cls: 'residential' });
      lots.push(...(cut.lots as Lot[]));
    }

    /* 6. Zoning per block (coherent districts), then which lots are built. */
    yield progress(6);
    const lotsByBlock = new Map<string, Lot[]>();
    for (const l of lots) { let list = lotsByBlock.get(l.block); if (!list) lotsByBlock.set(l.block, list = []); list.push(l); }
    if (st.layout === 'urban') {
      districts = planDistricts({ lots, roads, polygon, ground, pattern: st.pattern ?? 'mixed', seed, center: analysis.center, radius: analysis.radius, area, settings: st, externalRoads: input.externalRoads });
      for (const b of blocks) b.cls = blockClass(lotsByBlock.get(b.id) ?? []);
      // Working fields of the parcel cut, not part of the stored lot.
      for (const l of lots as Array<Lot & { wide?: boolean; road?: string }>) { delete l.wide; delete l.road; }
    } else for (const b of blocks) {
      const c = polygonCentroid(b.polygon), ratio = Math.min(1, Math.hypot(c[0] - frame.cx, c[1] - frame.cz) / R0);
      const z = st.zoning;
      const weights: Array<[LotClass, number]> = [
        ['residential', z.residential * (.6 + ratio)], ['commercial', z.commercial * Math.max(0, 1.6 - 1.4 * ratio) * (1 + st.concentration)],
        ['industrial', z.industrial * (.4 + ratio * 1.2)], ['military', z.military],
      ];
      const total = weights.reduce((s, [, w]) => s + w, 0);
      let roll = zoningRng.next() * total, cls: LotClass = 'residential';
      for (const [k, w] of weights) { if ((roll -= w) <= 0 && w > 0) { cls = k; break; } }
      const own = lotsByBlock.get(b.id) ?? [];
      b.cls = own.length ? cls : 'green';
      for (const l of own) {
        const lc = Math.hypot(l.obb.x - frame.cx, l.obb.z - frame.cz) / R0;
        const p = Math.max(.05, st.density * (1 - st.concentration * .8 * lc * lc));
        const r = zoningRng.next();
        l.cls = r < p ? cls : r < p + (1 - st.density) * .2 && cls !== 'industrial' ? 'green' : 'empty';
      }
    }
    // Every parcel gets its own character: how it is used, fenced and planted.
    const styleRng = stream(seed, 'lot-style');
    const weighted = <T extends string>(list: Array<[T, number]>): T => { let r = styleRng.next() * list.reduce((a, [, w]) => a + w, 0); for (const [k, w] of list) if ((r -= w) <= 0) return k; return list[0]![0]; };
    const rural = st.layout === 'organic' || st.preset === 'rural-town';
    for (const l of lots) {
      l.flora = styleRng.int(1000);
      if (l.cls === 'green') l.style = weighted<LotStyle>([['garden', 3], ['orchard', rural ? 3 : 1], ['farm', rural ? 2 : 0], ['overgrown', st.decay * 3]]);
      else if (l.cls === 'empty') l.style = weighted<LotStyle>([['vacant', 2], ['garden', 1], ['overgrown', .5 + st.decay * 3], ['farm', rural ? 1.5 : 0]]);
      else if (l.cls === 'residential') l.style = weighted<LotStyle>([['yard', 4], ['full', 1.5], ['walled', 1.5], ['farm', rural ? 2 : .3], ['overgrown', st.decay * 3]]);
      else if (l.cls === 'commercial') l.style = weighted<LotStyle>([['full', 3], ['yard', 1], ['walled', .5]]);
      else l.style = weighted<LotStyle>([['work', 3], ['walled', 1.5], ['full', 1]]);
      const fences: Array<[FenceKind, number]> = l.cls === 'military' ? [['wire', 3], ['wall', 2], ['none', 1]]
        : l.cls === 'industrial' ? [['iron', 2], ['wall', 2], ['wire', 1], ['none', 2]]
          : l.style === 'walled' ? [['iron', 3], ['wood', 2], ['hedge', 1]]
            : l.style === 'full' || l.style === 'vacant' ? [['none', 4], ['wood', 1]]
              : [['none', st.fences ? 1.5 : 4], ['wood', 3], ['hedge', 2], ['iron', 1]];
      l.fence = weighted(fences);
      // Urban plots: tube houses fill their frontage, public services stand in walled grounds, parks are gardens.
      if (l.use === 'tube' || l.use === 'shophouse') { if (l.cls !== 'empty' && l.cls !== 'green') { l.style = 'full'; l.fence = 'none'; } else delete l.use; }
      else if (l.use === 'park') { l.style = 'garden'; l.fence = 'hedge'; }
      else if (isPublicUse(l.use)) { l.style = l.use === 'market' ? 'full' : 'walled'; l.fence = l.use === 'market' ? 'none' : l.use === 'temple' ? 'wall' : 'iron'; }
      // Whole streets gone to seed where the place has decayed.
      if (st.layout === 'urban' && l.style !== 'full' && decayAt(l.obb.x, l.obb.z).value > .55 && styleRng.next() < .7) l.style = 'overgrown';
    }
    if (alleyCount) issues.push({ severity: 'info', code: 'alleys', message: `Đã thêm ${alleyCount} ngõ trong các ô phố sâu.` });
  }
  const roadIndex = new RoadIndex();
  for (const r of roads) roadIndex.add(r);
  for (const r of input.externalRoads) roadIndex.add(r);

  /* 7. Buildings: biggest lots first, the largest fitting model faces the street. */
  yield progress(7);
  const solids = solidGrid();
  for (const o of input.obstacles) solids.insert({ ...o, tag: 'obstacle' });
  const keptBuildings = (prev?.buildings ?? []).filter((b) => keepBuildings || b.manual);
  for (const b of keptBuildings) solids.insert({ ...b.obb, tag: `b:${b.id}` });
  const buildings: PlacedBuilding[] = [...keptBuildings];
  const corridors: Obb[] = [];
  const doorCorridor = (door: Vec2, dir: Vec2, len: number): Obb => ({ x: door[0] + dir[0] * len / 2, z: door[1] + dir[1] * len / 2, hx: 1.3, hz: len / 2 + .3, yaw: Math.atan2(dir[0], dir[1]) });
  if (!keepBuildings) {
    const rng = stream(seed, 'buildings');
    const order = lots.filter((l) => l.cls !== 'empty' && l.cls !== 'green').sort((a, b) => b.obb.hx * b.obb.hz - a.obb.hx * a.obb.hz);
    if (catalog.noKits && !Object.values(catalog.buildings).some((list) => list.length)) issues.push({ severity: 'warning', code: 'no-houses', message: 'Không có model nhà nào để đặt: khu vực không có nhà.' });
    const taken = new Set(keptBuildings.map((b) => b.lot));
    let done = 0;
    for (const lot of order) {
      if (++done % 50 === 0) yield progress(7, done / order.length);
      if (buildings.length >= st.maxBuildings) { issues.push({ severity: 'info', code: 'building-cap', message: `Đạt giới hạn ${st.maxBuildings} công trình.` }); break; }
      if (taken.has(lot.id)) continue;
      const cls = lot.cls as LotClass;
      const condition = decayAt(lot.obb.x, lot.obb.z).condition;
      // Whole models only: every plot (tube house, school, market…) takes a house model.
      const pool = !catalog.noKits && lot.use && (isPublicUse(lot.use) || lot.use === 'tube' || lot.use === 'shophouse') ? []
        : catalog.buildings[(st.decay > .7 || condition !== 'intact') && cls === 'residential' ? 'abandoned' : cls];
      // Lot frame: width along the front, depth inward.
      const fx = lot.front[1][0] - lot.front[0][0], fz = lot.front[1][1] - lot.front[0][1], width = Math.hypot(fx, fz);
      const tx = fx / width, tz = fz / width, inward: Vec2 = [-lot.dir[0], -lot.dir[1]];
      const depth = (lot.obb.hx * lot.obb.hz * 4) / width;
      // A plot built over completely sits on the pavement; the others keep a front yard.
      const setback = lot.style === 'full' ? Math.min(1, st.setback) : lot.style === 'farm' ? st.setback + 3 : st.setback;
      const availW = width - (lot.style === 'full' ? 1 : 3), availD = depth - setback - (lot.style === 'full' ? .5 : 1.5);
      type Candidate = { item: CatalogItem; turned: boolean; recipe?: CompositeRecipe };
      const fits: Candidate[] = pool.flatMap((item) => [
        ...(item.w <= availW && item.d <= availD ? [{ item, turned: false }] : []),
        ...(item.d <= availW && item.w <= availD && Math.abs(item.w - item.d) > 1 ? [{ item, turned: true }] : []),
      ]);
      // Storeyed buildings from the brick / concrete / modular kits: the city core, offices,
      // barracks and flats. How often depends on the place (a village rarely, a city mostly).
      const tall = cls === 'military' ? .8 : st.preset === 'small-city' || st.preset === 'planned-city' ? .95 : st.preset === 'dense-town' ? .65 : st.sizeBias * .6;
      const kitShare = cls === 'commercial' ? .55 + tall * .4 : cls === 'military' ? .75 : cls === 'industrial' ? .45 : tall * .7;
      const asCandidate = (o: ReturnType<typeof compositeOptions>[number]): Candidate => ({ item: { asset: o.recipe.kind === 'brick' ? 2050 : 2051, name: o.recipe.kind, w: o.w, d: o.d, ox: 0, oz: 0, height: o.height }, turned: false, recipe: o.recipe });
      // (No kit buildings of brick / concrete panels: whole models only.)
      if (catalog.noKits) { /* whole models only */ }
      else if (lot.use && (isPublicUse(lot.use) || lot.use === 'tube' || lot.use === 'shophouse')) fits.unshift(...urbanBuildingOptions(lot.use, rng, availW, availD).map(asCandidate));
      else if (lot.style !== 'farm' && rng.next() < kitShare) fits.unshift(...compositeOptions(cls, rng, tall, availW, availD).map(asCandidate));
      fits.sort((a, b) => b.item.w * b.item.d - a.item.w * a.item.d);
      if (!fits.length) continue;
      const first = lot.style === 'full' || rng.next() < st.sizeBias ? 0 : Math.floor(rng.next() * fits.length);
      let tries = [...fits.slice(first), ...fits.slice(0, first)].slice(0, 4);
      // Houses made in the Model Studio come first wherever one fits (most lots), the built-in
      // ones fill the rest: otherwise a few new models drowned among the many built-in.
      const studioFits = fits.filter((f) => f.item.studio);
      if (studioFits.length && rng.next() < .8) {
        const k = Math.floor(rng.next() * studioFits.length);
        tries = [...studioFits.slice(k), ...studioFits.slice(0, k), ...tries.filter((f) => !f.item.studio)].slice(0, 5);
      }
      const facing = Math.atan2(lot.dir[0], lot.dir[1]);
      for (const { item, turned, recipe } of tries) {
        const w = turned ? item.d : item.w, d = turned ? item.w : item.d;
        const slide = (rng.next() - .5) * (availW - w) * st.randomness;
        const mid: Vec2 = [(lot.front[0][0] + lot.front[1][0]) / 2, (lot.front[0][1] + lot.front[1][1]) / 2];
        const cx = mid[0] + tx * slide + inward[0] * (setback + d / 2), cz = mid[1] + tz * slide + inward[1] * (setback + d / 2);
        const yaw = facing + (turned ? Math.PI / 2 : 0);
        const box: Obb = { x: cx, z: cz, hx: item.w / 2, hz: item.d / 2, yaw };
        if (!obbInsidePolygon(box, polygon) || !obbInsidePolygon({ ...box, hx: box.hx - .3, hz: box.hz - .3 }, lot.polygon) || blocked(solids, box, lot.style === 'full' ? 1 : 2) || roadIndex.hits(box, 1)) continue;
        const pts = [...obbCorners(box), [cx, cz] as Vec2];
        const hs = pts.map(([x, z]) => ground.height(x, z));
        if ((Math.max(...hs) - Math.min(...hs)) / Math.max(w, d) > st.maxSlope || pts.some(([x, z]) => ground.water(x, z))) continue;
        const extent = d / 2;
        const door: Vec2 = [cx + lot.dir[0] * (extent + .5), cz + lot.dir[1] * (extent + .5)];
        // Model origin from the footprint centre.
        const c = Math.cos(yaw), s = Math.sin(yaw), x = cx - (item.ox * c + item.oz * s), z = cz - (-item.ox * s + item.oz * c);
        // A ruined kit building is a gutted shell (walls of the ground storey only).
        const built = recipe && condition === 'ruined' && recipe.kind !== 'modular' ? { ...recipe, ruin: true } : recipe;
        const b: PlacedBuilding = { id: `h${buildings.length}-${lot.id}`, asset: item.asset, x, z, y: Math.min(...hs), yaw, obb: box, door, lot: lot.id, cls, ...(built ? { recipe: built } : {}), ...(condition !== 'intact' ? { condition } : {}) };
        buildings.push(b);
        solids.insert({ ...box, tag: `b:${b.id}` });
        const corridor = doorCorridor(door, lot.dir, setback + 1);
        corridors.push(corridor); solids.insert({ ...corridor, tag: 'corridor' });
        break;
      }
    }
  }
  // Kept buildings keep their way in clear too.
  for (const b of keptBuildings) {
    const lot = lots.find((l) => l.id === b.lot);
    const dir: Vec2 = lot ? lot.dir : [Math.sin(b.yaw), Math.cos(b.yaw)];
    const corridor = doorCorridor(b.door, dir, st.setback + 1);
    corridors.push(corridor); solids.insert({ ...corridor, tag: 'corridor' });
  }

  /* 8. Trees, fences, lamps, wrecks and clutter, each from its own random stream. */
  yield progress(8);
  const props: PlacedProp[] = (prev?.props ?? []).filter((p) => p.manual);
  for (const p of props) solids.insert({ ...p.obb, tag: `p:${p.id}` });
  const place = (kind: PropKind, item: CatalogItem, x: number, z: number, yaw: number, scale: number, opts: { margin?: number; onRoad?: boolean; onWater?: boolean; tag?: string; y?: number; along?: number } = {}): boolean => {
    if (props.length >= st.maxProps) return false;
    const box = footprint(item, x, z, yaw, scale);
    if (opts.along) box.hx = item.w * opts.along / 2;
    if (!pointInPolygon(box.x, box.z, polygon) || (!opts.onWater && ground.water(box.x, box.z))) return false;
    // A fence run is a chain: its own pieces touch end to end, everything else keeps clear.
    const own = opts.tag;
    if (blocked(solids, box, opts.margin ?? .4, own ? (o) => o.tag === own : undefined)) return false;
    if (!opts.onRoad && roadIndex.hits(box, .3)) return false;
    const p: PlacedProp = { id: `p${props.length}-${kind}`, asset: item.asset, kind, x, z, y: opts.y ?? ground.height(x, z), yaw, scale, obb: box, ...(opts.along && Math.abs(opts.along - 1) > .01 ? { sx: Math.round(opts.along * 1000) / 1000 } : {}) };
    props.push(p); solids.insert({ ...box, tag: opts.tag ?? `p:${p.id}` });
    return true;
  };
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const builtLots = new Set(buildings.map((b) => b.lot));
  // Lamps along the streets, alternating sides; some missing in decayed places.
  if (st.lamps) {
    const rng = stream(seed, 'props-lamps');
    for (const r of roads) {
      if (r.kind === 'alley') continue;
      let side = 1;
      for (const p of walk(r.points, r.kind === 'main' ? 32 : 42, 8)) {
        side = -side;
        if (rng.next() < st.decay * .5) continue;
        const nx = -p.dz * side, nz = p.dx * side, off = r.width / 2 + 1.4;
        place('lamp', pick(rng, catalog.props.lamp), p.x + nx * off, p.z + nz * off, Math.atan2(-nx, -nz), 1, { margin: .3 });
      }
    }
  }
  // Road signs where streets meet (stop for side streets, give way in alleys), speed limits on
  // the main street, traffic lights at the busy junctions of towns and cities.
  {
    const rng = stream(seed, 'props-signs');
    const S = catalog.props.sign, sign = (k: number) => S[k % S.length]!;
    const lights = st.preset === 'small-city' || st.preset === 'dense-town' || st.preset === 'planned-city' || st.preset === 'mixed-city' || st.preset === 'port' || st.preset === 'industrial-zone';
    for (const r of roads) {
      if (r.points.length < 2) continue;
      for (const atEnd of [false, true]) {
        const pts = atEnd ? r.points : [...r.points].reverse();
        const end = pts[pts.length - 1]!, prevPt = pts[pts.length - 2]!, len = Math.hypot(end[0] - prevPt[0], end[1] - prevPt[1]) || 1;
        const dx = (end[0] - prevPt[0]) / len, dz = (end[1] - prevPt[1]) / len;
        const meets = roads.find((o) => o !== r && distanceToPolyline(end[0], end[1], o.points) < o.width / 2 + 2);
        if (!meets) continue;
        const back = Math.min(len * .8, r.width / 2 + 5), side = r.width / 2 + 1.2;
        const x = end[0] - dx * back + dz * side, z = end[1] - dz * back - dx * side;
        const facing = Math.atan2(-dx, -dz);
        if (lights && r.kind !== 'alley' && meets.kind !== 'alley' && (r.kind === 'main' || meets.kind === 'main')) {
          place('trafficLight', catalog.props.trafficLight[r.kind === 'main' ? 1 : 0]!, x, z, facing, 1, { margin: .2, tag: 'sign' });
          place('trafficLight', catalog.props.trafficLight[2]!, end[0] - dx * back - dz * side, end[1] - dz * back + dx * side, facing, 1, { margin: .2, tag: 'sign' });
        } else if (r.kind !== 'connector') place('sign', sign(r.kind === 'alley' ? 1 : meets.kind === 'main' ? 0 : 1), x, z, facing, 1, { margin: .2, tag: 'sign' });
      }
      if (r.kind === 'main' || r.kind === 'connector') {
        let k = 0;
        for (const q of walk(r.points, 160, 40)) {
          const sideK = k++ % 2 ? 1 : -1, off = r.width / 2 + 1.2;
          const kind = r.kind === 'connector' && st.decay > .5 && rng.next() < .5 ? 7 + Math.floor(rng.next() * 2) : st.layout === 'organic' ? 3 : 2;
          place('sign', sign(kind), q.x - q.dz * off * sideK, q.z + q.dx * off * sideK, Math.atan2(q.dx * sideK, q.dz * sideK), 1, { margin: .2, tag: 'sign' });
        }
      }
    }
  }
  // Harbour where the region meets water: a quay along the shore, piers out into the water on
  // steel piles, a breakwater offshore with a groyne from the shore, cranes and container yards.
  if (st.harbour) {
    const rng = stream(seed, 'props-harbour'), stepH = 6;
    const wet: Vec2[] = [], dry: Vec2[] = [], shore: Vec2[] = [];
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += stepH) for (let x = Math.min(...xs); x <= Math.max(...xs); x += stepH) {
      if (!pointInPolygon(x, z, polygon)) continue;
      if (ground.water(x, z)) { wet.push([x, z]); continue; }
      dry.push([x, z]);
      if ([[stepH, 0], [-stepH, 0], [0, stepH], [0, -stepH]].some(([ox, oz]) => ground.water(x + ox!, z + oz!))) shore.push([x, z]);
    }
    if (wet.length > 20 && shore.length > 3 && dry.length) {
      const mean = (l: Vec2[]): Vec2 => [l.reduce((a, q) => a + q[0], 0) / l.length, l.reduce((a, q) => a + q[1], 0) / l.length];
      const [wx, wz] = mean(wet), [lx, lz] = mean(dry), sl = Math.hypot(wx - lx, wz - lz) || 1;
      const sx = (wx - lx) / sl, sz = (wz - lz) / sl, tx = -sz, tz = sx;
      const deck = input.seaLevel + 1.4;
      // Quay slabs along the waterline.
      const quay = catalog.props.quay[0]!;
      for (const [x, z] of shore) place('quay', quay, x + sx * 2, z + sz * 2, Math.atan2(sx, sz), 1, { onWater: true, onRoad: true, margin: 0, tag: 'harbour', y: Math.max(deck, ground.height(x, z) + .2) });
      // Piers: every ~70 m along the shore, straight out while there is water.
      const along = shore.map((q) => ({ q, t: q[0] * tx + q[1] * tz })).sort((a, b) => a.t - b.t);
      let nextPier = along[0]!.t + 20, cranes = 0;
      for (const { q, t } of along) {
        if (t < nextPier) continue;
        nextPier = t + 60 + rng.next() * 30;
        const length = 50 + rng.next() * 50;
        for (let d = 4; d <= length; d += 4) {
          const cx = q[0] + sx * d, cz = q[1] + sz * d;
          if (!ground.water(cx, cz) || !pointInPolygon(cx, cz, polygon)) break;
          for (const o of [-2, 2]) place('pier', catalog.props.quay[1]!, cx + tx * o, cz + tz * o, Math.atan2(sx, sz), 1, { onWater: true, margin: 0, tag: 'harbour', y: deck });
          if (d % 8 === 0) for (const o of [-4, 4]) place('pile', catalog.props.pile[0]!, cx + tx * o, cz + tz * o, 0, 1, { onWater: true, margin: 0, tag: 'harbour', y: ground.height(cx, cz) });
          if (d + 4 > length) for (const o of [-3.5, 3.5]) place('bollard', catalog.props.bollard[0]!, cx + tx * o, cz + tz * o, 0, 1, { onWater: true, margin: 0, tag: 'harbour', y: deck });
        }
        // A crane on the quay at the root of every other pier, containers stacked behind it.
        if (cranes < 3 && rng.next() < .6) {
          if (place('crane', catalog.props.crane[0]!, q[0] - sx * 10, q[1] - sz * 10, Math.atan2(sx, sz), 1, { margin: 1 })) cranes++;
          for (let row = 0; row < 3; row++) for (let col = -2; col <= 2; col++) {
            const item = pick(rng, catalog.props.container), bx = q[0] - sx * (28 + row * 4) + tx * col * 7, bz = q[1] - sz * (28 + row * 4) + tz * col * 7;
            if (place('container', item, bx, bz, Math.atan2(tx, tz), 1, { margin: .3, tag: 'yard' }) && rng.next() < .45)
              place('container', pick(rng, catalog.props.container), bx, bz, Math.atan2(tx, tz), 1, { margin: -10, tag: 'yard', y: ground.height(bx, bz) + 2.6 });
          }
        }
      }
      // Breakwater offshore, parallel to the shore, and a groyne from the shore's far end.
      const t0 = along[0]!.t, t1 = along[along.length - 1]!.t, mid = mean(shore);
      for (let t = t0 + (t1 - t0) * .05; t <= t1 - (t1 - t0) * .05; t += 11) {
        const off = 110 + Math.sin(t * .02) * 10, rel = t - (mid[0] * tx + mid[1] * tz);
        const x = mid[0] + tx * rel + sx * off, z = mid[1] + tz * rel + sz * off;
        if (ground.water(x, z)) place('breakwater', pick(rng, catalog.props.breakwater), x, z, rng.next() * 6.28, .55 + rng.next() * .25, { onWater: true, margin: -3, tag: 'harbour', y: ground.height(x, z) });
      }
      const root = along[along.length - 1]!.q;
      for (let d = 0; d <= 90; d += 6) {
        const x = root[0] + sx * d, z = root[1] + sz * d;
        if (!pointInPolygon(x, z, polygon)) break;
        place('breakwater', catalog.props.breakwater[3 + Math.floor(rng.next() * 2)]!, x, z, rng.next() * 6.28, .9 + rng.next() * .3, { onWater: true, onRoad: true, margin: -1, tag: 'harbour', y: ground.height(x, z) });
      }
    } else issues.push({ severity: 'info', code: 'no-shore', message: 'Vùng không chạm mặt nước — không sinh cầu cảng, đê chắn sóng.' });
  }
  // Military perimeter: wire and sandbags just inside the outline, gates where streets cross.
  if (st.perimeter) {
    const rng = stream(seed, 'props-perimeter');
    const ring = polygonArea(polygon) > 0 ? polygon : [...polygon].reverse();
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ex = (b[0] - a[0]) / len, ez = (b[1] - a[1]) / len, nx = -ez, nz = ex;
      const item = catalog.props.perimeter[0]!;
      for (let t = item.w / 2 + 2; t < len - item.w / 2; t += item.w) {
        const x = a[0] + ex * t + nx * 4, z = a[1] + ez * t + nz * 4;
        if (roadIndex.edgeDistance(x, z, 20) < 4 || rng.next() < st.decay * .3) continue;
        place('perimeter', rng.next() < .8 ? item : pick(rng, catalog.props.perimeter), x, z, Math.atan2(-ez, ex), 1, { margin: .05, tag: 'perimeter' });
      }
    }
  }
  yield progress(8, .2);
  // Each parcel dressed by its own character: its fence kind along its real outline (street side
  // open, or a gate for walled plots), its own tree species, beds, orchards and yard things.
  {
    const rng = stream(seed, 'props-lots');
    const fenceItems: Record<Exclude<FenceKind, 'none' | 'hedge'>, CatalogItem[]> = { wood: catalog.props.fence, iron: catalog.props.wall.slice(1, 2), wall: catalog.props.wall.slice(0, 1).concat(catalog.props.wall.slice(2)), wire: catalog.props.perimeter.slice(0, 1) };
    for (const lot of lots) {
      if (!lot.style) continue;
      const built = builtLots.has(lot.id), sp = lot.flora ?? 0, fence = lot.fence ?? 'none';
      if (fence !== 'none' && (built || lot.style === 'farm' || lot.style === 'orchard' || lot.style === 'walled')) {
        const pool = fence === 'hedge' ? [] : fenceItems[fence];
        const item = fence === 'hedge' ? null : pick(rng, pool.length ? pool : catalog.props.fence);
        const fx = lot.front[1][0] - lot.front[0][0], fz = lot.front[1][1] - lot.front[0][1], fl = Math.hypot(fx, fz) || 1;
        const gate: Vec2 = [lot.front[0][0] + fx / 2 - lot.dir[0] * .6, lot.front[0][1] + fz / 2 - lot.dir[1] * .6];
        const closedFront = fence === 'wall' || fence === 'iron';
        for (let e = 0; e < lot.polygon.length; e++) {
          const a = lot.polygon[e]!, b = lot.polygon[(e + 1) % lot.polygon.length]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 1.5) continue;
          const ex = (b[0] - a[0]) / len, ez = (b[1] - a[1]) / len;
          const mx = (a[0] + b[0]) / 2 - lot.front[0][0], mz = (a[1] + b[1]) / 2 - lot.front[0][1];
          const onStreet = Math.abs((ex * fx + ez * fz) / fl) > .9 && Math.abs(mx * lot.dir[0] + mz * lot.dir[1]) < 2;
          if (onStreet && !closedFront) continue;
          // Set the line half a metre inside the plot.
          const ix = -lot.dir[0] * (onStreet ? .6 : 0), iz = -lot.dir[1] * (onStreet ? .6 : 0);
          // Whole pieces fitted to the side (stretched a little), meeting end to end at the corners.
          const count = Math.max(1, Math.round(len / (item ? item.w : 1.6))), step = len / count, stretch = item ? step / item.w : 1;
          const tag = `fence-${lot.id}`;
          for (let k = 0; k < count; k++) {
            const t = step * (k + .5), x = a[0] + ex * t + ix, z = a[1] + ez * t + iz;
            if ((lot.style === 'overgrown' && rng.next() < .3) || (closedFront && onStreet && Math.hypot(x - gate[0], z - gate[1]) < step * .8)) continue;
            if (item) place('fence', item, x, z, Math.atan2(-ez, ex), 1, { margin: 0, tag, along: stretch });
            else place('hedge', catalog.props.hedge[sp % catalog.props.hedge.length]!, x, z, rng.next() * 6.28, .55 + rng.next() * .15, { margin: 0, tag });
          }
        }
      }
      const c = Math.cos(lot.obb.yaw), s2 = Math.sin(lot.obb.yaw);
      const local = (u: number, v: number): Vec2 => [lot.obb.x + u * c + v * s2, lot.obb.z - u * s2 + v * c];
      const inLot = ([x, z]: Vec2) => pointInPolygon(x, z, lot.polygon);
      const species = catalog.props.tree[sp % catalog.props.tree.length]!, second = catalog.props.tree[(sp >> 3) % catalog.props.tree.length]!;
      const bush = catalog.props.bush[sp % catalog.props.bush.length]!;
      const scatter = (count: number, f: (q: Vec2) => void) => {
        for (let k = 0; k < count; k++) { const q = local((rng.next() * 2 - 1) * Math.max(.5, lot.obb.hx - 1.5), (rng.next() * 2 - 1) * Math.max(.5, lot.obb.hz - 1.5)); if (inLot(q)) f(q); }
      };
      const density = .4 + st.treeDensity;
      switch (lot.style) {
        case 'orchard': {
          // Rows of one species.
          const gap = 5 + (sp % 3);
          for (let u = -lot.obb.hx + 3; u <= lot.obb.hx - 3; u += gap) for (let v = -lot.obb.hz + 3; v <= lot.obb.hz - 3; v += gap) {
            const q = local(u, v);
            if (inLot(q) && rng.next() < .92) place('tree', species, q[0], q[1], rng.next() * 6.28, .6 + rng.next() * .2, { margin: .2 });
          }
          break;
        }
        case 'farm': {
          // Crop beds in rows across the plot, a tree by the house.
          const alongU = lot.obb.hx >= lot.obb.hz, rows = Math.min(2.6, (alongU ? lot.obb.hz : lot.obb.hx) / 4);
          for (let k = -3; k <= 3; k++) for (let t = -.9; t <= .9; t += .12) {
            const q = alongU ? local(t * (lot.obb.hx - 2), k * rows) : local(k * rows, t * (lot.obb.hz - 2));
            if (inLot(q) && rng.next() < .85) place('crop', catalog.props.crop[(sp + k + 7) % catalog.props.crop.length]!, q[0], q[1], rng.next() * 6.28, .32, { margin: .02 });
          }
          if (rng.next() < .6) scatter(1, (q) => place('tree', second, q[0], q[1], rng.next() * 6.28, 1, { margin: .5 }));
          break;
        }
        case 'garden':
          scatter(Math.round((2 + (sp % 5)) * density), (q) => place(rng.next() < .6 ? 'tree' : 'bush', rng.next() < .6 ? species : bush, q[0], q[1], rng.next() * 6.28, .7 + rng.next() * .5, { margin: .5 }));
          if (rng.next() < .5) scatter(1, (q) => place('bench', pick(rng, catalog.props.bench), q[0], q[1], rng.next() * 6.28, 1, { margin: .4 }));
          break;
        case 'overgrown':
          scatter(Math.round((6 + (sp % 6)) * density), (q) => {
            const k: PropKind = rng.next() < .3 ? 'deadTree' : rng.next() < .6 ? 'bush' : 'tree';
            place(k, k === 'tree' ? species : pick(rng, catalog.props[k]), q[0], q[1], rng.next() * 6.28, .6 + rng.next() * .7, { margin: .3 });
          });
          if (built || rng.next() < .4) scatter(2, (q) => place('debris', pick(rng, catalog.props.debris), q[0], q[1], rng.next() * 6.28, 1, { margin: .4 }));
          break;
        case 'vacant':
          if (rng.next() < .45) scatter(1 + (sp % 2), (q) => place('bush', pick(rng, catalog.props.bush), q[0], q[1], rng.next() * 6.28, .8, { margin: .4 }));
          if (rng.next() < st.decay * .5) scatter(1, (q) => place('vehicle', pick(rng, catalog.props.vehicle), q[0], q[1], rng.next() * 6.28, 1, { margin: .6 }));
          break;
        case 'yard': case 'walled':
          // One to three trees of the plot's own species, shrubs on some.
          scatter(Math.round((sp % 4) * density * .8), (q) => place('tree', species, q[0], q[1], rng.next() * 6.28, .7 + rng.next() * .4, { margin: .6 }));
          if (sp % 2) scatter(2 + (sp % 3), (q) => place('bush', bush, q[0], q[1], rng.next() * 6.28, .7, { margin: .3 }));
          break;
        default: break;
      }
    }
  }
  yield progress(8, .45);
  // Trees: clustered by noise and by district (parks and outskirts dense, the core sparse).
  {
    const rng = stream(seed, 'props-trees'), cluster = new Simplex2(seedNumber(seed, 'props-trees-cluster'));
    const lotGrid = new SpatialGrid<Lot & { x: number; z: number }>(48, (l) => obbRadius(l.obb));
    for (const l of lots) lotGrid.insert({ ...l, x: l.obb.x, z: l.obb.z });
    const factor: Record<string, number> = { residential: .8, commercial: .25, industrial: .3, military: .2, green: 1.7, empty: 1.1 };
    const spacing = 9;
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += spacing) for (let x = Math.min(...xs); x <= Math.max(...xs); x += spacing) {
      const px = x + (rng.next() - .5) * spacing * .9, pz = z + (rng.next() - .5) * spacing * .9;
      if (!pointInPolygon(px, pz, polygon)) continue;
      const lot = lotGrid.query(px, pz, 1).find((l) => pointInPolygon(px, pz, l.polygon));
      const zone = lot ? (lot.style ? .12 : factor[lot.cls]! * (builtLots.has(lot.id) ? .6 : 1)) : 1;
      const p = st.treeDensity * zone * smoothstep(-.35, .55, cluster.noise(px * .011, pz * .011)) * .55;
      if (rng.next() >= p || ground.slope(px, pz) > .7) continue;
      const roll = rng.next();
      const kind: PropKind = roll < st.decay * .25 ? 'deadTree' : roll < .35 ? 'bush' : 'tree';
      place(kind, pick(rng, catalog.props[kind]), px, pz, rng.next() * Math.PI * 2, .8 + rng.next() * .45, { margin: .6 });
    }
    // Boulevard trees along city main streets.
    if (st.preset === 'small-city' || st.preset === 'dense-town' || st.preset === 'planned-city' || st.preset === 'mixed-city') for (const r of roads.filter((q) => q.kind === 'main')) for (const p of walk(r.points, 16, 6)) for (const side of [-1, 1]) {
      const off = r.width / 2 + 2.8;
      place('tree', catalog.props.tree[rng.int(4)]!, p.x - p.dz * side * off, p.z + p.dx * side * off, rng.next() * 6.28, .8, { margin: .3 });
    }
  }
  yield progress(8, .7);
  // Abandoned cars on the streets (more where it has decayed), military vehicles in base yards.
  {
    const rng = stream(seed, 'props-vehicles');
    for (const r of roads) for (const p of walk(r.points, 25, 10)) {
      if (rng.next() >= (.04 + st.decay * .25) * (.5 + st.propDensity)) continue;
      const side = rng.next() < .5 ? -1 : 1, off = r.width * .28 * side;
      place('vehicle', pick(rng, catalog.props.vehicle), p.x - p.dz * off, p.z + p.dx * off, Math.atan2(p.dx, p.dz) + (rng.next() - .5) * (.2 + st.decay * 1.4), 1, { onRoad: true, margin: .5 });
    }
    for (const b of buildings) if (b.cls === 'military' && rng.next() < .25 * st.propDensity) {
      const lot = b.lot ? lotById.get(b.lot) : undefined;
      if (!lot) continue;
      const item = pick(rng, catalog.props.militaryVehicle), back: Vec2 = [-lot.dir[0], -lot.dir[1]];
      place('militaryVehicle', item, b.obb.x + back[0] * (b.obb.hz + item.d / 2 + 2), b.obb.z + back[1] * (b.obb.hz + item.d / 2 + 2), b.yaw, 1, { margin: .8 });
    }
  }
  // Clutter in yards: crates, barrels, pallets by district; benches in parks; debris where decayed.
  {
    const rng = stream(seed, 'props-clutter');
    for (const lot of lots) {
      const built = builtLots.has(lot.id);
      const kind: PropKind | null = lot.cls === 'industrial' ? 'industrialClutter' : lot.cls === 'military' ? 'militaryClutter' : built && lot.style !== 'full' ? 'clutter' : null;
      if (!kind) continue;
      const count = Math.round(st.propDensity * (kind === 'industrialClutter' || kind === 'militaryClutter' ? 5 : 1.2) * (.5 + rng.next()));
      for (let k = 0; k < count; k++) {
        const u = (rng.next() * 2 - 1) * (lot.obb.hx - 1.5), v = (rng.next() * 2 - 1) * (lot.obb.hz - 1.5), c = Math.cos(lot.obb.yaw), s = Math.sin(lot.obb.yaw);
        place(kind, pick(rng, catalog.props[kind]), lot.obb.x + u * c + v * s, lot.obb.z - u * s + v * c, rng.next() * Math.PI * 2, 1, { margin: .5 });
      }
      if (built && rng.next() < st.decay * .35 * st.propDensity) {
        const u = (rng.next() * 2 - 1) * lot.obb.hx * .8, v = (rng.next() * 2 - 1) * lot.obb.hz * .8, c = Math.cos(lot.obb.yaw), s = Math.sin(lot.obb.yaw);
        place('debris', pick(rng, catalog.props.debris), lot.obb.x + u * c + v * s, lot.obb.z - u * s + v * c, rng.next() * Math.PI * 2, 1, { margin: .5 });
      }
    }
  }
  // Ruins: rubble round the shell and saplings in it; abandoned houses: weeds round the walls.
  {
    const rng = stream(seed, 'props-ruins');
    for (const b of buildings) {
      if (!b.condition) continue;
      const ruined = b.condition === 'ruined', count = ruined ? 3 + rng.int(4) : rng.int(2);
      for (let k = 0; k < count; k++) {
        const a = rng.next() * Math.PI * 2, r = 1 + rng.next() * 2.5, side = rng.next() < .5 ? -1 : 1;
        const u = (b.obb.hx + r) * Math.cos(a) * side, v = (b.obb.hz + r) * Math.sin(a), c = Math.cos(b.yaw), s = Math.sin(b.yaw);
        const x = b.obb.x + u * c + v * s, z = b.obb.z - u * s + v * c;
        const kind: PropKind = ruined && rng.next() < .65 ? 'debris' : rng.next() < .5 ? 'bush' : ruined ? 'deadTree' : 'bush';
        place(kind, pick(rng, catalog.props[kind]), x, z, rng.next() * 6.28, kind === 'bush' ? .6 + rng.next() * .5 : 1, { margin: .3 });
      }
    }
    // Lanes and side streets in decayed quarters: bushes and saplings breaking through the edges.
    for (const r of roads) {
      if (r.kind === 'main' || r.kind === 'connector') continue;
      for (const p of walk(r.points, 5, 2)) {
        const d = decayAt(p.x, p.z).value;
        if (d < .55 || rng.next() > (d - .5) * 1.4) continue;
        const side = rng.next() < .5 ? -1 : 1, off = (r.width / 2 - .4) * side;
        const kind: PropKind = d > .8 && rng.next() < .3 ? 'tree' : 'bush';
        place(kind, pick(rng, catalog.props[kind]), p.x - p.dz * off, p.z + p.dx * off, rng.next() * 6.28, kind === 'tree' ? .5 + rng.next() * .3 : .5 + rng.next() * .4, { onRoad: true, margin: .2 });
      }
    }
  }
  if (props.length >= st.maxProps) issues.push({ severity: 'info', code: 'prop-cap', message: `Đạt giới hạn ${st.maxProps} vật thể phụ.` });

  /* 9. Collisions, access and connectivity, checked independently of how things were placed. */
  yield progress(9);
  const result: SettlementResult = { version: 1, seed, settings: st, analysis, roads, blocks, lots, buildings, props, issues, stats: {}, ...(districts ? { districts } : {}) };
  result.issues = [...issues, ...checkSettlement(result, { ...input, terrain }, roadIndex)];

  /* 10. Summary for review. */
  yield progress(10);
  const count = <T>(list: T[], key: (t: T) => string) => list.reduce<Record<string, number>>((acc, t) => { const k = key(t); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
  result.stats = {
    roads: roads.length, roadLength: Math.round(roads.reduce((s, r) => s + length(r.points), 0)), blocks: blocks.length, lots: lots.length,
    builtLots: buildings.length, buildings: buildings.length, props: props.length, ms: Date.now() - t0,
    ...(districts ? { districts: districts.length } : {}),
    ...Object.fromEntries(Object.entries(count(buildings.filter((b) => b.condition), (b) => b.condition!)).map(([k, v]) => [`c_${k}`, v])),
    ...Object.fromEntries(Object.entries(count(lots.filter((l) => l.use && builtLots.has(l.id)), (l) => l.use!)).map(([k, v]) => [`u_${k}`, v])),
    roadMain: roads.filter((r) => r.kind === 'main').length, roadSecondary: roads.filter((r) => r.kind === 'secondary').length, roadAlley: roads.filter((r) => r.kind === 'alley').length,
    ...Object.fromEntries(Object.entries(count(buildings, (b) => b.cls)).map(([k, v]) => [`b_${k}`, v])),
    ...Object.fromEntries(Object.entries(count(props, (p) => p.kind)).map(([k, v]) => [`p_${k}`, v])),
  };
  if (grading) result.grading = grading;
  return result;
}

/** Overlaps, buildings off the region / on water, door access and street connectivity. */
export function checkSettlement(result: SettlementResult, input: Pick<SettlementInput, 'polygon' | 'terrain' | 'water' | 'seaLevel' | 'externalRoads'>, roads?: RoadIndex): SettlementIssue[] {
  const out: SettlementIssue[] = [];
  const index = roads ?? (() => { const r = new RoadIndex(); for (const x of result.roads) r.add(x); for (const x of input.externalRoads) r.add(x); return r; })();
  const grid = new SpatialGrid<PlacedBuilding & { x: number; z: number }>(32, (b) => obbRadius(b.obb));
  let overlaps = 0, onRoad = 0, outside = 0, wet = 0, noAccess = 0;
  for (const b of result.buildings) {
    const near = grid.query(b.obb.x, b.obb.z, obbRadius(b.obb));
    if (near.some((o) => obbOverlap(o.obb, b.obb))) { overlaps++; out.push({ severity: 'error', code: 'overlap', message: 'Hai công trình chồng lấn nhau.', x: b.obb.x, z: b.obb.z }); }
    grid.insert({ ...b, x: b.obb.x, z: b.obb.z });
    if (index.hits(b.obb, 0)) { onRoad++; out.push({ severity: 'error', code: 'on-road', message: 'Công trình lấn ra mặt đường.', x: b.obb.x, z: b.obb.z }); }
    if (!obbInsidePolygon(b.obb, input.polygon)) { outside++; out.push({ severity: 'error', code: 'outside', message: 'Công trình nằm ngoài vùng.', x: b.obb.x, z: b.obb.z }); }
    if (obbCorners(b.obb).some(([x, z]) => input.terrain.heightAt(x, z) < input.seaLevel + .5 || waterLevelAt(input.terrain, input.water, input.seaLevel, x, z) !== null)) { wet++; out.push({ severity: 'error', code: 'on-water', message: 'Công trình đặt trên mặt nước.', x: b.obb.x, z: b.obb.z }); }
    if (index.edgeDistance(b.door[0], b.door[1], 40) > result.settings.setback + 6) { noAccess++; out.push({ severity: 'warning', code: 'no-access', message: 'Lối vào công trình không thông ra đường.', x: b.door[0], z: b.door[1] }); }
  }
  // Props standing in front of a door block the way in.
  let blockedDoors = 0;
  const propGrid = new SpatialGrid<PlacedProp>(16, (p) => obbRadius(p.obb));
  for (const p of result.props) if (p.kind !== 'tree' && p.kind !== 'bush' && p.kind !== 'deadTree') propGrid.insert(p);
  for (const b of result.buildings) {
    const door: Obb = { x: b.door[0], z: b.door[1], hx: 1, hz: 1, yaw: b.yaw };
    if (propGrid.query(door.x, door.z, 2).some((p) => obbOverlap(p.obb, door))) { blockedDoors++; out.push({ severity: 'warning', code: 'door-blocked', message: 'Vật thể chắn lối vào công trình.', x: door.x, z: door.z }); }
  }
  // Street network: one connected component.
  const parent = result.roads.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < result.roads.length; i++) for (let j = i + 1; j < result.roads.length; j++) {
    const a = result.roads[i]!, b = result.roads[j]!;
    let joined = false;
    for (let p = 1; p < a.points.length && !joined; p++) for (let q = 1; q < b.points.length && !joined; q++) if (segmentIntersection(a.points[p - 1]!, a.points[p]!, b.points[q - 1]!, b.points[q]!)) joined = true;
    if (!joined) for (const [x, z] of [a.points[0]!, a.points[a.points.length - 1]!]) if (distanceToPolyline(x, z, b.points) < b.width / 2 + 1.5) joined = true;
    if (!joined) for (const [x, z] of [b.points[0]!, b.points[b.points.length - 1]!]) if (distanceToPolyline(x, z, a.points) < a.width / 2 + 1.5) joined = true;
    if (joined) parent[find(i)] = find(j);
  }
  const components = new Set(result.roads.map((_, i) => find(i))).size;
  if (components > 1) out.push({ severity: 'warning', code: 'disconnected', message: `Mạng đường bị chia thành ${components} cụm không nối nhau.` });
  out.push({ severity: 'info', code: 'summary', message: `Kiểm tra: ${overlaps} chồng lấn, ${onRoad} lấn đường, ${outside} ngoài vùng, ${wet} trên nước, ${noAccess} thiếu lối vào, ${blockedDoors} cửa bị chắn, ${components} cụm đường.` });
  return out;
}
