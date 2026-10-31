import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '@zion/assets';
import { buildCatalog } from './catalog';
import { generateSettlement, Heightfield, presetSettings, type SettlementResult } from '../index';

describe('settlement catalogue: whole house models, no kit buildings', () => {
  it('keeps the built-in houses and adds the Model Studio ones by lot class', () => {
    const registry = createDefaultRegistry(), base = registry.byNumericId(2402)!;
    registry.registerUploaded({ ...structuredClone(base), id: 'studio.house_3001', numericId: 3001, name: 'house 3001', category: 'structure', tags: ['model-studio', 'lot:residential'] } as never);
    const c = buildCatalog(registry, { noKits: true });
    expect(c.noKits).toBe(true);
    const residential = c.buildings.residential.map((b) => b.asset);
    expect(residential).toContain(3001);
    expect(residential).toContain(2402);
  });

  it('builds a town of whole models only: no brick / concrete kit buildings', () => {
    const run = <T>(gen: Generator<unknown, T>): T => { for (;;) { const r = gen.next(); if (r.done) return r.value; } };
    const terrain = new Heightfield(1024, 4);
    terrain.heights.fill(30);
    const polygon: Array<[number, number]> = [[300, 300], [700, 300], [700, 700], [300, 700]];
    const result: SettlementResult = run(generateSettlement({ polygon, seed: 'x', settings: presetSettings('small-city'), terrain, water: { lakes: [], rivers: [] }, seaLevel: 5, externalRoads: [], obstacles: [], catalog: buildCatalog(createDefaultRegistry(), { noKits: true }) }));
    expect(result.buildings.length).toBeGreaterThan(0);
    expect(result.buildings.some((b) => b.recipe)).toBe(false);
  });
});
