import { describe, expect, it } from 'vitest';
import { MeshLambertMaterial, MeshStandardMaterial } from 'three';
import { surfaceMaterial, surfaceOf } from './material-labels';

describe('cube surface labels', () => {
  it('reads the label from a cube name', () => {
    expect(surfaceOf('stock#wood')).toBe('wood');
    expect(surfaceOf('receiver:upper#Steel')).toBe('steel');
    expect(surfaceOf('trim#golden')).toBe('gold');
    expect(surfaceOf('plate#aluminum')).toBe('aluminium');
    expect(surfaceOf('stock')).toBeNull();
    expect(surfaceOf('#woodland')).toBeNull();
  });
  it('gives each surface its light response, shared per base material', () => {
    const base = new MeshLambertMaterial();
    const gold = surfaceMaterial(base, 'gold'), wood = surfaceMaterial(base, 'wood');
    expect(gold).toBeInstanceOf(MeshStandardMaterial);
    expect(gold.metalness).toBe(1); expect(gold.roughness).toBeLessThan(.3);
    expect(wood.metalness).toBe(0); expect(wood.roughness).toBeGreaterThan(.8);
    expect(surfaceMaterial(base, 'gold')).toBe(gold);
  });
});
