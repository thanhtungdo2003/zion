import { beforeAll, describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '@zion/assets';
import { Surface, heightIndex, quantizeHeight } from '@zion/shared';
import { WorldGenerator, makeColumnSample } from './generator';
import { allStructures } from './structures';
import { normalizeSeed } from './config';
import { ROAD_MAX_GRADE } from './roads';

describe('graded dirt roads', () => {
  let gen: WorldGenerator;
  beforeAll(() => { gen = new WorldGenerator({ seed: normalizeSeed('test-world'), sizeChunks: 64 }, createDefaultRegistry()); });
  it('connects the camp gate to settlements, with bounded grades and level carriageways', () => {
    const roads = gen.roads!;
    expect(roads.segments.length).toBeGreaterThan(10);
    const widths = roads.segments.filter(s => !s.bridge).map(s => s.halfWidth * 2);
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(1);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(3);
    expect(roads.connectedSites.length).toBeGreaterThan(allStructures(gen).length * .6);
    const sample = makeColumnSample();
    let roadSamples = 0, fences = 0;
    for (const { a, b, length, bridge } of roads.segments) {
      expect(Math.abs(b.y - a.y) / length, JSON.stringify({ a, b, length })).toBeLessThan(ROAD_MAX_GRADE + .015);
      if (bridge) continue; // Decks are colliders above the preserved riverbed.
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
      if (gen.camp && Math.max(Math.abs(x - gen.camp.x), Math.abs(z - gen.camp.z)) < 75) continue;
      if (allStructures(gen).some(s => Math.hypot(x - s.x, z - s.z) < s.radius + 18)) continue;
      gen.sampleColumn(x, z, sample);
      if (sample.roadBridge) continue;
      expect(sample.height).toBeCloseTo(sample.roadHeight, 5);
      const nx = -(b.z - a.z) / length, nz = (b.x - a.x) / length;
      expect(gen.heightAt(x + nx, z + nz)).toBeCloseTo(sample.height, 3);
      expect(gen.heightAt(x - nx, z - nz)).toBeCloseTo(sample.height, 3);
      roadSamples++;
      fences += roads.chunkProps(Math.floor(x / 32), Math.floor(z / 32)).length;
    }
    expect(roadSamples).toBeGreaterThan(10);
    expect(fences).toBeGreaterThan(0);
  });
  it('has subtle tyre tracks and grassy shoulders, and keeps road collision consistent across chunks', () => {
    const roads = gen.roads!;
    const segment = roads.segments.find(s => s.length > 8)!;
    const x = (segment.a.x + segment.b.x) / 2, z = (segment.a.z + segment.b.z) / 2;
    const query = { roadDistance: 0, roadHeight: 0, roadAlong: 0 };
    roads.query(x, z, query);
    expect(roads.surface(query, x, z)).toBe(Surface.DirtRoad);
    expect(roads.surface({ ...query, roadDistance: .95 }, x, z)).toBe(Surface.WheelTrack);
    expect(roads.surface({ ...query, roadDistance: segment.halfWidth + .5 }, x, z)).toBe(Surface.RoadVerge);
    const cx = Math.floor(x / 32), cz = Math.floor(z / 32), chunk = gen.generateChunk(cx, cz, 0);
    for (let j = 0; j < chunk.verts; j++) {
      expect(chunk.heights[heightIndex(chunk.verts, 0, j)]).toBe(quantizeHeight(gen.heightAt(cx * 32, cz * 32 + j)));
    }
  });
  it('reduces mountain relief while retaining exact legacy generation when v2 is selected', () => {
    const legacy = new WorldGenerator({ seed: gen.seed, sizeChunks: 64, generatorVersion: 2 }, createDefaultRegistry());
    expect(legacy.roads).toBeNull();
    let reduced = 0;
    for (let z = 32; z < gen.worldSize; z += 64) for (let x = 32; x < gen.worldSize; x += 64) {
      const current = gen.fields.base(x, z, makeColumnSample().base);
      const previous = legacy.fields.base(x, z, makeColumnSample().base);
      expect(current.rel).toBeLessThanOrEqual(previous.rel + 1e-6);
      if (previous.rel - current.rel > 20) reduced++;
    }
    expect(reduced).toBeGreaterThan(10);
  });
  it.each(['zion-alpha', 'contour-pass', 'wasteland-roads'])('keeps grades walkable on additional seeds: %s', seed => {
    const world = new WorldGenerator({ seed: normalizeSeed(seed), sizeChunks: 128 }, createDefaultRegistry());
    expect(world.roads!.connectedSites.length).toBeGreaterThan(0);
    for (const segment of world.roads!.segments) {
      expect(Math.abs(segment.a.y - segment.b.y) / segment.length, JSON.stringify(segment)).toBeLessThan(ROAD_MAX_GRADE + .015);
    }
  });
});
