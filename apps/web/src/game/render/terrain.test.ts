import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, Surface, dequantizeHeight, heightIndex, lodStep, quantizeHeight, type ChunkData } from '@zion/shared';
import { terrainCellIndices } from '@zion/physics';
import { buildTerrainGeometry } from './terrain';

function cliffChunk(cx: number, lod = 0): ChunkData {
  const step = lodStep(lod), verts = CHUNK_SIZE / step + 1;
  const heights = new Uint16Array((verts + 2) ** 2);
  for (let z = -1; z <= verts; z++) for (let x = -1; x <= verts; x++) {
    const wx = cx * CHUNK_SIZE + x * step;
    heights[heightIndex(verts, x, z)] = quantizeHeight(50 + Math.abs(wx - 32) * .4 + Math.abs(z * step - 16) * .6);
  }
  return { cx, cz: 0, lod, verts, heights, props: [], cosmeticSeed: 17,
    water: new Uint16Array(verts ** 2), biome: new Uint8Array(verts ** 2),
    surface: new Uint8Array(verts ** 2).fill(Surface.Rock),
    humidity: new Uint8Array(verts ** 2).fill(220), temperature: new Uint8Array(verts ** 2).fill(160) };
}

describe('terrain geometry and climate shading', () => {
  it.each([0, 1, 2, 3])('keeps the collision heights, triangle topology and vertex budget at LOD %s', (lod) => {
    const chunk = cliffChunk(0, lod), n = chunk.verts, step = lodStep(lod);
    const geometry = buildTerrainGeometry(chunk, 20), positions = geometry.getAttribute('position');
    expect(positions.count).toBe(n * n + n * 4);
    const expected: number[] = [];
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const v = z * n + x;
      expect(positions.getX(v)).toBe(x * step);
      expect(positions.getY(v)).toBeCloseTo(dequantizeHeight(chunk.heights[heightIndex(n, x, z)]!), 4);
      expect(positions.getZ(v)).toBe(z * step);
      if (x < n - 1 && z < n - 1) terrainCellIndices(v, v + 1, v + n, v + n + 1, expected, expected.length);
    }
    expect(Array.from(geometry.getIndex()!.array).slice(0, expected.length)).toEqual(expected);
    const detail = geometry.getAttribute('terrainDetail');
    expect(detail.normalized).toBe(true);
    expect(detail.array.byteLength).toBe(positions.count * 4);
    expect(detail.getX(0)).toBeCloseTo(220 / 255);
    expect(detail.getY(0)).toBeCloseTo(160 / 255);
    // A real crease gets cavity/curvature shading, independent of the texture pack.
    expect(detail.getZ(Math.floor(n / 2) * n + n - 1)).toBeGreaterThan(0);
    const edge = [
      ...Array.from({ length: n }, (_, i) => i),
      ...Array.from({ length: n }, (_, j) => j * n + n - 1),
      ...Array.from({ length: n }, (_, i) => (n - 1) * n + n - 1 - i),
      ...Array.from({ length: n }, (_, j) => (n - 1 - j) * n),
    ];
    edge.forEach((src, i) => {
      for (let c = 0; c < 4; c++) expect(detail.getComponent(n * n + i, c)).toBe(detail.getComponent(src, c));
    });
    geometry.dispose();
  });

  it('shares normals and climate/cavity data at adjacent chunk borders', () => {
    const a = buildTerrainGeometry(cliffChunk(0), 20), b = buildTerrainGeometry(cliffChunk(1), 20);
    for (let j = 0; j < 33; j++) for (const name of ['normal', 'terrainDetail']) {
      const aa = a.getAttribute(name), bb = b.getAttribute(name);
      for (let c = 0; c < aa.itemSize; c++) expect(aa.getComponent(j * 33 + 32, c)).toBe(bb.getComponent(j * 33, c));
    }
    a.dispose(); b.dispose();
  });
});
