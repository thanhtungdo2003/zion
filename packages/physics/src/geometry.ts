import type { BoxShape, CapsuleShape, Contact, SphereShape } from './shapes';

/**
 * Low-level geometric primitives. Hot paths take scalar arguments and write into caller-provided
 * output objects so the per-tick simulation allocates nothing.
 */

export interface MutVec3 {
  x: number;
  y: number;
  z: number;
}

const EPS = 1e-9;

/** Parameter t in [0,1] of the point on segment AB closest to P. */
export function closestTOnSegment(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  px: number,
  py: number,
  pz: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  if (len2 < EPS) return 0;
  const t = ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / len2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export interface SegmentPair {
  s: number;
  t: number;
}

/**
 * Closest points between segments P1Q1 and P2Q2 (Ericson, Real-Time Collision Detection 5.1.9).
 * Writes parameters s (on segment 1) and t (on segment 2).
 */
export function closestSegmentSegment(
  p1x: number,
  p1y: number,
  p1z: number,
  q1x: number,
  q1y: number,
  q1z: number,
  p2x: number,
  p2y: number,
  p2z: number,
  q2x: number,
  q2y: number,
  q2z: number,
  out: SegmentPair,
): void {
  const d1x = q1x - p1x;
  const d1y = q1y - p1y;
  const d1z = q1z - p1z;
  const d2x = q2x - p2x;
  const d2y = q2y - p2y;
  const d2z = q2z - p2z;
  const rx = p1x - p2x;
  const ry = p1y - p2y;
  const rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s: number;
  let t: number;
  if (a <= EPS && e <= EPS) {
    out.s = 0;
    out.t = 0;
    return;
  }
  if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  out.s = s;
  out.t = t;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Closest point on triangle ABC to P (Ericson 5.1.5). */
export function closestPointOnTriangle(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  out: MutVec3,
): void {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    out.x = ax;
    out.y = ay;
    out.z = az;
    return;
  }
  const bpx = px - bx;
  const bpy = py - by;
  const bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    out.x = bx;
    out.y = by;
    out.z = bz;
    return;
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out.x = ax + abx * v;
    out.y = ay + aby * v;
    out.z = az + abz * v;
    return;
  }
  const cpx = px - cx;
  const cpy = py - cy;
  const cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    out.x = cx;
    out.y = cy;
    out.z = cz;
    return;
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out.x = ax + acx * w;
    out.y = ay + acy * w;
    out.z = az + acz * w;
    return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    out.x = bx + (cx - bx) * w;
    out.y = by + (cy - by) * w;
    out.z = bz + (cz - bz) * w;
    return;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  out.x = ax + abx * v + acx * w;
  out.y = ay + aby * v + acy * w;
  out.z = az + abz * v + acz * w;
}

/* ------------------------------------------------------------------------------------------ */
/* Capsule (query) vs primitive contacts                                                       */
/* ------------------------------------------------------------------------------------------ */

const pair: SegmentPair = { s: 0, t: 0 };

function writeContact(out: Contact, nx: number, ny: number, nz: number, depth: number): void {
  out.nx = nx;
  out.ny = ny;
  out.nz = nz;
  out.depth = depth;
}

export function capsuleVsSphere(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r: number,
  s: SphereShape,
  out: Contact,
): boolean {
  const t = closestTOnSegment(ax, ay, az, bx, by, bz, s.cx, s.cy, s.cz);
  const qx = ax + (bx - ax) * t;
  const qy = ay + (by - ay) * t;
  const qz = az + (bz - az) * t;
  return pointsToContact(qx, qy, qz, s.cx, s.cy, s.cz, r + s.r, out);
}

export function capsuleVsCapsule(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r: number,
  c: CapsuleShape,
  out: Contact,
): boolean {
  closestSegmentSegment(ax, ay, az, bx, by, bz, c.ax, c.ay, c.az, c.bx, c.by, c.bz, pair);
  const px = ax + (bx - ax) * pair.s;
  const py = ay + (by - ay) * pair.s;
  const pz = az + (bz - az) * pair.s;
  const qx = c.ax + (c.bx - c.ax) * pair.t;
  const qy = c.ay + (c.by - c.ay) * pair.t;
  const qz = c.az + (c.bz - c.az) * pair.t;
  return pointsToContact(px, py, pz, qx, qy, qz, r + c.r, out);
}

/** Contact between a point P on the query and point Q on the obstacle given combined radius. */
function pointsToContact(
  px: number,
  py: number,
  pz: number,
  qx: number,
  qy: number,
  qz: number,
  radius: number,
  out: Contact,
): boolean {
  const dx = px - qx;
  const dy = py - qy;
  const dz = pz - qz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= radius * radius) return false;
  const d = Math.sqrt(d2);
  if (d > EPS) writeContact(out, dx / d, dy / d, dz / d, radius - d);
  else writeContact(out, 0, 1, 0, radius);
  return true;
}

/**
 * Capsule vs yaw-rotated box. The segment is transformed into box space, then the closest pair
 * (segment point, box point) is found by alternating projection, which converges for convex sets.
 * If the segment passes through the box, the minimum-penetration face axis is used.
 */
export function capsuleVsBox(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r: number,
  box: BoxShape,
  out: Contact,
): boolean {
  const c = box.cos;
  const s = box.sin;
  let dx = ax - box.cx;
  let dz = az - box.cz;
  const lax = dx * c - dz * s;
  const laz = dx * s + dz * c;
  const lay = ay - box.cy;
  dx = bx - box.cx;
  dz = bz - box.cz;
  const lbx = dx * c - dz * s;
  const lbz = dx * s + dz * c;
  const lby = by - box.cy;

  let t = closestTOnSegment(lax, lay, laz, lbx, lby, lbz, 0, 0, 0);
  let px = 0;
  let py = 0;
  let pz = 0;
  let qx = 0;
  let qy = 0;
  let qz = 0;
  for (let k = 0; k < 10; k++) {
    px = lax + (lbx - lax) * t;
    py = lay + (lby - lay) * t;
    pz = laz + (lbz - laz) * t;
    qx = px < -box.hx ? -box.hx : px > box.hx ? box.hx : px;
    qy = py < -box.hy ? -box.hy : py > box.hy ? box.hy : py;
    qz = pz < -box.hz ? -box.hz : pz > box.hz ? box.hz : pz;
    const nt = closestTOnSegment(lax, lay, laz, lbx, lby, lbz, qx, qy, qz);
    if (Math.abs(nt - t) < 1e-7) break;
    t = nt;
  }
  px = lax + (lbx - lax) * t;
  py = lay + (lby - lay) * t;
  pz = laz + (lbz - laz) * t;
  qx = px < -box.hx ? -box.hx : px > box.hx ? box.hx : px;
  qy = py < -box.hy ? -box.hy : py > box.hy ? box.hy : py;
  qz = pz < -box.hz ? -box.hz : pz > box.hz ? box.hz : pz;

  let lnx: number;
  let lny: number;
  let lnz: number;
  let depth: number;
  const ex = px - qx;
  const ey = py - qy;
  const ez = pz - qz;
  const d2 = ex * ex + ey * ey + ez * ez;
  if (d2 > 1e-12) {
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2);
    lnx = ex / d;
    lny = ey / d;
    lnz = ez / d;
    depth = r - d;
  } else {
    const penX = box.hx - Math.abs(px);
    const penY = box.hy - Math.abs(py);
    const penZ = box.hz - Math.abs(pz);
    lnx = 0;
    lny = 0;
    lnz = 0;
    if (penY <= penX && penY <= penZ) {
      lny = py >= 0 ? 1 : -1;
      depth = penY + r;
    } else if (penX <= penZ) {
      lnx = px >= 0 ? 1 : -1;
      depth = penX + r;
    } else {
      lnz = pz >= 0 ? 1 : -1;
      depth = penZ + r;
    }
  }
  writeContact(out, lnx * c + lnz * s, lny, -lnx * s + lnz * c, depth);
  return true;
}

/* ------------------------------------------------------------------------------------------ */
/* Ray tests. Direction (dx,dy,dz) must be normalised. Return t >= 0 or -1 on miss.            */
/* ------------------------------------------------------------------------------------------ */

export function raySphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
): number {
  const ocx = ox - cx;
  const ocy = oy - cy;
  const ocz = oz - cz;
  const b = ocx * dx + ocy * dy + ocz * dz;
  const c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
  if (c <= 0) return 0; // origin inside
  const h = b * b - c;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : -1;
}

/** Ray vs capsule (after Inigo Quilez). */
export function rayCapsule(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cap: CapsuleShape,
): number {
  const bax = cap.bx - cap.ax;
  const bay = cap.by - cap.ay;
  const baz = cap.bz - cap.az;
  const oax = ox - cap.ax;
  const oay = oy - cap.ay;
  const oaz = oz - cap.az;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  // Origin inside?
  const tIn = closestTOnSegment(cap.ax, cap.ay, cap.az, cap.bx, cap.by, cap.bz, ox, oy, oz);
  const ix = cap.ax + bax * tIn - ox;
  const iy = cap.ay + bay * tIn - oy;
  const iz = cap.az + baz * tIn - oz;
  if (ix * ix + iy * iy + iz * iz <= cap.r * cap.r) return 0;

  const a = baba - bard * bard;
  if (a > 1e-9) {
    const b = baba * rdoa - baoa * bard;
    const c = baba * oaoa - baoa * baoa - cap.r * cap.r * baba;
    const h = b * b - a * c;
    if (h < 0) return -1;
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 ? t : -1;
  }
  const t1 = raySphere(ox, oy, oz, dx, dy, dz, cap.ax, cap.ay, cap.az, cap.r);
  const t2 = raySphere(ox, oy, oz, dx, dy, dz, cap.bx, cap.by, cap.bz, cap.r);
  if (t1 < 0) return t2;
  if (t2 < 0) return t1;
  return Math.min(t1, t2);
}

/** Ray vs yaw-rotated box; writes the world-space entry normal. */
export function rayBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  box: BoxShape,
  outNormal: MutVec3,
): number {
  const c = box.cos;
  const s = box.sin;
  const rx = ox - box.cx;
  const rz = oz - box.cz;
  const lo = [rx * c - rz * s, oy - box.cy, rx * s + rz * c] as const;
  const ld = [dx * c - dz * s, dy, dx * s + dz * c] as const;
  const h = [box.hx, box.hy, box.hz] as const;
  let tNear = -Infinity;
  let tFar = Infinity;
  let axis = -1;
  let sign = 0;
  for (let i = 0; i < 3; i++) {
    const o = lo[i]!;
    const d = ld[i]!;
    const e = h[i]!;
    if (Math.abs(d) < 1e-12) {
      if (o < -e || o > e) return -1;
      continue;
    }
    let t1 = (-e - o) / d;
    let t2 = (e - o) / d;
    let sg = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      sg = 1;
    }
    if (t1 > tNear) {
      tNear = t1;
      axis = i;
      sign = sg;
    }
    if (t2 < tFar) tFar = t2;
    if (tNear > tFar || tFar < 0) return -1;
  }
  if (tNear < 0) {
    // Origin inside the box.
    outNormal.x = -dx;
    outNormal.y = -dy;
    outNormal.z = -dz;
    return 0;
  }
  const lnx = axis === 0 ? sign : 0;
  const lny = axis === 1 ? sign : 0;
  const lnz = axis === 2 ? sign : 0;
  outNormal.x = lnx * c + lnz * s;
  outNormal.y = lny;
  outNormal.z = -lnx * s + lnz * c;
  return tNear;
}

/** Möller–Trumbore, double-sided. */
export function rayTriangle(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): number {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det;
  const tx = ox - ax;
  const ty = oy - ay;
  const tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t >= 0 ? t : -1;
}

/** Ray vs sphere/capsule normal helper: normalised (P - closest point on core). */
export function sphereNormal(px: number, py: number, pz: number, cx: number, cy: number, cz: number, out: MutVec3): void {
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < EPS) {
    out.x = 0;
    out.y = 1;
    out.z = 0;
  } else {
    out.x = dx / len;
    out.y = dy / len;
    out.z = dz / len;
  }
}
