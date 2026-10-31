import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '@zion/assets';
import { buildCatalog } from './catalog';

describe('settlement catalogue: Model Studio houses only', () => {
  it('has no houses until some are published, and never the built-in ones', () => {
    const c = buildCatalog(createDefaultRegistry(), { studioOnly: true });
    expect(c.studioOnly).toBe(true);
    for (const list of Object.values(c.buildings)) expect(list).toEqual([]);
    // Without the option (previews, tests): the built-in houses as before.
    expect(buildCatalog(createDefaultRegistry()).buildings.residential.length).toBeGreaterThan(0);
  });

  it('takes the published houses by lot class, borrowing for a class with none', () => {
    const registry = createDefaultRegistry(), base = registry.byNumericId(2402)!;
    const house = (numericId: number, lot: string) => registry.registerUploaded({
      ...structuredClone(base), id: `studio.house_${numericId}`, numericId, name: `house ${numericId}`, category: 'structure', tags: ['model-studio', `lot:${lot}`],
    } as never);
    house(3001, 'residential'); house(3002, 'military');
    const c = buildCatalog(registry, { studioOnly: true });
    expect(c.buildings.residential.map((b) => b.asset)).toEqual([3001]);
    expect(c.buildings.military.map((b) => b.asset)).toEqual([3002]);
    expect(c.buildings.commercial.map((b) => b.asset)).toEqual([3001]);
    expect(c.buildings.abandoned.map((b) => b.asset)).toEqual([3001]);
  });
});
