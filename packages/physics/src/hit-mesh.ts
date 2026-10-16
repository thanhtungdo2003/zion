/**
 * Precise shot geometry: a model's own triangles in a bounding-volume hierarchy, so a bullet that
 * touches a prop's coarse collider is re-tested against the actual surfaces (windows, gaps
 * between planks, lattice towers, branches stay open).
 */

/** Where one placed prop's model sits: translate, yaw (three.js convention), uniform scale. */
export interface HitRef {
  /** Asset id of the model. */
  readonly mesh: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly c: number;
  readonly s: number;
  readonly k: number;
  /** Per-raycast memo (stamp, result). */
  stamp?: number;
  t?: number;
  nx?: number;
  ny?: number;
  nz?: number;
}

interface Node { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number; left: Node | null; right: Node | null; tris: number[] }

const LEAF = 6;

/** Model triangles, with texture alpha for see-through faces (see @zion/assets HitMeshData). */
export interface HitMeshSource {
  tris: Float32Array;
  uvs?: Float32Array;
  maskOf?: Int16Array;
  masks?: ReadonlyArray<{ w: number; h: number; bits: Uint8Array }>;
}

export class HitMesh {
  private readonly root: Node | null;
  private readonly v: Float32Array;
  constructor(private readonly src: HitMeshSource) {
    this.v = src.tris;
    const count = Math.floor(this.v.length / 9);
    const ids = Array.from({ length: count }, (_, i) => i);
    this.root = count ? this.build(ids) : null;
  }

  private build(ids: number[]): Node {
    const v = this.v;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const t of ids) for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3, x = v[o]!, y = v[o + 1]!, z = v[o + 2]!;
      if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
    }
    const node: Node = { minX, minY, minZ, maxX, maxY, maxZ, left: null, right: null, tris: [] };
    if (ids.length <= LEAF) { node.tris = ids; return node; }
    // Split at the median centroid along the longest axis.
    const ex = maxX - minX, ey = maxY - minY, ez = maxZ - minZ, axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const centre = (t: number) => (v[t * 9 + axis]! + v[t * 9 + 3 + axis]! + v[t * 9 + 6 + axis]!);
    ids.sort((a, b) => centre(a) - centre(b));
    const mid = ids.length >> 1;
    node.left = this.build(ids.slice(0, mid));
    node.right = this.build(ids.slice(mid));
    return node;
  }

  /** Is the texture opaque at barycentric (u, w) of triangle `t`? Faces without a mask are solid. */
  private solidAt(t: number, u: number, w: number): boolean {
    const m = this.src.maskOf?.[t] ?? -1;
    if (m < 0) return true;
    const mask = this.src.masks![m]!, uv = this.src.uvs!, o = t * 6, a = 1 - u - w;
    let s = uv[o]! * a + uv[o + 2]! * u + uv[o + 4]! * w, q = uv[o + 1]! * a + uv[o + 3]! * u + uv[o + 5]! * w;
    s -= Math.floor(s); q -= Math.floor(q);
    const x = Math.min(mask.w - 1, Math.floor(s * mask.w)), y = Math.min(mask.h - 1, Math.floor(q * mask.h)), i = y * mask.w + x;
    return (mask.bits[i >> 3]! & (1 << (i & 7))) !== 0;
  }

  /** Nearest hit of a local-space ray within maxT: t (or −1) and the face normal in `n`. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, n: { x: number; y: number; z: number }): number {
    if (!this.root) return -1;
    let best = maxT, hit = -1;
    const v = this.v, ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const stack: Node[] = [this.root];
    while (stack.length) {
      const node = stack.pop()!;
      // Slab test against the node box.
      let t0 = (node.minX - ox) * ix, t1 = (node.maxX - ox) * ix;
      let lo = Math.min(t0, t1), hi = Math.max(t0, t1);
      t0 = (node.minY - oy) * iy; t1 = (node.maxY - oy) * iy;
      lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
      t0 = (node.minZ - oz) * iz; t1 = (node.maxZ - oz) * iz;
      lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
      if (!(hi >= Math.max(lo, 0)) || lo > best) continue;
      if (node.left) { stack.push(node.left, node.right!); continue; }
      for (const t of node.tris) {
        const o = t * 9;
        const ax = v[o]!, ay = v[o + 1]!, az = v[o + 2]!;
        const e1x = v[o + 3]! - ax, e1y = v[o + 4]! - ay, e1z = v[o + 5]! - az;
        const e2x = v[o + 6]! - ax, e2y = v[o + 7]! - ay, e2z = v[o + 8]! - az;
        // Möller–Trumbore, both faces count.
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det, sx = ox - ax, sy = oy - ay, sz = oz - az;
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const w = (dx * qx + dy * qy + dz * qz) * inv;
        if (w < 0 || u + w > 1) continue;
        const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (d < 0 || d >= best) continue;
        // See-through texel (fence gaps, grates, leaves): the shot passes.
        if (!this.solidAt(t, u, w)) continue;
        best = d; hit = d;
        let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        // Face the shooter.
        if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; }
        n.x = nx; n.y = ny; n.z = nz;
      }
    }
    return hit;
  }
}

/**
 * Ray against a placed model in world space (direction normalised): world t or −1, world
 * normal in `n`.
 */
export function raycastHitRef(mesh: HitMesh, ref: HitRef, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, n: { x: number; y: number; z: number }): number {
  // World → local: translate, unrotate (inverse of three.js yaw), unscale.
  const rx = ox - ref.x, ry = oy - ref.y, rz = oz - ref.z, k = ref.k;
  const lx = (rx * ref.c - rz * ref.s) / k, ly = ry / k, lz = (rx * ref.s + rz * ref.c) / k;
  const ldx = (dx * ref.c - dz * ref.s) / k, ldy = dy / k, ldz = (dx * ref.s + dz * ref.c) / k;
  // Local t equals world t (direction scaled by 1/k along with the origin).
  const t = mesh.raycast(lx, ly, lz, ldx, ldy, ldz, maxT, n);
  if (t < 0) return -1;
  const nx = n.x, nz = n.z;
  n.x = nx * ref.c + nz * ref.s; n.z = -nx * ref.s + nz * ref.c;
  return t;
}
