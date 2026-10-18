import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '@zion/assets';
import { BUILDING_ASSET } from '@zion/assets';
import { DEFAULT_INFECTION_MAP, blankInfectionMap, infectionMapSchema, upgradeInfectionMaps } from '@zion/shared';
import { WorldGenerator } from './generator';
import { GENERATOR_VERSION } from './config';
import { WAREHOUSE, infectionHeight, infectionLayers, infectionSpawns, infectionStructures, infectionZombieSpawns } from './maps/infection-map';

const registry = createDefaultRegistry();
const world = (infection = DEFAULT_INFECTION_MAP) => new WorldGenerator({ seed: 7, sizeChunks: 16, seaLevel: 20, generatorVersion: GENERATOR_VERSION, mode: 'infection', infection }, registry);

describe('studio infection maps', () => {
  it('keeps the built-in map: the Warehouse model on sunken ground, banks around it and its spawns', () => {
    const gen = world();
    expect(infectionMapSchema.safeParse(DEFAULT_INFECTION_MAP).success).toBe(true);
    expect(DEFAULT_INFECTION_MAP.name).toBe('Warehouse');
    // Under the model the terrain sits below its pits; the model's floor is at the old ground level.
    expect(infectionHeight(gen, 256, 256)).toBeLessThan(30 - WAREHOUSE.sink);
    const site = infectionStructures(gen).find((s) => s.parts.some((p) => p.asset === WAREHOUSE.asset))!;
    expect(site.y + WAREHOUSE.sink).toBeCloseTo(30);
    expect(infectionHeight(gen, 256 + 140, 256)).toBeGreaterThan(50);
    expect(infectionLayers(gen).wall).toHaveLength(0);
    expect(infectionSpawns(gen).length).toBeGreaterThan(20);
  });

  it('switches worlds saved with The Street to the Warehouse', () => {
    const street = { ...structuredClone(DEFAULT_INFECTION_MAP), id: 'friday-13', name: 'The Street', base: 'friday13' as const };
    const custom = blankInfectionMap('mine', 'Mine', 'x');
    expect(upgradeInfectionMaps({ active: 'friday-13', maps: [street, custom] })).toMatchObject({ active: 'warehouse', maps: [{ id: 'warehouse' }, { id: 'mine' }] });
    expect(upgradeInfectionMaps({ active: 'mine', maps: [street, custom] }).active).toBe('mine');
  });

  it('builds a map from its seed, size, nature density, placed parts and spawn points', () => {
    const def = blankInfectionMap('test', 'Test', 'abc');
    def.half = 60; def.environment.trees = 40;
    def.parts.push({ asset: BUILDING_ASSET.house, x: 10, y: .08, z: -12, yaw: 0, scale: 1 });
    def.spawns.push({ x: -20, z: 20 }); def.zombieSpawns.push({ x: 30, z: 30 });
    const gen = world(def), other = world({ ...def, seed: 'xyz' });
    // Hills come from the seed; the house sits on a levelled pad.
    const samples = [-40, -20, 0, 20, 40].map((o) => infectionHeight(gen, 256 + o, 256 + o * .7));
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(.3);
    expect(samples).not.toEqual([-40, -20, 0, 20, 40].map((o) => infectionHeight(other, 256 + o, 256 + o * .7)));
    const pad = infectionHeight(gen, 266, 244);
    expect(Math.abs(infectionHeight(gen, 268, 243) - pad)).toBeLessThan(.05);
    // Trees by density, none on the house; the house is a site of its own.
    const nature = infectionLayers(gen).nature;
    expect(nature.length).toBeGreaterThan(20);
    expect(nature.every((n) => Math.hypot(n.x - 10, n.z + 12) > 3)).toBe(true);
    expect(infectionStructures(gen).some((s) => s.parts[0]?.asset === BUILDING_ASSET.house && Math.hypot(s.x - 266, s.z - 244) < .01)).toBe(true);
    expect(infectionSpawns(gen)).toEqual([{ x: 236, z: 276 }]);
    expect(infectionZombieSpawns(gen)).toEqual([{ x: 286, z: 286 }]);
    // Chunks carry the parts.
    const chunk = gen.generateChunk(Math.floor(266 / 32), Math.floor(244 / 32), 0);
    expect(chunk.props.some((p) => p.asset === BUILDING_ASSET.house)).toBe(true);
  });
});
