import { CHUNK_SIZE, dequantizeHeight, heightIndex, lodStep, type ChunkData } from '@zion/shared';
import type { MutVec3 } from './geometry';
import { terrainMaterial, type MaterialKind } from './surfaces';

/**
 * Regular-grid terrain patch for one chunk. Each grid cell is split into two triangles along the
 * (x0,z0)–(x1,z1) diagonal. The renderer MUST use the same split (see terrainCellIndices) so the
 * visible surface and the collision surface are identical.
 *
 *   (x0,z0) a ──── b (x1,z0)
 *           │ ╲  A │        A = (a, d, b)  used when fx >= fz
 *           │  ╲   │        B = (a, c, d)  used when fx <  fz
 *   (x0,z1) c ──── d (x1,z1)
 */
export class Heightfield {
  readonly maxHeight: number;
  readonly minHeight: number;

  constructor(
    readonly originX: number,
    readonly originZ: number,
    readonly cellSize: number,
    /** Vertices per side. */
    readonly verts: number,
    /** Row-major (z, then x) heights, verts*verts. */
    readonly heights: Float32Array,
    /** Inland water surface per vertex; NaN where none. */
    readonly water: Float32Array,
    /** Terrain surface type per vertex (Surface enum); absent: grass everywhere. */
    readonly surface?: Uint8Array,
  ) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i]!;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    this.minHeight = lo;
    this.maxHeight = hi;
  }

  static fromChunk(chunk: ChunkData): Heightfield {
    const n = chunk.verts;
    const heights = new Float32Array(n * n);
    const water = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        heights[j * n + i] = dequantizeHeight(chunk.heights[heightIndex(n, i, j)]!);
        const w = chunk.water[j * n + i]!;
        water[j * n + i] = w === 0 ? Number.NaN : dequantizeHeight(w);
      }
    }
    return new Heightfield(chunk.cx * CHUNK_SIZE, chunk.cz * CHUNK_SIZE, lodStep(chunk.lod), n, heights, water, chunk.surface.length === n * n ? chunk.surface : undefined);
  }

  /** Physical material of the grid cell whose lower corner is vertex (i, j). */
  cellMaterial(i: number, j: number): MaterialKind {
    const n = this.verts, k = Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i));
    const water = this.water[k]!, wet = water === water && water > this.heights[k]! + .02;
    return terrainMaterial(this.surface ? this.surface[k]! : 0, wet);
  }

  /** Physical material under world (x, z) (caller guarantees the point is inside this patch). */
  materialAt(x: number, z: number): MaterialKind {
    return this.cellMaterial(Math.round((x - this.originX) / this.cellSize), Math.round((z - this.originZ) / this.cellSize));
  }

  get size(): number {
    return (this.verts - 1) * this.cellSize;
  }

  h(i: number, j: number): number {
    return this.heights[j * this.verts + i]!;
  }

  /** Height at world (x, z); caller guarantees the point is inside this patch. */
  heightAt(x: number, z: number): number {
    const n1 = this.verts - 1;
    let fx = (x - this.originX) / this.cellSize;
    let fz = (z - this.originZ) / this.cellSize;
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    if (i < 0) i = 0;
    else if (i >= n1) i = n1 - 1;
    if (j < 0) j = 0;
    else if (j >= n1) j = n1 - 1;
    fx -= i;
    fz -= j;
    if (fx < 0) fx = 0;
    else if (fx > 1) fx = 1;
    if (fz < 0) fz = 0;
    else if (fz > 1) fz = 1;
    const n = this.verts;
    const h00 = this.heights[j * n + i]!;
    const h10 = this.heights[j * n + i + 1]!;
    const h01 = this.heights[(j + 1) * n + i]!;
    const h11 = this.heights[(j + 1) * n + i + 1]!;
    if (fx >= fz) return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
    return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  }

  /** Unit normal of the triangle under (x, z). */
  normalAt(x: number, z: number, out: MutVec3): void {
    const n1 = this.verts - 1;
    let fx = (x - this.originX) / this.cellSize;
    let fz = (z - this.originZ) / this.cellSize;
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    if (i < 0) i = 0;
    else if (i >= n1) i = n1 - 1;
    if (j < 0) j = 0;
    else if (j >= n1) j = n1 - 1;
    fx -= i;
    fz -= j;
    const n = this.verts;
    const s = this.cellSize;
    const h00 = this.heights[j * n + i]!;
    const h10 = this.heights[j * n + i + 1]!;
    const h01 = this.heights[(j + 1) * n + i]!;
    const h11 = this.heights[(j + 1) * n + i + 1]!;
    // Plane gradient (dh/dx, dh/dz) of the active triangle.
    let gx: number;
    let gz: number;
    if (fx >= fz) {
      gx = (h10 - h00) / s;
      gz = (h11 - h10) / s;
    } else {
      gx = (h11 - h01) / s;
      gz = (h01 - h00) / s;
    }
    const inv = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
    out.x = -gx * inv;
    out.y = inv;
    out.z = -gz * inv;
  }

  /** Inland water level at (x, z): highest water among the enclosing cell's corners, else NaN. */
  waterAt(x: number, z: number): number {
    const n1 = this.verts - 1;
    let i = Math.floor((x - this.originX) / this.cellSize);
    let j = Math.floor((z - this.originZ) / this.cellSize);
    if (i < 0) i = 0;
    else if (i >= n1) i = n1 - 1;
    if (j < 0) j = 0;
    else if (j >= n1) j = n1 - 1;
    const n = this.verts;
    let w = Number.NaN;
    const a = this.water[j * n + i]!;
    const b = this.water[j * n + i + 1]!;
    const c = this.water[(j + 1) * n + i]!;
    const d = this.water[(j + 1) * n + i + 1]!;
    if (a === a) w = a;
    if (b === b && !(b <= w)) w = b;
    if (c === c && !(c <= w)) w = c;
    if (d === d && !(d <= w)) w = d;
    return w;
  }
}

/**
 * Index buffer order for one grid cell matching Heightfield's triangulation, CCW when viewed from +Y.
 * a = (i,j), b = (i+1,j), c = (i,j+1), d = (i+1,j+1).
 */
export function terrainCellIndices(a: number, b: number, c: number, d: number, out: number[] | Uint32Array, o: number): void {
  out[o] = a;
  out[o + 1] = d;
  out[o + 2] = b;
  out[o + 3] = a;
  out[o + 4] = c;
  out[o + 5] = d;
}
