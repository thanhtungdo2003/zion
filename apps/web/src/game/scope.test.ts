import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { WEAPON_SPECS, WeaponId } from '@zion/shared';
import { scopeFov } from './scope';

describe('scope optics', () => {
  it.each([WeaponId.AUG, WeaponId.AWM, WeaponId.Crossbow, WeaponId.SVD])('magnifies projected targets by the equipped optic for weapon %s', (weapon) => {
    const spec = WEAPON_SPECS[weapon];
    if (spec.kind !== 'gun' || !spec.scope) throw new Error('Expected an optic');
    const camera = new PerspectiveCamera(75, 16 / 9, .05, 1000);
    const point = new Vector3(.1, .1, -20);
    const normal = point.clone().project(camera);
    camera.fov = scopeFov(75, spec.scope);
    camera.updateProjectionMatrix();
    const scoped = point.clone().project(camera);
    expect(scoped.x / normal.x).toBeCloseTo(spec.scope, 10);
    expect(scoped.y / normal.y).toBeCloseTo(spec.scope, 10);
    expect(new Vector3(0, 0, -20).project(camera).x).toBe(0);
  });

  it('returns to the normal FOV when no magnification is applied', () => {
    expect(scopeFov(75, 1)).toBeCloseTo(75, 10);
  });
});
