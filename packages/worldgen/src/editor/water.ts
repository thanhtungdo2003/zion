import { smoothstep } from '@zion/shared';
import { distanceToPolygonEdge, pointInPolygon, type Vec2 } from './geometry';
import { type CellRect, type Heightfield, unionRect } from './heightfield';

/** A lake: its shore polygon and the water surface height (m). Stored apart from the terrain. */
export interface Lake { id: string; name: string; polygon: Vec2[]; level: number; depth: number }
/** A river from source (first point) to mouth; widths per point (m). */
export interface RiverPoint { x: number; z: number; width: number }
export interface River { id: string; name: string; points: RiverPoint[]; depth: number; levels?: number[] }
export interface WaterData { lakes: Lake[]; rivers: River[] }

export const emptyWater = (): WaterData => ({ lakes: [], rivers: [] });

/** The lowest ground on a lake's shore: water above it would spill out. */
export function lakeSpillLevel(hf: Heightfield, lake: Pick<Lake, 'polygon'>): number {
  let min = Infinity;
  const p = lake.polygon;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!, n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / hf.cell));
    for (let k = 0; k < n; k++) min = Math.min(min, hf.heightAt(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n));
  }
  return min;
}

/**
 * Water surface heights along a river: never rising downstream, at least `minDrop` per 100 m,
 * and below the lowest ground across its bed so it sits in a channel instead of on a hill.
 */
export function riverLevels(hf: Heightfield, river: River, minDrop = .05): number[] {
  const out: number[] = [];
  const pts = river.points;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, prev = pts[Math.max(0, i - 1)]!, next = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = next.x - prev.x, dz = next.z - prev.z, len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len;
    let ground = Infinity;
    for (const t of [-.5, -.25, 0, .25, .5]) ground = Math.min(ground, hf.heightAt(p.x + nx * p.width * t, p.z + nz * p.width * t));
    let level = ground - .4;
    if (i > 0) {
      const run = Math.hypot(p.x - pts[i - 1]!.x, p.z - pts[i - 1]!.z);
      level = Math.min(level, out[i - 1]! - run * minDrop / 100);
    }
    out.push(level);
  }
  return out;
}

/** Steepest drop along the river, % (for validation: rapids above ~8 % look wrong). */
export function riverMaxGrade(river: River, levels: number[]): number {
  let max = 0;
  for (let i = 1; i < river.points.length; i++) {
    const a = river.points[i - 1]!, b = river.points[i]!, run = Math.hypot(b.x - a.x, b.z - a.z);
    if (run > 0) max = Math.max(max, (levels[i - 1]! - levels[i]!) / run * 100);
  }
  return max;
}

/** Nearest point on a river: distance, interpolated width, level and position along it. */
export function riverProbe(river: River, levels: number[], x: number, z: number): { distance: number; width: number; level: number } {
  let best = { distance: Infinity, width: 0, level: 0 };
  for (let i = 1; i < river.points.length; i++) {
    const a = river.points[i - 1]!, b = river.points[i]!;
    const dx = b.x - a.x, dz = b.z - a.z, len = dx * dx + dz * dz;
    const t = len ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len)) : 0;
    const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (d < best.distance) best = { distance: d, width: a.width + (b.width - a.width) * t, level: levels[i - 1]! + (levels[i]! - levels[i - 1]!) * t };
  }
  return best;
}

/** Cuts the river bed and its banks into the terrain. Returns the cells changed. */
export function carveRiver(hf: Heightfield, river: River): { rect: CellRect | null; levels: number[] } {
  const levels = riverLevels(hf, river);
  let rect: CellRect | null = null;
  const maxW = Math.max(...river.points.map((p) => p.width)), bank = Math.max(6, maxW * .8);
  for (let i = 1; i < river.points.length; i++) {
    const a = river.points[i - 1]!, b = river.points[i]!, pad = maxW / 2 + bank;
    const r = hf.rectAround((a.x + b.x) / 2, (a.z + b.z) / 2, Math.hypot(b.x - a.x, b.z - a.z) / 2 + pad);
    rect = unionRect(rect, r);
  }
  if (!rect) return { rect, levels };
  for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
    const x = i * hf.cell, z = j * hf.cell, p = riverProbe(river, levels, x, z), half = p.width / 2;
    if (p.distance > half + bank) continue;
    const k = j * hf.cols + i;
    // Parabolic bed inside the channel, then a bank rising to meet the ground.
    const target = p.distance < half ? p.level - river.depth * (1 - (p.distance / half) ** 2) - .2 : p.level + .4 + (p.distance - half) * .35;
    const w = p.distance < half ? 1 : 1 - smoothstep(half, half + bank, p.distance);
    if (hf.heights[k]! > target) hf.heights[k] = hf.heights[k]! + (target - hf.heights[k]!) * w;
  }
  return { rect, levels };
}

/** Deepens the ground under a lake so its bed is below the water everywhere. */
export function carveLake(hf: Heightfield, lake: Lake): CellRect | null {
  const xs = lake.polygon.map((p) => p[0]), zs = lake.polygon.map((p) => p[1]);
  const rect: CellRect = { i0: hf.clampI(Math.floor(Math.min(...xs) / hf.cell)), i1: hf.clampI(Math.ceil(Math.max(...xs) / hf.cell)), j0: hf.clampJ(Math.floor(Math.min(...zs) / hf.cell)), j1: hf.clampJ(Math.ceil(Math.max(...zs) / hf.cell)) };
  for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
    const x = i * hf.cell, z = j * hf.cell;
    if (!pointInPolygon(x, z, lake.polygon)) continue;
    const edge = distanceToPolygonEdge(x, z, lake.polygon);
    const target = lake.level - .3 - lake.depth * smoothstep(0, 40, edge);
    const k = j * hf.cols + i;
    if (hf.heights[k]! > target) hf.heights[k] = target;
  }
  return rect;
}

/** Water surface at a point (sea, lake or river), or null on dry ground. */
export function waterLevelAt(hf: Heightfield, water: WaterData, seaLevel: number, x: number, z: number): number | null {
  const ground = hf.heightAt(x, z);
  if (ground < seaLevel) return seaLevel;
  for (const lake of water.lakes) if (pointInPolygon(x, z, lake.polygon) && ground < lake.level) return lake.level;
  for (const river of water.rivers) {
    const levels = river.levels ?? riverLevels(hf, river), p = riverProbe(river, levels, x, z);
    if (p.distance <= p.width / 2) return p.level;
  }
  return null;
}

/** Distance from a point to the nearest lake or river edge (Infinity if none). */
export function waterClearance(water: WaterData, x: number, z: number): number {
  let best = Infinity;
  for (const lake of water.lakes) best = Math.min(best, pointInPolygon(x, z, lake.polygon) ? 0 : distanceToPolygonEdge(x, z, lake.polygon));
  for (const river of water.rivers) {
    const p = riverProbe(river, river.levels ?? river.points.map(() => 0), x, z);
    best = Math.min(best, Math.max(0, p.distance - p.width / 2));
  }
  return best;
}
