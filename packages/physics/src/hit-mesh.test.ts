import { describe, expect, it } from 'vitest';
import { CollisionWorld } from './world';
import { Heightfield } from './heightfield';
import { Layer, Mask } from './layers';
import { makeBox, makeRayHit } from './shapes';

/** A 2 × 2 m wall panel at z = 10, of which the model only fills the left half (x < 10). */
function scene(): CollisionWorld {
  const w = new CollisionWorld({ worldSize: 32, seaLevel: -50 });
  const hit = { mesh: 77, x: 10, y: 0, z: 10, c: 1, s: 0, k: 1 };
  w.addChunk(0, 0, new Heightfield(0, 0, 1, 33, new Float32Array(33 * 33), new Float32Array(33 * 33).fill(NaN)), [
    { shape: makeBox(10, 1, 10, 1, 1, .1), layer: Layer.Static, tag: 77, hit },
  ]);
  // Local model: a 1 m × 2 m quad from x −1…0, y 0…2 at z 0.
  w.setHitMeshes(new Map([[77, { tris: Float32Array.from([-1, 0, 0, 0, 0, 0, 0, 2, 0, -1, 0, 0, 0, 2, 0, -1, 2, 0]) }]]));
  return w;
}

describe('precise shot geometry', () => {
  it('shots pass through the open part of a collider and stop on the model itself', () => {
    const w = scene(), hit = makeRayHit();
    expect(w.raycast(10.5, 1, 5, 0, 0, 1, 20, Mask.Weapon, hit)).toBe(false);
    expect(w.raycast(9.5, 1, 5, 0, 0, 1, 20, Mask.Weapon, hit)).toBe(true);
    expect(hit.t).toBeCloseTo(5, 5);
    expect(hit.nz).toBeCloseTo(-1, 5);
    // Movement and sight still use the coarse collider.
    expect(w.raycast(10.5, 1, 5, 0, 0, 1, 20, Mask.LineOfSight, hit)).toBe(true);
  });
  it('follows the prop transform (turned and scaled)', () => {
    const w = new CollisionWorld({ worldSize: 32, seaLevel: -50 });
    // Turned 90°: local −X now points to world +Z; scale 2 doubles the quad.
    const hit = { mesh: 77, x: 10, y: 0, z: 10, c: Math.cos(Math.PI / 2), s: Math.sin(Math.PI / 2), k: 2 };
    w.addChunk(0, 0, new Heightfield(0, 0, 1, 33, new Float32Array(33 * 33), new Float32Array(33 * 33).fill(NaN)), [
      { shape: makeBox(10, 2, 11, .2, 2, 2), layer: Layer.Static, tag: 77, hit },
    ]);
    w.setHitMeshes(new Map([[77, { tris: Float32Array.from([-1, 0, 0, 0, 0, 0, 0, 2, 0, -1, 0, 0, 0, 2, 0, -1, 2, 0]) }]]));
    const h = makeRayHit();
    expect(w.raycast(5, 1, 11, 1, 0, 0, 20, Mask.Weapon, h)).toBe(true);
    expect(h.t).toBeCloseTo(5, 4);
    expect(w.raycast(5, 1, 9, 1, 0, 0, 20, Mask.Weapon, h)).toBe(false);
  });
});
