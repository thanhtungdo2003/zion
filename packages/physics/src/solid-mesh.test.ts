import { describe, expect, it } from 'vitest';
import { CollisionWorld, Layer, makeBox, makeRayHit } from './index';

/** Two walls 1.2 m apart (x = ±0.6), 3 m tall, 4 m long along z — a gap a person fits through. */
function walls(): Float32Array {
  const quad = (x: number) => [x, 0, -2, x, 3, -2, x, 0, 2, x, 3, -2, x, 3, 2, x, 0, 2];
  return new Float32Array([...quad(-.6), ...quad(.6)]);
}

describe('solid model colliders (uploaded maps)', () => {
  const world = () => {
    const w = new CollisionWorld({ worldSize: 256, seaLevel: 0 });
    w.addHitMesh(2900, { tris: walls() });
    w.setOwnerColliders(1, [{ shape: makeBox(100, 1.5, 100, 2, 1.6, 2.5, 0), layer: Layer.Static, tag: 2900, solid: true, hit: { mesh: 2900, x: 100, y: 0, z: 100, c: 1, s: 0, k: 1 } }]);
    return w;
  };
  it('a capsule fits in the gap between the walls and is pushed out of a wall', () => {
    const w = world();
    expect(w.overlapsCapsule(100, .4, 100, 100, 1.4, 100, .35, Layer.Static)).toBe(false);
    expect(w.overlapsCapsule(100.5, .4, 100, 100.5, 1.4, 100, .35, Layer.Static)).toBe(true);
  });
  it('a ray down the gap passes; one across it stops at the wall', () => {
    const w = world(), hit = makeRayHit();
    expect(w.raycast(100, 1, 95, 0, 0, 1, 10, Layer.Static, hit)).toBe(false);
    expect(w.raycast(98, 1, 100, 1, 0, 0, 10, Layer.Static, hit)).toBe(true);
    expect(hit.t).toBeCloseTo(1.4, 2);
  });
  it('nothing collides before the model’s triangles are known', () => {
    const w = new CollisionWorld({ worldSize: 256, seaLevel: 0 });
    w.setOwnerColliders(1, [{ shape: makeBox(100, 1.5, 100, 2, 1.6, 2.5, 0), layer: Layer.Static, tag: 2900, solid: true, hit: { mesh: 2900, x: 100, y: 0, z: 100, c: 1, s: 0, k: 1 } }]);
    expect(w.overlapsCapsule(100.6, .4, 100, 100.6, 1.4, 100, .35, Layer.Static)).toBe(false);
  });
});
