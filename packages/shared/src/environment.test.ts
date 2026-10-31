import { describe, expect, it } from 'vitest';
import { applyEnvironmentPreset, defaultEnvironment, lightningFlash, mapEnvironmentSchema, readEnvironment, resolveWeather, sampleEnvironment, shapeDistance, zoneWeight, BIOMES, type EnvZone } from './environment';

const zone = (id: string, shape: EnvZone['shape'], biome: keyof typeof BIOMES, priority = 0, blend = 50): EnvZone =>
  ({ id, name: id, biome, shape, blend, priority, params: { ...BIOMES[biome].params } });

describe('map environment', () => {
  it('reads old maps (nothing stored) and bad data as the default', () => {
    expect(readEnvironment(undefined)).toEqual(defaultEnvironment());
    expect(readEnvironment({ weather: 'acid-rain' })).toEqual(defaultEnvironment());
    expect(defaultEnvironment().weather).toBe('clear');
  });

  it('survives a save and reload unchanged', () => {
    const env = { ...defaultEnvironment(), weather: 'thunderstorm' as const, zones: [zone('a', { kind: 'polygon', points: [[0, 0], [100, 0], [50, 80]] }, 'wet')] };
    expect(mapEnvironmentSchema.parse(JSON.parse(JSON.stringify(env)))).toEqual(env);
  });

  it('measures distance to circles, boxes and polygons', () => {
    expect(shapeDistance({ kind: 'circle', x: 0, z: 0, r: 10 }, 20, 0)).toBeCloseTo(10);
    expect(shapeDistance({ kind: 'box', x: 0, z: 0, hx: 10, hz: 5, yaw: 0 }, 0, 0)).toBeCloseTo(-5);
    expect(shapeDistance({ kind: 'box', x: 0, z: 0, hx: 10, hz: 5, yaw: Math.PI / 2 }, 0, 8)).toBeCloseTo(-2);
    expect(shapeDistance({ kind: 'polygon', points: [[0, 0], [10, 0], [10, 10], [0, 10]] }, 5, 5)).toBeCloseTo(-5);
    expect(shapeDistance({ kind: 'polygon', points: [[0, 0], [10, 0], [10, 10], [0, 10]] }, 15, 5)).toBeCloseTo(5);
  });

  it('blends a zone smoothly over its blend distance', () => {
    const z = zone('d', { kind: 'circle', x: 0, z: 0, r: 100 }, 'desert', 0, 50);
    expect(zoneWeight(z, 0, 0)).toBe(1);
    expect(zoneWeight(z, 125, 0)).toBeCloseTo(.5);
    expect(zoneWeight(z, 160, 0)).toBe(0);
    const env = { ...defaultEnvironment(), zones: [z] };
    const t = [0, 110, 120, 130, 140, 150].map((x) => sampleEnvironment(env, x, 0).temperature);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeLessThanOrEqual(t[i - 1]!);
    expect(t[0]).toBeCloseTo(41); expect(t[5]).toBeCloseTo(22);
  });

  it('lays overlapping zones by priority, whatever their order in the list', () => {
    const wet = zone('w', { kind: 'circle', x: 0, z: 0, r: 100 }, 'wet', 5), dry = zone('x', { kind: 'circle', x: 0, z: 0, r: 100 }, 'desert', 1);
    const a = sampleEnvironment({ ...defaultEnvironment(), zones: [wet, dry] }, 0, 0), b = sampleEnvironment({ ...defaultEnvironment(), zones: [dry, wet] }, 0, 0);
    expect(a).toEqual(b);
    expect(a.wetness).toBeCloseTo(BIOMES.wet.params.wetness);
  });

  it('gives every client the same weather and lightning for a seed and time', () => {
    const env = { ...defaultEnvironment(), weather: 'heavy-rain' as const, dynamic: true };
    for (const t of [0, 400, 1234.5, 9999]) expect(resolveWeather(env, 42, t)).toEqual(resolveWeather(env, 42, t));
    expect(resolveWeather({ ...env, dynamic: false }, 42, 5000).id).toBe('heavy-rain');
    let flashes = 0;
    for (let t = 0; t < 600; t += .05) if (lightningFlash(7, t, 1) > .5) flashes++;
    expect(flashes).toBeGreaterThan(0);
    expect(lightningFlash(7, 10, 0)).toBe(0);
  });

  it('applies a battlefield preset and keeps the map\'s zones', () => {
    const env = { ...defaultEnvironment(), zones: [zone('a', { kind: 'circle', x: 5, z: 5, r: 9 }, 'forest')] };
    const next = applyEnvironmentPreset(env, 'rainy-industrial');
    expect(next.weather).toBe('heavy-rain');
    expect(next.zones).toEqual(env.zones);
  });
});
