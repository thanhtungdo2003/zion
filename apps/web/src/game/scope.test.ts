import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { ATTACHMENTS } from '@zion/shared';
import { scopeFov } from './scope';

describe('scope optics', () => {
  it.each(['scope_2x', 'scope_4x', 'nv_scope_6x', 'scope_8x', 'scope_10x'])('magnifies projected targets by the mounted optic %s', (optic) => {
    const spec = { scope: ATTACHMENTS[optic]!.magnification! };
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
