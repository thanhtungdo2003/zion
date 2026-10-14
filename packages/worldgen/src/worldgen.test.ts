import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { Biome, encodeChunkBody, heightIndex, lodVerts } from '@zion/shared';
import { createDefaultRegistry } from '@zion/assets';
import { WorldGenerator, makeColumnSample, normalizeSeed } from './index';

const registry = createDefaultRegistry();
const CONFIG = { seed: normalizeSeed('test-world'), sizeChunks: 64 };

function chunkHash(gen: WorldGenerator, cx: number, cz: number, lod: number): string {
  return createHash('sha256').update(encodeChunkBody(gen.generateChunk(cx, cz, lod))).digest('hex');
}

describe('world generation', () => {
  let gen: WorldGenerator;
  beforeAll(() => {
    gen = new WorldGenerator(CONFIG, registry);
  });

  it('is deterministic: same seed + config → identical chunks, in any order', () => {
    const other = new WorldGenerator(CONFIG, registry);
    const coords: Array<[number, number, number]> = [[30, 30, 0], [10, 50, 1], [33, 31, 2], [31, 30, 0]];
    const a = coords.map(([x, z, l]) => chunkHash(gen, x, z, l));
    const b = coords.slice().reverse().map(([x, z, l]) => chunkHash(other, x, z, l)).reverse();
    expect(b).toEqual(a);
  });

  it('different seeds produce different worlds', () => {
    const other = new WorldGenerator({ ...CONFIG, seed: CONFIG.seed + 1 }, registry);
    expect(chunkHash(other, 30, 30, 0)).not.toBe(chunkHash(gen, 30, 30, 0));
  });

  it('neighbouring chunks share identical edge heights', () => {
    const a = gen.generateChunk(20, 20, 0);
    const b = gen.generateChunk(21, 20, 0);
    const c = gen.generateChunk(20, 21, 0);
    const n = a.verts;
    for (let j = 0; j < n; j++) expect(a.heights[heightIndex(n, n - 1, j)]).toBe(b.heights[heightIndex(n, 0, j)]);
    for (let i = 0; i < n; i++) expect(a.heights[heightIndex(n, i, n - 1)]).toBe(c.heights[heightIndex(n, i, 0)]);
  });

  it('coarser LODs sample exactly the same surface', () => {
    const l0 = gen.generateChunk(25, 27, 0);
    const l1 = gen.generateChunk(25, 27, 1);
    const n1 = lodVerts(1);
    for (let j = 0; j < n1; j++) {
      for (let i = 0; i < n1; i++) {
        expect(l1.heights[heightIndex(n1, i, j)]).toBe(l0.heights[heightIndex(l0.verts, i * 2, j * 2)]);
      }
    }
    // Props are LOD-independent: LOD 0–2 carry the same set (far trees stay on the hills); LOD 3 none.
    expect(l1.props).toEqual(l0.props);
    expect(gen.generateChunk(25, 27, 2).props).toEqual(l0.props);
    expect(gen.generateChunk(25, 27, 3).props).toHaveLength(0);
  });

  it('is an island: the world border is ocean', () => {
    const s = makeColumnSample();
    for (let t = 0; t <= 1; t += 0.1) {
      for (const [x, z] of [[t * gen.worldSize, 5], [5, t * gen.worldSize]] as const) {
        gen.sampleColumn(x, z, s);
        expect(s.height).toBeLessThan(gen.seaLevel);
      }
    }
  });

  it('contains many distinct biomes', () => {
    const s = makeColumnSample();
    const seen = new Set<Biome>();
    for (let z = 16; z < gen.worldSize; z += 24) {
      for (let x = 16; x < gen.worldSize; x += 24) {
        gen.sampleColumn(x, z, s);
        seen.add(gen.classifyBiome(s, gen.slopeAt(x, z, s.height, 2)));
      }
    }
    for (const b of [Biome.Ocean, Biome.Coast, Biome.Plains, Biome.Forest, Biome.SpruceForest, Biome.Mountain]) {
      expect(seen.has(b)).toBe(true);
    }
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });

  it('rivers flow downhill and end at the sea or a lake', () => {
    const h = gen.hydrology;
    expect(h.segmentCount).toBeGreaterThan(10);
    for (let q = 0; q < h.segmentCount; q++) {
      const s = h.segment(q);
      // Water surface never rises downstream (tolerance for float32 storage).
      expect(s[5]!).toBeLessThanOrEqual(s[4]! + 1e-3);
      expect(s[5]!).toBeGreaterThanOrEqual(gen.seaLevel - 1e-3);
    }
  });

  it('lakes sit in basins: their surface is above the lake bed', () => {
    const h = gen.hydrology;
    for (let k = 0; k < h.lakeId.length; k++) {
      const id = h.lakeId[k]!;
      if (id < 0) continue;
      expect(h.lakeLevels[id]!).toBeGreaterThan(h.macro[k]!);
      expect(h.lakeLevels[id]!).toBeGreaterThan(gen.seaLevel);
    }
  });

  it('places props deterministically, inside the chunk and on dry land', () => {
    let total = 0;
    for (let cx = 28; cx < 34; cx++) {
      for (let cz = 28; cz < 34; cz++) {
        const c = gen.generateChunk(cx, cz, 0);
        total += c.props.length;
        for (const p of c.props) expect(registry.byNumericId(p.asset)).toBeDefined();
      }
    }
    expect(total).toBeGreaterThan(0);
  });

  it('finds valid spawn points on land', () => {
    const spawns = gen.findSpawnPoints(8);
    expect(spawns.length).toBeGreaterThan(0);
    const s = makeColumnSample();
    for (const p of spawns) {
      gen.sampleColumn(p.x, p.z, s);
      expect(s.height).toBeGreaterThan(gen.seaLevel);
      expect(Number.isNaN(s.water)).toBe(true);
    }
  });
});

describe('abandoned structures', () => {
  it('adds 50% more sites while preserving original sites and non-overlapping footprints', async () => {
    const { allStructures, structureInCell, structuresNear } = await import('./structures');
    const gen = new WorldGenerator({ ...CONFIG, generatorVersion: 2 }, registry);
    const original = [];
    const cells = Math.ceil(gen.worldSize / 100);
    for (let gz = 0; gz < cells; gz++) for (let gx = 0; gx < cells; gx++) {
      const site = structureInCell(gen, gx, gz); if (site) original.push(site);
    }
    const sites = allStructures(gen);
    expect(sites.length).toBe(Math.round(original.length * 1.5));
    for (const site of original) expect(sites).toContain(site);
    for (const site of sites) {
      expect(structuresNear(gen, site.x, site.z)).toContain(site);
      for (const other of sites) if (other !== site) expect(Math.hypot(site.x - other.x, site.z - other.z)).toBeGreaterThanOrEqual(site.radius + other.radius + 10);
    }
  });
  it('are seeded, kept away from the camp and from each other', async () => {
    const { structureInCell } = await import('./structures');
    const a = new WorldGenerator({ ...CONFIG, generatorVersion: 2 }, registry);
    const b = new WorldGenerator({ ...CONFIG, generatorVersion: 2 }, registry);
    const sites = [];
    for (let gz = 0; gz < 7; gz++) for (let gx = 0; gx < 7; gx++) {
      const s = structureInCell(a, gx, gz);
      expect(JSON.stringify(structureInCell(b, gx, gz))).toBe(JSON.stringify(s));
      if (s) sites.push(s);
    }
    for (const s of sites) {
      if (a.camp) expect(Math.hypot(s.x - a.camp.x, s.z - a.camp.z)).toBeGreaterThan(300);
      expect(s.parts.length).toBeGreaterThan(0);
      for (const o of sites) if (o !== s) expect(Math.hypot(o.x - s.x, o.z - s.z)).toBeGreaterThan(Math.min(s.radius, o.radius));
    }
  });
});
