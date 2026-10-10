import { BufferAttribute, BufferGeometry, Color } from 'three';
import { CHUNK_SIZE, Surface, dequantizeHeight, heightIndex, lodStep, type ChunkData } from '@zion/shared';
import { terrainCellIndices } from '@zion/physics';
import { applyUnderwater, jitter, surfaceColor } from './palette';
import { vegetationPatch } from './vegetation-pattern';

const SKIRT_DEPTH = [1.5, 4, 10];
const color = new Color();
const mossColor = new Color(0x527c32);

/**
 * Builds the visual terrain mesh for a chunk in chunk-local coordinates. The triangulation is
 * the exact one the collision heightfield uses (terrainCellIndices), so what you see is what you
 * collide with. Normals use the one-vertex border ring sent by the server, so lighting is
 * seamless across chunks. Vertical skirts hide cracks between neighbouring LODs.
 */
export function buildTerrainGeometry(chunk: ChunkData, seaLevel: number, cosmeticSeed = 0): BufferGeometry {
  const n = chunk.verts;
  const step = lodStep(chunk.lod);
  const ox = chunk.cx * CHUNK_SIZE;
  const oz = chunk.cz * CHUNK_SIZE;
  const skirtVerts = 4 * n;
  const total = n * n + skirtVerts;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const H = (i: number, j: number) => dequantizeHeight(chunk.heights[heightIndex(n, i, j)]!);

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      const h = H(i, j);
      pos[v * 3] = i * step;
      pos[v * 3 + 1] = h;
      pos[v * 3 + 2] = j * step;
      const nx = H(i - 1, j) - H(i + 1, j);
      const nz = H(i, j - 1) - H(i, j + 1);
      const ny = 2 * step;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nrm[v * 3] = nx * inv;
      nrm[v * 3 + 1] = ny * inv;
      nrm[v * 3 + 2] = nz * inv;

      surfaceColor(chunk.surface[v]!, chunk.temperature[v]! / 255, chunk.humidity[v]! / 255, color);
      const surface = chunk.surface[v]!;
      const humidity = chunk.humidity[v]! / 255;
      if (humidity > 0.5 && (surface === Surface.ForestFloor || surface === Surface.JungleFloor
        || surface === Surface.Rock || surface === Surface.Mud)) {
        const cover = vegetationPatch(ox + i * step, oz + j * step, 12, cosmeticSeed ^ 0xb8);
        color.lerp(mossColor, Math.max(0, Math.min(1, (cover - 0.4) * 4)) * (humidity - 0.5) * 1.5);
      }
      const wq = chunk.water[v]!;
      const waterTop = wq ? Math.max(dequantizeHeight(wq), seaLevel) : seaLevel;
      applyUnderwater(color, waterTop - h);
      const slopeShade = 0.82 + 0.18 * ny * inv;
      const b = (1 + jitter(ox + i * step, oz + j * step)) * slopeShade;
      col[v * 3] = color.r * b;
      col[v * 3 + 1] = color.g * b;
      col[v * 3 + 2] = color.b * b;
    }
  }

  // Skirt vertices: copies of the edge ring, pushed down.
  const depth = SKIRT_DEPTH[chunk.lod] ?? 10;
  const edge: number[] = [];
  for (let i = 0; i < n; i++) edge.push(i); // north (j = 0)
  for (let j = 0; j < n; j++) edge.push(j * n + n - 1); // east
  for (let i = n - 1; i >= 0; i--) edge.push((n - 1) * n + i); // south
  for (let j = n - 1; j >= 0; j--) edge.push(j * n); // west
  for (let k = 0; k < edge.length; k++) {
    const src = edge[k]!;
    const dst = n * n + k;
    pos[dst * 3] = pos[src * 3]!;
    pos[dst * 3 + 1] = pos[src * 3 + 1]! - depth;
    pos[dst * 3 + 2] = pos[src * 3 + 2]!;
    for (let c = 0; c < 3; c++) {
      nrm[dst * 3 + c] = nrm[src * 3 + c]!;
      col[dst * 3 + c] = col[src * 3 + c]! * 0.8;
    }
  }

  const cells = (n - 1) * (n - 1);
  const index = new Uint32Array(cells * 6 + edge.length * 6);
  let o = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      terrainCellIndices(a, a + 1, a + n, a + n + 1, index, o);
      o += 6;
    }
  }
  // Each side runs n vertices; connect consecutive pairs within a side (skip side boundaries).
  for (let side = 0; side < 4; side++) {
    for (let k = 0; k < n - 1; k++) {
      const e0 = side * n + k;
      const e1 = e0 + 1;
      const t0 = edge[e0]!;
      const t1 = edge[e1]!;
      const s0 = n * n + e0;
      const s1 = n * n + e1;
      // Ring runs N→E→S→W edges; (top0, top1, skirt0) winds counter-clockwise seen from outside.
      index[o++] = t0;
      index[o++] = t1;
      index[o++] = s0;
      index[o++] = t1;
      index[o++] = s1;
      index[o++] = s0;
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setIndex(new BufferAttribute(index.subarray(0, o), 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/**
 * Inland water surface (rivers, lakes) for a chunk, or null when it has none. The sea is a single
 * global plane. Each cell touching water becomes a quad at the corners' water levels; a `depth`
 * attribute drives shoreline transparency and foam in the water shader.
 */
export function buildWaterGeometry(chunk: ChunkData): BufferGeometry | null {
  const n = chunk.verts;
  const step = lodStep(chunk.lod);
  const water = chunk.water;
  let any = false;
  for (let k = 0; k < water.length; k++) if (water[k]) {
    any = true;
    break;
  }
  if (!any) return null;
  const pos: number[] = [];
  const dep: number[] = [];
  const idx: number[] = [];
  const H = (i: number, j: number) => dequantizeHeight(chunk.heights[heightIndex(n, i, j)]!);
  const W = (i: number, j: number) => {
    const q = water[j * n + i]!;
    return q ? dequantizeHeight(q) : Number.NaN;
  };
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const corners: Array<[number, number]> = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]];
      let top = -Infinity;
      let lowGround = Infinity;
      for (const [ci, cj] of corners) {
        const w = W(ci, cj);
        if (w === w && w > top) top = w;
        const h = H(ci, cj);
        if (h < lowGround) lowGround = h;
      }
      if (top === -Infinity || lowGround >= top) continue;
      const base = pos.length / 3;
      for (const [ci, cj] of corners) {
        const w = W(ci, cj);
        const y = w === w ? w : top;
        pos.push(ci * step, y + 0.02, cj * step);
        dep.push(y - H(ci, cj));
      }
      terrainCellIndices(base, base + 1, base + 2, base + 3, idx, idx.length);
    }
  }
  if (idx.length === 0) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('depth', new BufferAttribute(new Float32Array(dep), 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Bilinear-on-triangles height lookup inside a chunk (same formula as the collision heightfield). */
export function chunkHeightAtLocal(chunk: ChunkData, lx: number, lz: number): number {
  const n = chunk.verts;
  const step = lodStep(chunk.lod);
  let fx = lx / step;
  let fz = lz / step;
  const i = Math.min(n - 2, Math.max(0, Math.floor(fx)));
  const j = Math.min(n - 2, Math.max(0, Math.floor(fz)));
  fx -= i;
  fz -= j;
  const h00 = dequantizeHeight(chunk.heights[heightIndex(n, i, j)]!);
  const h10 = dequantizeHeight(chunk.heights[heightIndex(n, i + 1, j)]!);
  const h01 = dequantizeHeight(chunk.heights[heightIndex(n, i, j + 1)]!);
  const h11 = dequantizeHeight(chunk.heights[heightIndex(n, i + 1, j + 1)]!);
  if (fx >= fz) return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
  return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
}
