import type { AABB, Collider } from './shapes';

/**
 * Uniform 2D (XZ) spatial hash for colliders. Objects spanning several cells are referenced from
 * each cell; queries de-duplicate with a per-query stamp. Y is ignored for bucketing because the
 * world is wide and shallow.
 */
export class SpatialHash {
  private readonly cells = new Map<number, Collider[]>();
  private stamp = 0;

  constructor(readonly cellSize: number) {}

  private static key(ix: number, iz: number): number {
    return ((ix & 0xffff) << 16) | (iz & 0xffff);
  }

  insert(c: Collider): void {
    const { minX, minZ, maxX, maxZ } = c.aabb;
    const s = this.cellSize;
    const x0 = Math.floor(minX / s);
    const x1 = Math.floor(maxX / s);
    const z0 = Math.floor(minZ / s);
    const z1 = Math.floor(maxZ / s);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = SpatialHash.key(ix, iz);
        let list = this.cells.get(k);
        if (!list) {
          list = [];
          this.cells.set(k, list);
        }
        list.push(c);
      }
    }
  }

  remove(c: Collider): void {
    const { minX, minZ, maxX, maxZ } = c.aabb;
    const s = this.cellSize;
    const x0 = Math.floor(minX / s);
    const x1 = Math.floor(maxX / s);
    const z0 = Math.floor(minZ / s);
    const z1 = Math.floor(maxZ / s);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = SpatialHash.key(ix, iz);
        const list = this.cells.get(k);
        if (!list) continue;
        const idx = list.indexOf(c);
        if (idx >= 0) {
          list[idx] = list[list.length - 1]!;
          list.pop();
        }
        if (list.length === 0) this.cells.delete(k);
      }
    }
  }

  /** Begin a de-duplicated query; returns the stamp to mark visited colliders with. */
  nextStamp(): number {
    this.stamp = (this.stamp + 1) | 0;
    if (this.stamp === 0) this.stamp = 1;
    return this.stamp;
  }

  cell(ix: number, iz: number): readonly Collider[] | undefined {
    return this.cells.get(SpatialHash.key(ix, iz));
  }

  query(aabb: AABB, mask: number, out: Collider[]): number {
    const stamp = this.nextStamp();
    const s = this.cellSize;
    const x0 = Math.floor(aabb.minX / s);
    const x1 = Math.floor(aabb.maxX / s);
    const z0 = Math.floor(aabb.minZ / s);
    const z1 = Math.floor(aabb.maxZ / s);
    let n = 0;
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this.cells.get(SpatialHash.key(ix, iz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i]!;
          if (c.stamp === stamp || (c.layer & mask) === 0) continue;
          c.stamp = stamp;
          const b = c.aabb;
          if (
            b.minX > aabb.maxX ||
            b.maxX < aabb.minX ||
            b.minY > aabb.maxY ||
            b.maxY < aabb.minY ||
            b.minZ > aabb.maxZ ||
            b.maxZ < aabb.minZ
          ) {
            continue;
          }
          out[n++] = c;
        }
      }
    }
    return n;
  }

  get cellCount(): number {
    return this.cells.size;
  }
}

/**
 * Visits 2D grid cells crossed by a ray in XZ, in order (Amanatides & Woo).
 * The visitor gets the parametric [tEnter, tExit] of the ray inside the cell (t in 3D distance
 * units when (dx,dy,dz) is normalised) and returns false to stop.
 */
export function traverseGrid2D(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  maxT: number,
  cellSize: number,
  visit: (ix: number, iz: number, tEnter: number, tExit: number) => boolean,
): void {
  let ix = Math.floor(ox / cellSize);
  let iz = Math.floor(oz / cellSize);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? cellSize / Math.abs(dx) : Infinity;
  const tDeltaZ = stepZ !== 0 ? cellSize / Math.abs(dz) : Infinity;
  let tMaxX = stepX > 0 ? ((ix + 1) * cellSize - ox) / dx : stepX < 0 ? (ix * cellSize - ox) / dx : Infinity;
  let tMaxZ = stepZ > 0 ? ((iz + 1) * cellSize - oz) / dz : stepZ < 0 ? (iz * cellSize - oz) / dz : Infinity;
  let tEnter = 0;
  // Bound the walk defensively (NaN or degenerate input).
  const maxSteps = Math.ceil(maxT / cellSize) * 2 + 4;
  for (let step = 0; step < maxSteps; step++) {
    const tExit = Math.min(tMaxX, tMaxZ, maxT);
    if (!visit(ix, iz, tEnter, tExit)) return;
    if (tExit >= maxT) return;
    if (tMaxX < tMaxZ) {
      ix += stepX;
      tEnter = tMaxX;
      tMaxX += tDeltaX;
    } else {
      iz += stepZ;
      tEnter = tMaxZ;
      tMaxZ += tDeltaZ;
    }
  }
}
