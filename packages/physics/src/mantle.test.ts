import { describe, expect, it } from 'vitest';
import { CharacterController, CollisionWorld, Heightfield, Layer, createCharacterState, makeBox } from './index';

/** Flat ground with a block `height` m tall whose face is 0.5 m ahead (−Z) of (40, 40). */
function world(height: number, ceiling = false): CollisionWorld {
  const w = new CollisionWorld({ worldSize: 96, seaLevel: -50 });
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) w.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089).fill(0), new Float32Array(1089).fill(NaN)), []);
  w.setOwnerColliders(1, [{ shape: makeBox(40, height / 2, 37.5 - 2, 3, height / 2, 2), layer: Layer.Static }]);
  if (ceiling) w.setOwnerColliders(2, [{ shape: makeBox(40, height + 1.2, 34, 3, .2, 3), layer: Layer.Static }]);
  return w;
}
const run = (w: CollisionWorld, jump: boolean, ticks = 60) => {
  const c = new CharacterController(w), s = createCharacterState(40, 0, 39);
  for (let i = 0; i < 10; i++) c.step(s, { mx: 0, mz: 0, yaw: 0, jump: false, sprint: false }, 1 / 30);
  let mantled = false;
  for (let i = 0; i < ticks; i++) { const info = c.step(s, { mx: 0, mz: 1, yaw: 0, jump: jump && i < 40, sprint: false }, 1 / 30); mantled ||= !!info.mantled; }
  return { s, mantled };
};

describe('mantle (W + Space at a ledge)', () => {
  it('climbs a wall too high to jump onto and ends standing on top', () => {
    const { s, mantled } = run(world(1.8), true);
    expect(mantled).toBe(true);
    expect(s.mantle).toBeUndefined();
    expect(s.y).toBeCloseTo(1.82, 1);
    expect(s.z).toBeLessThan(37.4);
    expect(s.grounded).toBe(true);
  });
  it('does not mantle without Space, onto a wall out of reach, or under a low ceiling', () => {
    expect(run(world(1.8), false).s.y).toBeLessThan(.1);
    expect(run(world(3), true).mantled).toBe(false);
    expect(run(world(1.8, true), true).mantled).toBe(false);
  });
  it('a low obstacle is still a plain jump', () => {
    expect(run(world(.6), true).mantled).toBe(false);
  });
});
