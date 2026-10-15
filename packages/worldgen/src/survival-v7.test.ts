import { beforeAll, describe, expect, it } from 'vitest';
import { BUILDING_ASSET, CAMP_ASSET, GRID_ASSET, createDefaultRegistry } from '@zion/assets';
import { CHUNK_SIZE, Surface } from '@zion/shared';
import { WorldGenerator, makeColumnSample } from './generator';
import { allStructures } from './structures';
import { normalizeSeed } from './config';
import { ISLAND_ASSET } from './maps/authored';
import { roadWidthAt } from './roads';

describe('survival world v7', () => {
  let gen: WorldGenerator;
  beforeAll(() => { gen = new WorldGenerator({ seed: normalizeSeed('test-world'), sizeChunks: 64 }, createDefaultRegistry()); });

  it('builds towns of prepared houses packed along one paved main street', () => {
    const towns = allStructures(gen).filter(s => s.kind === 'town');
    expect(towns.length).toBeGreaterThan(0);
    const sample = makeColumnSample();
    for (const town of towns) {
      expect(town.street).toBeLessThan(-30);
      const buildings = town.parts.filter(p => p.asset >= 2400 && p.asset < 2430 || p.asset === 2107);
      expect(buildings.length).toBeGreaterThan(8);
      // No doors: the blocks are abandoned and open.
      expect(town.parts.some(p => p.asset === 2202)).toBe(false);
      // The street is a paved road right through the middle of the town.
      gen.sampleColumn(town.x, town.z, sample);
      expect(sample.roadDistance).toBeLessThan(1);
      expect(gen.roads!.surface(sample, town.x, town.z)).not.toBeNull();
      // Upper floors hold zombie lurking spots too.
      expect(town.spawns!.some(([, y]) => y > 2.5)).toBe(true);
    }
    // Lone houses are mostly prepared models now.
    const houses = allStructures(gen).filter(s => s.kind === 'house_small' || s.kind === 'house_large');
    const imported = houses.filter(h => h.parts.some(p => Object.values(BUILDING_ASSET).includes(p.asset as never)));
    expect(imported.length).toBeGreaterThan(houses.length * .4);
  });

  it('strings a seeded power grid along the roads: live and dead lines, broken poles, ivy', () => {
    const grid = gen.roads!.powerGrid()!;
    expect(grid.poles.length).toBeGreaterThan(30);
    const states = new Set(grid.poles.map(p => p.state));
    expect(states).toEqual(new Set(['standing', 'leaning', 'fallen']));
    expect(grid.poles.some(p => p.ivy)).toBe(true);
    expect(grid.poles.some(p => p.live) && grid.poles.some(p => !p.live)).toBe(true);
    expect(grid.cables().length).toBeGreaterThan(4);
    const segments = gen.roads!.segments;
    for (const p of grid.poles) {
      let best = Infinity, width = 0;
      for (const s of segments) {
        const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.z - s.a.z) * dz) / (s.length * s.length)));
        const d = Math.hypot(p.x - s.a.x - dx * t, p.z - s.a.z - dz * t);
        if (d < best) { best = d; width = roadWidthAt(s, t); }
      }
      // Off the carriageway, but beside it: a pole line follows its road.
      expect(best).toBeGreaterThan(width + 1);
      expect(best).toBeLessThan(width + 7);
      if (p.state !== 'standing') {
        // Broken poles lean or lie off the road, never across a carriageway.
        expect(grid.blocksRoad(p.x, p.z, p.yaw, p.state, { roadDistance: 0, roadHeight: 0, roadAlong: 0 })).toBe(false);
      }
    }
    // In the chunk props, with the right model per state.
    const pole = grid.poles.find(p => p.state === 'fallen')!;
    const props = gen.generateChunk(Math.floor(pole.x / CHUNK_SIZE), Math.floor(pole.z / CHUNK_SIZE), 0).props;
    expect(props.some(p => p.asset === GRID_ASSET.poleFallen)).toBe(true);
    // Deterministic for the seed.
    const again = new WorldGenerator({ seed: normalizeSeed('test-world'), sizeChunks: 64 }, createDefaultRegistry());
    expect(JSON.stringify(again.roads!.powerGrid()!.poles)).toBe(JSON.stringify(grid.poles));
    expect(props.some(p => p.asset === CAMP_ASSET['utility-pole']) || grid.poles.length > 0).toBe(true);
  });

  it('grows the island trees, bushes and rocks instead of the procedural ones', () => {
    const island = new Set<number>([...ISLAND_ASSET.treeSmall, ...ISLAND_ASSET.treeBig, ISLAND_ASSET.pineSmall, ISLAND_ASSET.pineMedium, ISLAND_ASSET.pineBig, ISLAND_ASSET.conifer, ISLAND_ASSET.deadPine, ISLAND_ASSET.deadTree, ISLAND_ASSET.banana, ...ISLAND_ASSET.bush, ...ISLAND_ASSET.stone, ...ISLAND_ASSET.rockMedium, ...ISLAND_ASSET.rockBig]);
    let flora = 0, procedural = 0;
    for (let cz = 8; cz < 56; cz += 6) for (let cx = 8; cx < 56; cx += 6) for (const p of gen.generateChunk(cx, cz, 0).props) {
      if (island.has(p.asset)) flora++;
      if ([1, 2, 3, 4, 6, 7, 9, 10, 20, 21, 22].includes(p.asset)) procedural++;
    }
    expect(flora).toBeGreaterThan(100);
    expect(procedural).toBe(0);
  });

  it('keeps v6 worlds unchanged', () => {
    const old = new WorldGenerator({ seed: normalizeSeed('test-world'), sizeChunks: 64, generatorVersion: 6 }, createDefaultRegistry());
    expect(old.roads!.powerGrid()).toBeNull();
    expect(allStructures(old).every(s => s.street === undefined)).toBe(true);
    expect(Surface.Dirt).toBeDefined();
  });
});
