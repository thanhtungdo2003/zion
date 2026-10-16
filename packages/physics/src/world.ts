import { CHUNK_SIZE, chunkKey } from '@zion/shared';
import {
  capsuleVsBox,
  capsuleVsCapsule,
  capsuleVsSphere,
  closestPointOnTriangle,
  rayBox,
  rayCapsule,
  raySphere,
  rayTriangle,
  sphereNormal,
  type MutVec3,
} from './geometry';
import type { Heightfield } from './heightfield';
import { Layer } from './layers';
import {
  makeContact,
  shapeAABB,
  emptyAABB,
  type AABB,
  type Collider,
  type ColliderShape,
  type Contact,
  type RayHit,
} from './shapes';
import { SpatialHash, traverseGrid2D } from './spatial-hash';
import { HitMesh, raycastHitRef, type HitRef } from './hit-mesh';

export interface CollisionWorldOptions {
  /** World extent in metres along X and Z (world spans [0, size)). */
  worldSize: number;
  seaLevel: number;
  /** Broadphase cell size for static colliders. */
  staticCellSize?: number;
}

export interface ColliderInit {
  shape: ColliderShape;
  layer: number;
  tag?: number;
  /** Placed model for precise shot tests (see HitMesh). */
  hit?: HitRef;
}

const MAX_CONTACTS = 64;
const MAX_QUERY = 512;

/**
 * Authoritative collision world: chunked heightfield terrain + broadphase-indexed static colliders.
 * Pure data + queries; it knows nothing about rendering. Used identically by the server simulation
 * and by client-side prediction.
 */
export class CollisionWorld {
  readonly worldSize: number;
  readonly seaLevel: number;
  private readonly terrain = new Map<number, Heightfield>();
  private readonly chunkColliders = new Map<number, Collider[]>();
  private readonly ownerColliders = new Map<number, Collider[]>();
  private readonly statics: SpatialHash;
  private nextId = 1;

  private readonly queryBuf: Collider[] = new Array<Collider>(MAX_QUERY);
  private readonly tmpAabb: AABB = emptyAABB();
  private readonly tmpVec: MutVec3 = { x: 0, y: 0, z: 0 };
  private readonly tmpNormal: MutVec3 = { x: 0, y: 0, z: 0 };
  private readonly tmpContact: Contact = makeContact();

  constructor(opts: CollisionWorldOptions) {
    this.worldSize = opts.worldSize;
    this.seaLevel = opts.seaLevel;
    this.statics = new SpatialHash(opts.staticCellSize ?? 8);
  }

  /* -------------------------------- chunk management -------------------------------------- */

  addChunk(cx: number, cz: number, hf: Heightfield, colliders: readonly ColliderInit[]): void {
    if (hf.cellSize !== 1) throw new Error('collision terrain requires LOD 0 (1 m) heightfields');
    const key = chunkKey(cx, cz);
    this.removeChunk(cx, cz);
    this.terrain.set(key, hf);
    const list: Collider[] = [];
    for (const init of colliders) list.push(this.createCollider(init, key));
    this.chunkColliders.set(key, list);
  }

  removeChunk(cx: number, cz: number): boolean {
    const key = chunkKey(cx, cz);
    const had = this.terrain.delete(key);
    const list = this.chunkColliders.get(key);
    if (list) {
      for (const c of list) this.statics.remove(c);
      this.chunkColliders.delete(key);
    }
    return had;
  }

  hasChunk(cx: number, cz: number): boolean {
    return this.terrain.has(chunkKey(cx, cz));
  }

  /** The loaded terrain patch of a chunk, if any (e.g. to mirror into another physics engine). */
  terrainChunk(cx: number, cz: number): Heightfield | undefined {
    return this.terrain.get(chunkKey(cx, cz));
  }

  get chunkCount(): number {
    return this.terrain.size;
  }

  /** Adds colliders owned by a dynamic object (e.g. a placed structure); replaces previous ones. */
  setOwnerColliders(owner: number, colliders: readonly ColliderInit[]): void {
    this.removeOwnerColliders(owner);
    const list = colliders.map((c) => this.createCollider(c, owner));
    this.ownerColliders.set(owner, list);
  }

  removeOwnerColliders(owner: number): void {
    const list = this.ownerColliders.get(owner);
    if (!list) return;
    for (const c of list) this.statics.remove(c);
    this.ownerColliders.delete(owner);
  }

  private createCollider(init: ColliderInit, owner: number): Collider {
    const c: Collider = {
      id: this.nextId++,
      shape: init.shape,
      layer: init.layer,
      aabb: shapeAABB(init.shape),
      owner,
      tag: init.tag ?? 0,
      ...(init.hit ? { hit: init.hit } : {}),
      stamp: 0,
    };
    this.statics.insert(c);
    return c;
  }

  /* ----------------------------------- terrain -------------------------------------------- */

  private heightfieldAt(x: number, z: number): Heightfield | undefined {
    return this.terrain.get(chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)));
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.worldSize && z < this.worldSize;
  }

  /** True when terrain for every chunk overlapping the XZ rectangle is loaded. */
  isAreaLoaded(minX: number, minZ: number, maxX: number, maxZ: number): boolean {
    const x0 = Math.floor(minX / CHUNK_SIZE);
    const x1 = Math.floor(maxX / CHUNK_SIZE);
    const z0 = Math.floor(minZ / CHUNK_SIZE);
    const z1 = Math.floor(maxZ / CHUNK_SIZE);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        if (!this.terrain.has(chunkKey(cx, cz))) return false;
      }
    }
    return true;
  }

  /** Terrain height at (x, z), or NaN when that chunk is not loaded. */
  terrainHeight(x: number, z: number): number {
    const hf = this.heightfieldAt(x, z);
    return hf ? hf.heightAt(x, z) : Number.NaN;
  }

  terrainNormal(x: number, z: number, out: MutVec3): boolean {
    const hf = this.heightfieldAt(x, z);
    if (!hf) return false;
    hf.normalAt(x, z, out);
    return true;
  }

  /** Inland water surface if it lies above the terrain here, else NaN. */
  inlandWaterLevel(x: number, z: number): number {
    const hf = this.heightfieldAt(x, z);
    if (!hf) return Number.NaN;
    const w = hf.waterAt(x, z);
    return w === w && w > hf.heightAt(x, z) ? w : Number.NaN;
  }

  /** Effective water surface (sea or inland, whichever is higher). */
  waterLevel(x: number, z: number): number {
    const w = this.inlandWaterLevel(x, z);
    return w === w && w > this.seaLevel ? w : this.seaLevel;
  }

  /**
   * Calls `visit` for every terrain triangle whose cell overlaps the XZ rectangle.
   * Returns false if any required chunk is missing.
   */
  private forEachTerrainTriangle(
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
    visit: (
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number,
    ) => void,
  ): void {
    const x0 = Math.floor(minX);
    const x1 = Math.floor(maxX);
    const z0 = Math.floor(minZ);
    const z1 = Math.floor(maxZ);
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const hf = this.heightfieldAt(gx + 0.5, gz + 0.5);
        if (!hf) continue;
        const s = hf.cellSize;
        const i = Math.floor((gx - hf.originX) / s);
        const j = Math.floor((gz - hf.originZ) / s);
        if (i < 0 || j < 0 || i >= hf.verts - 1 || j >= hf.verts - 1) continue;
        const wx0 = hf.originX + i * s;
        const wz0 = hf.originZ + j * s;
        const wx1 = wx0 + s;
        const wz1 = wz0 + s;
        const h00 = hf.h(i, j);
        const h10 = hf.h(i + 1, j);
        const h01 = hf.h(i, j + 1);
        const h11 = hf.h(i + 1, j + 1);
        visit(wx0, h00, wz0, wx1, h11, wz1, wx1, h10, wz0);
        visit(wx0, h00, wz0, wx0, h01, wz1, wx1, h11, wz1);
      }
    }
  }

  /* ----------------------------------- contacts ------------------------------------------- */

  /**
   * Collects penetration contacts between capsule (segment AB, radius r) and world geometry
   * matching `mask`. Returns the number of contacts written to `out`.
   */
  capsuleContacts(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    r: number,
    mask: number,
    out: Contact[],
  ): number {
    let n = 0;
    if (mask & Layer.Terrain) n = this.capsuleTerrainContacts(ax, ay, az, bx, by, bz, r, out, n);
    const aabb = this.tmpAabb;
    aabb.minX = Math.min(ax, bx) - r;
    aabb.minY = Math.min(ay, by) - r;
    aabb.minZ = Math.min(az, bz) - r;
    aabb.maxX = Math.max(ax, bx) + r;
    aabb.maxY = Math.max(ay, by) + r;
    aabb.maxZ = Math.max(az, bz) + r;
    const count = this.statics.query(aabb, mask & ~Layer.Terrain, this.queryBuf);
    for (let i = 0; i < count && n < MAX_CONTACTS; i++) {
      const col = this.queryBuf[i]!;
      const c = out[n] ?? (out[n] = makeContact());
      let hit = false;
      const s = col.shape;
      if (s.type === 'sphere') hit = capsuleVsSphere(ax, ay, az, bx, by, bz, r, s, c);
      else if (s.type === 'capsule') hit = capsuleVsCapsule(ax, ay, az, bx, by, bz, r, s, c);
      else hit = capsuleVsBox(ax, ay, az, bx, by, bz, r, s, c);
      if (hit) {
        c.layer = col.layer;
        c.tag = col.tag;
        c.colliderId = col.id;
        n++;
      }
    }
    return n;
  }

  /**
   * Terrain contacts: the capsule is covered by spheres spaced <= r apart along its axis and each
   * sphere is tested against nearby heightfield triangles. A point below the surface is always
   * pushed out along the surface normal (the heightfield is 2.5D, so "below" is unambiguous).
   */
  private capsuleTerrainContacts(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    r: number,
    out: Contact[],
    n: number,
  ): number {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const spheres = Math.max(1, Math.ceil(len / r)) + 1;
    const cp = this.tmpVec;
    const nrm = this.tmpNormal;
    for (let k = 0; k < spheres && n < MAX_CONTACTS; k++) {
      const t = spheres === 1 ? 0 : k / (spheres - 1);
      const sx = ax + dx * t;
      const sy = ay + dy * t;
      const sz = az + dz * t;
      const hf = this.heightfieldAt(sx, sz);
      if (!hf) continue;
      // Quick reject: sphere entirely above the highest terrain in the chunk.
      if (sy - r > hf.maxHeight + 0.01) continue;
      const surface = hf.heightAt(sx, sz);
      if (sy < surface) {
        hf.normalAt(sx, sz, nrm);
        const c = out[n] ?? (out[n] = makeContact());
        c.nx = nrm.x;
        c.ny = nrm.y;
        c.nz = nrm.z;
        c.depth = (surface - sy) * nrm.y + r;
        c.layer = Layer.Terrain;
        c.colliderId = -1;
        n++;
        continue;
      }
      let best = 0;
      let bnx = 0;
      let bny = 1;
      let bnz = 0;
      this.forEachTerrainTriangle(sx - r, sz - r, sx + r, sz + r, (x0, y0, z0, x1, y1, z1, x2, y2, z2) => {
        closestPointOnTriangle(sx, sy, sz, x0, y0, z0, x1, y1, z1, x2, y2, z2, cp);
        const ex = sx - cp.x;
        const ey = sy - cp.y;
        const ez = sz - cp.z;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 >= r * r) return;
        const d = Math.sqrt(d2);
        const depth = r - d;
        if (depth > best && d > 1e-9) {
          best = depth;
          bnx = ex / d;
          bny = ey / d;
          bnz = ez / d;
        }
      });
      if (best > 0) {
        const c = out[n] ?? (out[n] = makeContact());
        c.nx = bnx;
        c.ny = bny;
        c.nz = bnz;
        c.depth = best;
        c.layer = Layer.Terrain;
        c.colliderId = -1;
        n++;
      }
    }
    return n;
  }

  /** True if the capsule overlaps any geometry in `mask` deeper than `tolerance`. */
  overlapsCapsule(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    r: number,
    mask: number,
    tolerance = 0.001,
    scratch: Contact[] = [],
  ): boolean {
    const n = this.capsuleContacts(ax, ay, az, bx, by, bz, r, mask, scratch);
    for (let i = 0; i < n; i++) if (scratch[i]!.depth > tolerance) return true;
    return false;
  }

  queryAABB(aabb: AABB, mask: number, out: Collider[]): number {
    return this.statics.query(aabb, mask, out);
  }

  /* ----------------------------------- raycasts ------------------------------------------- */

  private readonly hitSources = new Map<number, Float32Array>();
  private readonly hitMeshes = new Map<number, HitMesh>();
  private readonly hitNormal = { x: 0, y: 0, z: 0 };
  /**
   * Model triangles per asset id: weapon raycasts (masks including Layer.Hitbox) that touch a
   * prop's collider are re-tested against them, so shots pass through its gaps.
   */
  setHitMeshes(meshes: ReadonlyMap<number, Float32Array>): void {
    this.hitSources.clear(); this.hitMeshes.clear();
    for (const [id, tris] of meshes) this.hitSources.set(id, tris);
  }
  private hitMesh(id: number): HitMesh | undefined {
    let m = this.hitMeshes.get(id);
    if (!m) { const src = this.hitSources.get(id); if (!src) return undefined; this.hitMeshes.set(id, m = new HitMesh(src)); }
    return m;
  }

  /**
   * Nearest hit along a ray against terrain and static colliders matching `mask`.
   * Direction must be normalised. Returns false if nothing is hit within maxDist.
   */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    mask: number,
    out: RayHit,
  ): boolean {
    out.t = Infinity;
    let best = maxDist;
    if (mask & Layer.Terrain) {
      const t = this.raycastTerrain(ox, oy, oz, dx, dy, dz, maxDist, this.tmpNormal);
      if (t >= 0) {
        best = t;
        out.t = t;
        out.nx = this.tmpNormal.x;
        out.ny = this.tmpNormal.y;
        out.nz = this.tmpNormal.z;
        out.layer = Layer.Terrain;
        out.colliderId = -1;
        out.tag = 0;
      }
    }
    const staticMask = mask & ~Layer.Terrain;
    const precise = (mask & Layer.Hitbox) !== 0 && this.hitSources.size > 0;
    if (staticMask) {
      const stamp = this.statics.nextStamp();
      const nrm = this.tmpNormal;
      traverseGrid2D(ox, oz, dx, dz, best, this.statics.cellSize, (ix, iz, tEnter) => {
        if (tEnter > best) return false;
        const list = this.statics.cell(ix, iz);
        if (!list) return true;
        for (let i = 0; i < list.length; i++) {
          const col = list[i]!;
          if (col.stamp === stamp || (col.layer & staticMask) === 0) continue;
          col.stamp = stamp;
          const s = col.shape;
          let t: number;
          if (s.type === 'sphere') t = raySphere(ox, oy, oz, dx, dy, dz, s.cx, s.cy, s.cz, s.r);
          else if (s.type === 'capsule') t = rayCapsule(ox, oy, oz, dx, dy, dz, s);
          else t = rayBox(ox, oy, oz, dx, dy, dz, s, nrm);
          if (t < 0 || t >= best) continue;
          // Shots: the collider is only the broad phase; the model's own surfaces decide.
          const ref = precise ? col.hit : undefined, mesh = ref ? this.hitMesh(ref.mesh) : undefined;
          if (ref && mesh) {
            if (ref.stamp !== stamp) {
              ref.stamp = stamp;
              ref.t = raycastHitRef(mesh, ref, ox, oy, oz, dx, dy, dz, maxDist, this.hitNormal);
              ref.nx = this.hitNormal.x; ref.ny = this.hitNormal.y; ref.nz = this.hitNormal.z;
            }
            if (ref.t! < 0 || ref.t! >= best) continue;
            best = ref.t!;
            out.t = best; out.nx = ref.nx!; out.ny = ref.ny!; out.nz = ref.nz!;
            out.layer = col.layer; out.colliderId = col.id; out.tag = col.tag;
            continue;
          }
          best = t;
          const px = ox + dx * t;
          const py = oy + dy * t;
          const pz = oz + dz * t;
          if (s.type === 'sphere') sphereNormal(px, py, pz, s.cx, s.cy, s.cz, nrm);
          else if (s.type === 'capsule') {
            const abx = s.bx - s.ax;
            const aby = s.by - s.ay;
            const abz = s.bz - s.az;
            const l2 = abx * abx + aby * aby + abz * abz;
            let u = l2 > 0 ? ((px - s.ax) * abx + (py - s.ay) * aby + (pz - s.az) * abz) / l2 : 0;
            u = u < 0 ? 0 : u > 1 ? 1 : u;
            sphereNormal(px, py, pz, s.ax + abx * u, s.ay + aby * u, s.az + abz * u, nrm);
          }
          out.t = t;
          out.nx = nrm.x;
          out.ny = nrm.y;
          out.nz = nrm.z;
          out.layer = col.layer;
          out.colliderId = col.id;
          out.tag = col.tag;
        }
        return true;
      });
    }
    if (out.t === Infinity) return false;
    out.x = ox + dx * out.t;
    out.y = oy + dy * out.t;
    out.z = oz + dz * out.t;
    return true;
  }

  private raycastTerrain(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    outNormal: MutVec3,
  ): number {
    let result = -1;
    traverseGrid2D(ox, oz, dx, dz, maxDist, 1, (gx, gz, tEnter, tExit) => {
      const hf = this.heightfieldAt(gx + 0.5, gz + 0.5);
      if (!hf) return true;
      // Skip cells where the ray stays above the chunk's highest point.
      const yA = oy + dy * tEnter;
      const yB = oy + dy * tExit;
      if (yA > hf.maxHeight + 0.01 && yB > hf.maxHeight + 0.01) return true;
      const s = hf.cellSize;
      const i = Math.floor((gx - hf.originX) / s);
      const j = Math.floor((gz - hf.originZ) / s);
      if (i < 0 || j < 0 || i >= hf.verts - 1 || j >= hf.verts - 1) return true;
      const x0 = hf.originX + i * s;
      const z0 = hf.originZ + j * s;
      const x1 = x0 + s;
      const z1 = z0 + s;
      const h00 = hf.h(i, j);
      const h10 = hf.h(i + 1, j);
      const h01 = hf.h(i, j + 1);
      const h11 = hf.h(i + 1, j + 1);
      const tA = rayTriangle(ox, oy, oz, dx, dy, dz, x0, h00, z0, x1, h11, z1, x1, h10, z0);
      const tB = rayTriangle(ox, oy, oz, dx, dy, dz, x0, h00, z0, x0, h01, z1, x1, h11, z1);
      let t = -1;
      if (tA >= 0 && (tB < 0 || tA <= tB)) t = tA;
      else if (tB >= 0) t = tB;
      if (t >= 0 && t <= maxDist) {
        result = t;
        hf.normalAt(ox + dx * t, oz + dz * t, outNormal);
        return false;
      }
      return true;
    });
    return result;
  }

  /** Straight-line visibility between two points against `mask`. */
  lineOfSight(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    mask: number,
    hit: RayHit,
  ): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return true;
    return !this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 1e-4, mask, hit);
  }

  /** Debug/test helper: contact against a single collider shape. */
  testShape(shape: ColliderShape, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): Contact | null {
    const c = this.tmpContact;
    const hit =
      shape.type === 'sphere'
        ? capsuleVsSphere(ax, ay, az, bx, by, bz, r, shape, c)
        : shape.type === 'capsule'
          ? capsuleVsCapsule(ax, ay, az, bx, by, bz, r, shape, c)
          : capsuleVsBox(ax, ay, az, bx, by, bz, r, shape, c);
    return hit ? { ...c } : null;
  }
}
