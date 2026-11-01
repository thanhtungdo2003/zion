import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '@zion/assets';
import { WorldGenerator, makeColumnSample, normalizeSeed } from '@zion/worldgen';
import { Heightfield, createMapDoc, defaultTerrainSettings, toBattleMap } from '@zion/worldgen/editor';
import { battleParking, battleVehicleCount } from './vehicles';

/** A wild studio map: an island of open ground with a lake, no roads and no settlements at all. */
function wildMap(vehicles?: number) {
  const s = defaultTerrainSettings('plains', 'wild', 1024), hf = new Heightfield(s.size, s.cell);
  for (let j = 0; j < hf.rows; j++) for (let i = 0; i < hf.cols; i++) {
    const d = Math.hypot(i - 512, j - 512);
    hf.heights[j * hf.cols + i] = d < 420 ? 26 + Math.sin(i * .01) * 2 : 12;
  }
  const doc = createMapDoc({ name: 'Đảo hoang', kind: 'battle-royale', template: 'plains', terrain: s });
  doc.gameplay[0]!.vehicles = vehicles;
  // A lake in the middle: no vehicle may be parked in it.
  doc.water.lakes.push({ id: 'l', name: 'Hồ', level: 27.5, depth: 3, polygon: [[400, 400], [620, 400], [620, 620], [400, 620]] });
  for (let j = 400; j <= 620; j++) for (let i = 400; i <= 620; i++) hf.heights[j * hf.cols + i] = 24;
  return toBattleMap(doc, hf);
}

describe('battle royale vehicles', () => {
  it('parks the configured number of vehicles even on a map without roads or towns, never in the water', () => {
    const map = wildMap(30);
    const gen = new WorldGenerator({ seed: normalizeSeed('wild'), sizeChunks: 32, seaLevel: 20, mode: 'battle-royale', battleIsland: map }, createDefaultRegistry());
    expect(battleVehicleCount(gen)).toBe(30);
    const spots = battleParking(gen, battleVehicleCount(gen)), col = makeColumnSample();
    expect(spots.length).toBeGreaterThanOrEqual(30);
    for (const p of spots) {
      gen.sampleColumn(p.x, p.z, col);
      expect(col.height).toBeGreaterThan(20);
      expect(col.water === col.water && col.water > col.height).toBe(false);
    }
    // Spread out, not stacked in one place.
    for (let a = 0; a < spots.length; a++) for (let b = a + 1; b < spots.length; b++) expect(Math.hypot(spots[a]!.x - spots[b]!.x, spots[a]!.z - spots[b]!.z)).toBeGreaterThan(20);
  });

  it('defaults to 36 vehicles when the map does not say', () => {
    const gen = new WorldGenerator({ seed: normalizeSeed('wild'), sizeChunks: 32, seaLevel: 20, mode: 'battle-royale', battleIsland: wildMap() }, createDefaultRegistry());
    expect(battleVehicleCount(gen)).toBe(36);
    expect(battleParking(gen, 36).length).toBeGreaterThanOrEqual(36);
  });
});
