/** Planar geometry for the world editor: polygons, segments, oriented boxes and a spatial grid. */

export type Vec2 = [number, number];

export function polygonArea(poly: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j]![0] * poly[i]![1]) - (poly[i]![0] * poly[j]![1]);
  return a / 2;
}

export function polygonCentroid(poly: readonly Vec2[]): Vec2 {
  const area = polygonArea(poly);
  if (Math.abs(area) < 1e-9) {
    const n = poly.length || 1;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0, cz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j]![0] * poly[i]![1] - poly[i]![0] * poly[j]![1];
    cx += (poly[j]![0] + poly[i]![0]) * f; cz += (poly[j]![1] + poly[i]![1]) * f;
  }
  return [cx / (6 * area), cz / (6 * area)];
}

export function pointInPolygon(x: number, z: number, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j]!, [bx, bz] = poly[i]!;
    if ((bz > z) !== (az > z) && x < (ax - bx) * (z - bz) / (az - bz) + bx) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(x: number, z: number, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = dx * dx + dz * dz;
  const t = len ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / len)) : 0;
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}

export function distanceToPolyline(x: number, z: number, line: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, distanceToSegment(x, z, line[i - 1]!, line[i]!));
  return best;
}

/** Distance to the polygon outline (sign ignored). */
export function distanceToPolygonEdge(x: number, z: number, poly: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) best = Math.min(best, distanceToSegment(x, z, poly[j]!, poly[i]!));
  return best;
}

/** Proper intersection of segments ab and cd: the parameter along ab, or null. */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { t: number; u: number; x: number; z: number } | null {
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0], qz = c[1] - a[1];
  const t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, x: a[0] + rx * t, z: a[1] + rz * t };
}

/** True when no two non-adjacent edges cross. */
export function isSimplePolygon(poly: readonly Vec2[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!, b = poly[(i + 1) % n]!;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) return false;
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const hit = segmentIntersection(a, b, poly[j]!, poly[(j + 1) % n]!);
      if (hit && hit.t > 1e-9 && hit.t < 1 - 1e-9) return false;
    }
  }
  return true;
}

/**
 * Sutherland–Hodgman: the part of `subject` inside the half-plane left of a→b (for a
 * counter-clockwise clip window, "left" is inside). Works for concave subjects.
 */
function clipHalfPlane(subject: readonly Vec2[], a: Vec2, b: Vec2, keepLeft: boolean): Vec2[] {
  const side = (p: Vec2) => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * (keepLeft ? 1 : -1);
  const out: Vec2[] = [];
  for (let i = 0; i < subject.length; i++) {
    const cur = subject[i]!, prev = subject[(i + subject.length - 1) % subject.length]!;
    const sc = side(cur), sp = side(prev);
    if (sc >= 0) {
      if (sp < 0) out.push(lerpCross(prev, cur, sp, sc));
      out.push(cur);
    } else if (sp >= 0) out.push(lerpCross(prev, cur, sp, sc));
  }
  return out;
}
const lerpCross = (p: Vec2, q: Vec2, sp: number, sq: number): Vec2 => {
  const t = sp / (sp - sq);
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
};

/** `subject` clipped to a convex window (any winding). */
export function clipToConvex(subject: readonly Vec2[], window: readonly Vec2[]): Vec2[] {
  const ccw = polygonArea(window) > 0;
  let out: Vec2[] = [...subject];
  for (let i = 0; i < window.length && out.length; i++) out = clipHalfPlane(out, window[i]!, window[(i + 1) % window.length]!, ccw);
  return out;
}

/** Splits a line (a→b) into the pieces inside `poly`. */
export function clipLineToPolygon(a: Vec2, b: Vec2, poly: readonly Vec2[]): Array<[Vec2, Vec2]> {
  const ts = [0, 1];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const hit = segmentIntersection(a, b, poly[j]!, poly[i]!);
    if (hit) ts.push(hit.t);
  }
  ts.sort((p, q) => p - q);
  const out: Array<[Vec2, Vec2]> = [];
  const at = (t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  for (let i = 1; i < ts.length; i++) {
    const t0 = ts[i - 1]!, t1 = ts[i]!;
    if (t1 - t0 < 1e-6) continue;
    const mid = at((t0 + t1) / 2);
    if (pointInPolygon(mid[0], mid[1], poly)) out.push([at(t0), at(t1)]);
  }
  return out;
}

/** Principal axis angle of a point cloud (radians), from its covariance. */
export function principalAngle(points: readonly Vec2[]): number {
  const n = points.length || 1;
  const mx = points.reduce((s, p) => s + p[0], 0) / n, mz = points.reduce((s, p) => s + p[1], 0) / n;
  let xx = 0, zz = 0, xz = 0;
  for (const [x, z] of points) { xx += (x - mx) ** 2; zz += (z - mz) ** 2; xz += (x - mx) * (z - mz); }
  return 0.5 * Math.atan2(2 * xz, xx - zz);
}

/** Convex hull (Andrew's monotone chain), counter-clockwise. */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [], upper: Vec2[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Densifies polygon edges so every edge is at most `step` long (for a smoother point cloud). */
export function densify(poly: readonly Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}

/* ------------------------------------------------------------------------- oriented boxes */

/** An oriented rectangle: centre, half extents along its local axes, and yaw (three.js rotation.y). */
export interface Obb { x: number; z: number; hx: number; hz: number; yaw: number }

/** Local (u, v) → world, using three.js' rotation.y convention. */
export function obbCorners(b: Obb): Vec2[] {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([u, v]) => {
    const lx = u * b.hx, lz = v * b.hz;
    return [b.x + lx * c + lz * s, b.z - lx * s + lz * c] as Vec2;
  });
}

export function obbRadius(b: Obb): number { return Math.hypot(b.hx, b.hz); }

/** Separating axis test between two oriented rectangles, with an extra clearance margin. */
export function obbOverlap(a: Obb, b: Obb, margin = 0): boolean {
  if (Math.hypot(a.x - b.x, a.z - b.z) > obbRadius(a) + obbRadius(b) + margin) return false;
  const axes: Vec2[] = [];
  for (const o of [a, b]) { const c = Math.cos(o.yaw), s = Math.sin(o.yaw); axes.push([c, -s], [s, c]); }
  const ca = obbCorners(a), cb = obbCorners(b);
  for (const [ax, az] of axes) {
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const p of ca) { const d = p[0] * ax + p[1] * az; minA = Math.min(minA, d); maxA = Math.max(maxA, d); }
    for (const p of cb) { const d = p[0] * ax + p[1] * az; minB = Math.min(minB, d); maxB = Math.max(maxB, d); }
    if (maxA + margin <= minB || maxB + margin <= minA) return false;
  }
  return true;
}

/** True when every corner of the box lies inside the polygon (and no edge crosses it). */
export function obbInsidePolygon(b: Obb, poly: readonly Vec2[]): boolean {
  const corners = obbCorners(b);
  if (!corners.every((p) => pointInPolygon(p[0], p[1], poly))) return false;
  for (let i = 0; i < 4; i++) {
    const p = corners[i]!, q = corners[(i + 1) % 4]!;
    for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) if (segmentIntersection(p, q, poly[j]!, poly[k]!)) return false;
  }
  return true;
}

/* --------------------------------------------------------------------------- spatial grid */

/** Uniform hash grid of items with a bounding radius: cheap neighbour queries for collision. */
export class SpatialGrid<T extends { x: number; z: number }> {
  private readonly cells = new Map<number, T[]>();
  readonly items: T[] = [];
  constructor(private readonly cell: number, private readonly radiusOf: (item: T) => number) {}
  private key(i: number, j: number): number { return (i + 32768) * 65536 + (j + 32768); }
  insert(item: T): void {
    this.items.push(item);
    const r = this.radiusOf(item);
    for (let i = Math.floor((item.x - r) / this.cell); i <= Math.floor((item.x + r) / this.cell); i++)
      for (let j = Math.floor((item.z - r) / this.cell); j <= Math.floor((item.z + r) / this.cell); j++) {
        const k = this.key(i, j);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, list = []);
        list.push(item);
      }
  }
  /** Items whose bounding circle may reach within `radius` of (x, z). */
  query(x: number, z: number, radius: number): T[] {
    const seen = new Set<T>(), out: T[] = [];
    for (let i = Math.floor((x - radius) / this.cell); i <= Math.floor((x + radius) / this.cell); i++)
      for (let j = Math.floor((z - radius) / this.cell); j <= Math.floor((z + radius) / this.cell); j++) {
        for (const item of this.cells.get(this.key(i, j)) ?? []) {
          if (seen.has(item)) continue;
          seen.add(item);
          if (Math.hypot(item.x - x, item.z - z) <= radius + this.radiusOf(item)) out.push(item);
        }
      }
    return out;
  }
}
