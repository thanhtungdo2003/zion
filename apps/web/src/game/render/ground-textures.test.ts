import { describe, expect, it } from 'vitest';
import { Surface, SURFACE_COUNT } from '@zion/shared';
import { GROUND_LAYER_COUNT, GROUND_LAYERS, slopeToRock, surfaceLayers } from './ground-textures';

describe('ground layers', () => {
  const w = new Float32Array(GROUND_LAYER_COUNT);
  it('gives every surface a material, any climate', () => {
    for (let s = 0; s < SURFACE_COUNT; s++) for (const [t, h] of [[0, 0], [.5, .5], [1, 1], [.8, .2]] as const) {
      surfaceLayers(s as Surface, t, h, w);
      expect(w.reduce((a, b) => a + b, 0)).toBeGreaterThan(.99);
    }
  });
  it('turns steep natural ground to rock but keeps roads', () => {
    surfaceLayers(Surface.Grass, .5, .5, w);
    slopeToRock(Surface.Grass, .5, w);
    expect(w[GROUND_LAYERS.indexOf('rock')]).toBeCloseTo(1);
    surfaceLayers(Surface.Asphalt, .5, .5, w);
    slopeToRock(Surface.Asphalt, .5, w);
    expect(w[GROUND_LAYERS.indexOf('asphalt')]).toBeCloseTo(1);
  });
});
