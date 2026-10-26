import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '@zion/assets';
import { heightIndex, lodStep } from '@zion/shared';
import { BedrockRelief } from './geology';
import { WorldGenerator } from './generator';
import { makeBaseSample } from './fields';

describe('terrain bedrock', () => {
  it('forms seeded slabs and metre-deep clefts, fading away on unexposed soil', () => {
    const rock = new BedrockRelief(123), other = new BedrockRelief(456);
    const values: number[] = [], changed: number[] = [];
    for (let z = 0; z <= 64; z++) for (let x = 0; x <= 64; x++) {
      const h = 70 + x * .45;
      expect(rock.displacement(x, z, h, 0)).toBe(0);
      const value = rock.displacement(x, z, h, .9);
      expect(new BedrockRelief(123).displacement(x, z, h, .9)).toBe(value);
      values.push(value); changed.push(other.displacement(x, z, h, .9));
    }
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(6);
    expect(values).not.toEqual(changed);
    // This is geometric displacement, with changes large enough to resolve on the 1 m mesh.
    expect(values.some((v, i) => i % 65 && Math.abs(v - values[i - 1]!) > 1)).toBe(true);
  });

  it('puts the same rocky vertices in collision data, chunk edges and all LODs without changing v7', () => {
    const registry = createDefaultRegistry(), cfg = { seed: 7123, sizeChunks: 64 };
    const modern = new WorldGenerator({ ...cfg, generatorVersion: 8 }, registry);
    const legacy = new WorldGenerator({ ...cfg, generatorVersion: 7 }, registry);
    modern.rawTerrain = legacy.rawTerrain = true;
    let strength = 0, cx = 0, cz = 0;
    const base = makeBaseSample();
    for (let z = 160; z < 1900; z += 64) for (let x = 160; x < 1900; x += 64) {
      modern.fields.base(x, z, base);
      if (base.mountain > strength) { strength = base.mountain; cx = Math.floor(x / 32); cz = Math.floor(z / 32); }
    }
    expect(strength).toBeGreaterThan(.4);
    const fine = modern.generateChunk(cx, cz, 0), old = legacy.generateChunk(cx, cz, 0);
    expect(fine.heights).not.toEqual(old.heights);
    const neighbour = modern.generateChunk(cx + 1, cz, 0);
    for (let j = 0; j < fine.verts; j++) expect(fine.heights[heightIndex(fine.verts, fine.verts - 1, j)]).toBe(neighbour.heights[heightIndex(neighbour.verts, 0, j)]);
    for (const lod of [1, 2, 3]) {
      const coarse = modern.generateChunk(cx, cz, lod), step = lodStep(lod);
      for (let j = 0; j < coarse.verts; j++) for (let i = 0; i < coarse.verts; i++) {
        expect(coarse.heights[heightIndex(coarse.verts, i, j)]).toBe(fine.heights[heightIndex(fine.verts, i * step, j * step)]);
      }
    }
    expect(legacy.generateChunk(cx, cz, 0).heights).toEqual(old.heights);
  });
});
