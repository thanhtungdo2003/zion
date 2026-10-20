import { describe, expect, it } from 'vitest';
import { Group } from 'three';
import { fittedSpec, type WeaponSpec } from './weapons';

const table = { url: '/models/accessorys/scope-4x.bbmodel', length: 0.17, barrel: [0, 0, -1], up: [0, 1, 0], grip: [0, 0, -3.5], eye: [0, 4.5, 6.7], mountLength: 0.32 } as WeaponSpec;

describe('ModelGen accessory fitting', () => {
  it('zion_attachment replaces the table pivot, axes, eyepiece and sizes', () => {
    const spec = fittedSpec(table, {
      root: new Group(), boneNames: [], clips: new Map(),
      attachment: { barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 0, 0], eye: [0, 12, -40], length: 0.3, mountLength: 0.28, lens: 'lens' },
    });
    expect(spec.barrel).toEqual([0, 0, 1]);
    expect(spec.eye).toEqual([0, 12, -40]);
    expect(spec.mountLength).toBe(0.28);
    expect(spec.url).toBe(table.url);
  });
  it('models without metadata keep the table spec', () => {
    expect(fittedSpec(table, { root: new Group(), boneNames: [], clips: new Map() })).toBe(table);
  });
});
