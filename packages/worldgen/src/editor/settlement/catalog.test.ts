import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '@zion/assets';
import type { LotFit } from '@zion/shared';
import { buildCatalog } from './catalog';
import { generateSettlement, Heightfield, presetSettings, type SettlementResult } from '../index';

const run = <T>(gen: Generator<unknown, T>): T => { for (;;) { const r = gen.next(); if (r.done) return r.value; } };
const town = (catalog: ReturnType<typeof buildCatalog>, preset: Parameters<typeof presetSettings>[0], seed = 'y'): SettlementResult => {
  const terrain = new Heightfield(1024, 4);
  terrain.heights.fill(30);
  const polygon: Array<[number, number]> = [[300, 300], [700, 300], [700, 700], [300, 700]];
  return run(generateSettlement({ polygon, seed, settings: presetSettings(preset), terrain, water: { lakes: [], rivers: [] }, seaLevel: 5, externalRoads: [], obstacles: [], catalog }));
};
const studioHouse = (registry: ReturnType<typeof createDefaultRegistry>, numericId: number, extra: { tags?: string[]; fit?: LotFit }) => {
  const base = registry.byNumericId(2402)!;
  registry.registerUploaded({ ...structuredClone(base), id: `studio.model_${numericId}`, numericId, name: `house ${numericId}`, category: 'structure', tags: ['model-studio', ...(extra.tags ?? ['kind:building'])], ...(extra.fit ? { fit: extra.fit } : {}) } as never);
};

describe('settlement catalogue: whole house models, no kit buildings', () => {
  it('builds a town of whole models only: no brick / concrete kit buildings', () => {
    const result = town(buildCatalog(createDefaultRegistry(), { noKits: true }), 'small-city', 'x');
    expect(result.buildings.length).toBeGreaterThan(0);
    expect(result.buildings.some((b) => b.recipe)).toBe(false);
  });

  it('reads where a Studio house fits: its lots, conditions and kinds of area; old single classes too', () => {
    const registry = createDefaultRegistry();
    studioHouse(registry, 3001, { fit: { lots: ['military', 'industrial'], conditions: ['abandoned', 'ruined'], areas: ['military-base'] } });
    studioHouse(registry, 3002, { tags: ['kind:building', 'lot:abandoned'] });
    studioHouse(registry, 3003, { tags: ['kind:vehicle'] });
    studioHouse(registry, 3004, { tags: [] });
    // Left as "prop" (new projects start so) but the size of a house: still a house.
    studioHouse(registry, 3006, { tags: ['kind:prop'] });
    const c = buildCatalog(registry, { noKits: true }), fit = (a: number) => c.studio!.find((s) => s.asset === a)?.fit;
    expect(fit(3001)).toEqual({ lots: ['military', 'industrial'], conditions: ['abandoned', 'ruined'], areas: ['military-base'] });
    expect(fit(3002)).toEqual({ lots: ['residential'], conditions: ['abandoned', 'ruined'], areas: [] });
    expect(fit(3003)).toBeUndefined();
    expect(fit(3004)).toEqual({ lots: ['residential', 'commercial'], conditions: ['intact'], areas: [] });
    expect(fit(3006)).toEqual({ lots: ['residential', 'commercial'], conditions: ['intact'], areas: [] });
  });

  it('places Studio houses where they fit and ahead of the built-in ones, never elsewhere', () => {
    const registry = createDefaultRegistry();
    studioHouse(registry, 3005, { fit: { lots: ['residential'], conditions: ['intact', 'abandoned', 'ruined'], areas: ['small-village'] } });
    const c = buildCatalog(registry, { noKits: true });
    const village = town(c, 'small-village');
    expect(village.buildings.filter((b) => b.asset === 3005).length).toBeGreaterThan(village.buildings.length * .3);
    expect(town(c, 'military-base').buildings.some((b) => b.asset === 3005)).toBe(false);
    // And it says so.
    expect(village.issues.some((i) => i.code === 'studio-houses' && /Nhà Model Studio/.test(i.message))).toBe(true);
  });

  it('varies the houses of a street: no model repeated while others fit', () => {
    const registry = createDefaultRegistry();
    for (let k = 0; k < 6; k++) studioHouse(registry, 3010 + k, {});
    const result = town(buildCatalog(registry, { noKits: true }), 'residential-district');
    const counts = new Map<number, number>();
    for (const b of result.buildings) counts.set(b.asset, (counts.get(b.asset) ?? 0) + 1);
    const studio = [...counts].filter(([a]) => a >= 3010 && a < 3016);
    expect(studio.length).toBe(6);
    const most = Math.max(...studio.map(([, n]) => n)), least = Math.min(...studio.map(([, n]) => n));
    expect(most - least).toBeLessThanOrEqual(Math.max(2, Math.ceil(most * .5)));
  });

  it('sets plots aside for the school and clinic and puts the models of that type there only', () => {
    const registry = createDefaultRegistry();
    studioHouse(registry, 3020, { fit: { lots: ['residential'], conditions: ['intact'], areas: [], types: ['school'] } });
    studioHouse(registry, 3021, { fit: { lots: ['residential'], conditions: ['intact'], areas: [], types: ['school'] } });
    for (let k = 0; k < 3; k++) studioHouse(registry, 3022 + k, { fit: { lots: ['residential', 'commercial'], conditions: ['intact'], areas: [], types: ['house'] } });
    const result = town(buildCatalog(registry, { noKits: true }), 'rural-town');
    const schoolLots = new Set(result.lots.filter((l) => l.use === 'school').map((l) => l.id));
    expect(schoolLots.size).toBeGreaterThan(0);
    expect(result.lots.some((l) => l.use === 'clinic') && result.lots.some((l) => l.use === 'market')).toBe(true);
    const schools = result.buildings.filter((b) => b.asset === 3020 || b.asset === 3021);
    expect(schools.length).toBeGreaterThan(0);
    expect(schools.every((b) => schoolLots.has(b.lot!))).toBe(true);
    // No model made for this town's hospital or police: said so.
    expect(result.issues.some((i) => i.code === 'missing-types')).toBe(true);
  });
});
