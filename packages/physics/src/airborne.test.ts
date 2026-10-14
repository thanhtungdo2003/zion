import { describe, expect, it } from 'vitest';
import { CharacterController, CollisionWorld, Heightfield, Layer, createCharacterState, doorColliders, makeBox, stepAirborne } from './index';

function world(height = 0): CollisionWorld {
  const w = new CollisionWorld({ worldSize: 96, seaLevel: -50 });
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) w.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089).fill(height), new Float32Array(1089).fill(NaN)), []);
  return w;
}
const idle = { mx: 0, mz: 0, yaw: 0, jump: false, sprint: false };
describe('Battle Royale airborne movement', () => {
  it('freefalls without steering, glides on movement and dives faster with Shift', () => {
    const w = world(), idleState = createCharacterState(40, 600, 40), glide = createCharacterState(40, 600, 40), dive = createCharacterState(40, 600, 40);
    idleState.flight = glide.flight = dive.flight = 2;
    for (let i = 0; i < 60; i++) {
      stepAirborne(idleState, idle, w, 1 / 30);
      stepAirborne(glide, { ...idle, mz: 1 }, w, 1 / 30);
      stepAirborne(dive, { ...idle, mz: 1, sprint: true }, w, 1 / 30);
    }
    expect(idleState.x).toBe(40); expect(idleState.z).toBe(40);
    expect(glide.z).toBeLessThan(30); expect(dive.y).toBeLessThan(glide.y - 40);
  });
  it('opens manually with Space and automatically 120 metres above elevated terrain', () => {
    const w = world(80), manual = createCharacterState(40, 600, 40), auto = createCharacterState(40, 199, 40);
    manual.flight = auto.flight = 2;
    // Space does nothing in the first 10 s of freefall, then opens the canopy.
    stepAirborne(manual, { ...idle, jump: true }, w, 1 / 30); expect(manual.flight).toBe(2);
    manual.y = 600; manual.freefall = 10;
    stepAirborne(manual, { ...idle, jump: true }, w, 1 / 30); expect(manual.flight).toBe(3);
    stepAirborne(auto, idle, w, 1 / 30); expect(auto.flight).toBe(3);
    for (let i = 0; i < 90; i++) stepAirborne(manual, idle, w, 1 / 30);
    expect(manual.vy).toBeCloseTo(-7, 2);
  });
  it('lands safely on roofs, removes the canopy and waits for unloaded terrain', () => {
    const w = world(), s = createCharacterState(40, 25, 40); s.flight = 3;
    w.setOwnerColliders(1, [{ shape: makeBox(40, 9.8, 40, 5, .2, 5), layer: Layer.Static }]);
    for (let i = 0; i < 150 && s.flight; i++) stepAirborne(s, idle, w, 1 / 30);
    expect(s.flight).toBe(0); expect(s.grounded).toBe(true); expect(s.y).toBeCloseTo(10.02, 1);
    const unloaded = new CollisionWorld({ worldSize: 96, seaLevel: -50 }), waiting = createCharacterState(40, 150, 40); waiting.flight = 2;
    stepAirborne(waiting, idle, unloaded, 1 / 30); expect(waiting.y).toBe(150);
    // High above unstreamed ground the fall continues (prediction must not freeze up there).
    const high = createCharacterState(40, 600, 40); high.flight = 2;
    stepAirborne(high, idle, unloaded, 1 / 30); expect(high.y).toBeLessThan(600);
  });
});
describe('interactive door clearance', () => {
  for (const yaw of [0, .7, Math.PI / 2]) it(`blocks a closed door and walks through the open frame at yaw ${yaw}`, () => {
    const w = world(), controller = new CharacterController(w);
    const pose = { x: 48, y: 0, z: 48, yaw, open: false };
    const walk = () => {
      const s = createCharacterState(48 + Math.sin(yaw) * 2, 0, 48 + Math.cos(yaw) * 2); s.grounded = true;
      for (let i = 0; i < 50; i++) controller.step(s, { ...idle, mz: 1, yaw }, 1 / 30);
      return (s.x - 48) * Math.sin(yaw) + (s.z - 48) * Math.cos(yaw);
    };
    w.setOwnerColliders(2, doorColliders(pose)); expect(walk()).toBeGreaterThan(.3);
    w.setOwnerColliders(2, doorColliders({ ...pose, open: true })); expect(walk()).toBeLessThan(-2);
  });
});
