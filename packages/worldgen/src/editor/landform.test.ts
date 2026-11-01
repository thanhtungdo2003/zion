import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '@zion/assets';
import { normalizeSeed } from '../config';
import { WaterKind, WorldGenerator, makeColumnSample } from '../generator';
import { Heightfield, createMapDoc, defaultTerrainSettings, generateTerrain, pointInPolygon, rasterizeWater, riverLevels, toBattleMap, type WaterData } from './index';

const run = <T>(gen: Generator<unknown, T>): T => { for (;;) { const r = gen.next(); if (r.done) return r.value; } };
const cache = new Map<string, { hf: Heightfield; water: WaterData; sea: number }>();
/** A 2 km island (the full 1025² grid at 2 m), terrain and drainage. */
function island(seed: string) {
  const hit = cache.get(seed);
  if (hit) return hit;
  const s = { ...defaultTerrainSettings('tectonic', seed, 2048), maxHeight: 200 }, hf = new Heightfield(s.size, s.cell), out: { water?: WaterData } = {};
  run(generateTerrain(s, hf, out));
  const r = { hf, water: out.water!, sea: s.seaLevel };
  cache.set(seed, r);
  return r;
}
const landMask = (hf: Heightfield, sea: number) => Uint8Array.from(hf.heights, (h) => (h > sea ? 1 : 0));

describe('landform (geological terrain)', () => {
  it('gives every seed its own island: sea round it, land in the middle, outlines that differ', () => {
    const seeds = ['alpha', 'beta', 'gamma'], masks = seeds.map((sd) => landMask(island(sd).hf, island(sd).sea));
    for (const [k, sd] of seeds.entries()) {
      const { hf, sea } = island(sd), share = masks[k]!.reduce((a, b) => a + b, 0) / masks[k]!.length;
      expect(share, sd).toBeGreaterThan(.15);
      expect(share, sd).toBeLessThan(.7);
      for (const [x, z] of [[3, 3], [2044, 3], [3, 2044], [2044, 2044], [1024, 3], [3, 1024]]) expect(hf.heightAt(x!, z!), `${sd} edge`).toBeLessThan(sea);
    }
    // Overlap (intersection over union) between two seeds' land stays well short of the same shape.
    for (let a = 0; a < masks.length; a++) for (let b = a + 1; b < masks.length; b++) {
      let both = 0, either = 0;
      for (let k = 0; k < masks[a]!.length; k++) { both += masks[a]![k]! & masks[b]![k]!; either += masks[a]![k]! | masks[b]![k]!; }
      expect(both / either).toBeLessThan(.8);
    }
  }, 120_000);

  it('drains: rivers run downhill to the sea, a lake or a larger river, in carved beds', () => {
    const { hf, water, sea } = island('alpha');
    expect(water.rivers.length).toBeGreaterThan(2);
    for (const r of water.rivers) {
      const lv = r.levels ?? riverLevels(hf, r);
      // The surface never rises downstream, and the source is above the mouth.
      for (let i = 1; i < lv.length; i++) expect(lv[i]!).toBeLessThanOrEqual(lv[i - 1]! + 1e-6);
      expect(lv[0]!).toBeGreaterThan(lv[lv.length - 1]! - 1e-6);
      // The bed under the centre line is below the water.
      const mid = r.points[Math.floor(r.points.length / 2)]!;
      expect(hf.heightAt(mid.x, mid.z)).toBeLessThan(lv[Math.floor(r.points.length / 2)]!);
      expect(lv[lv.length - 1]!).toBeGreaterThan(sea - 5);
    }
  }, 120_000);

  it('holds its lakes in basins (the ground under them is below the level) and leaves no dry pits', () => {
    const { hf, water, sea } = island('beta');
    expect(water.lakes.length).toBeGreaterThan(0);
    for (const l of water.lakes) {
      expect(l.level).toBeGreaterThan(sea);
      let under = 0, inside = 0;
      for (let j = 0; j < hf.rows; j += 2) for (let i = 0; i < hf.cols; i += 2) {
        if (!pointInPolygon(i * hf.cell, j * hf.cell, l.polygon)) continue;
        inside++; if (hf.heights[j * hf.cols + i]! < l.level) under++;
      }
      expect(inside).toBeGreaterThan(0);
      expect(under / inside).toBeGreaterThan(.8);
    }
    // Closed pits on dry land (water would stand there with nowhere to go): a handful at most.
    const wet = rasterizeWater(hf, water), n = hf.cols;
    let pits = 0, land = 0;
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const k = j * n + i, h = hf.heights[k]!;
      if (h <= sea || wet.level[k]! > h - 1) continue;
      land++;
      if (h < hf.heights[k - 1]! && h < hf.heights[k + 1]! && h < hf.heights[k - n]! && h < hf.heights[k + n]! && h < hf.heights[k - n - 1]! && h < hf.heights[k - n + 1]! && h < hf.heights[k + n - 1]! && h < hf.heights[k + n + 1]!) pits++;
    }
    expect(pits / land).toBeLessThan(.002);
  }, 120_000);

  it('reaches the game: the published map has the same rivers and lakes, with water over their beds', () => {
    const { hf, water, sea } = island('alpha');
    const s = { ...defaultTerrainSettings('tectonic', 'alpha', 2048), maxHeight: 200 };
    const doc = createMapDoc({ name: 'Thử sông hồ', kind: 'battle-royale', template: 'tectonic', terrain: s });
    doc.water = water;
    const map = toBattleMap(doc, hf);
    expect(map.waterGrid).toBeDefined();
    const gen = new WorldGenerator({ seed: normalizeSeed('studio-water'), sizeChunks: 64, seaLevel: sea, mode: 'battle-royale', battleIsland: map }, createDefaultRegistry());
    const col = makeColumnSample();
    // Along every river: the game has water there, above its ground, as a river.
    let checked = 0, wetCount = 0;
    for (const r of water.rivers) for (let q = 1; q < r.points.length - 1; q += 3) {
      const p = r.points[q]!;
      gen.sampleColumn(p.x, p.z, col);
      checked++;
      if (col.water === col.water && col.water > col.height && (col.waterKind === WaterKind.River || col.waterKind === WaterKind.Lake)) wetCount++;
    }
    expect(wetCount / checked).toBeGreaterThan(.9);
    for (const l of water.lakes) {
      // A point inside the lake where the ground is below its level.
      let found = false;
      for (let j = 0; j < hf.rows && !found; j += 3) for (let i = 0; i < hf.cols; i += 3) {
        const x = i * hf.cell, z = j * hf.cell;
        if (!pointInPolygon(x, z, l.polygon) || hf.heightAt(x, z) > l.level - 1) continue;
        gen.sampleColumn(x, z, col);
        expect(col.waterKind).toBe(WaterKind.Lake);
        expect(col.water).toBeCloseTo(l.level, 1);
        found = true; break;
      }
      expect(found).toBe(true);
    }
    // And dry land stays dry.
    const wet = rasterizeWater(hf, water), n = hf.cols;
    const dry = hf.heights.findIndex((h, k) => h > sea + 20 && k % 7 === 0 && [0, 1, -1, n, -n, n + 1, -n - 1].every((o) => !(wet.level[k + o]! === wet.level[k + o]!)));
    gen.sampleColumn((dry % hf.cols) * hf.cell, Math.floor(dry / hf.cols) * hf.cell, col);
    expect(col.water === col.water && col.water > col.height).toBe(false);
  }, 180_000);
});
