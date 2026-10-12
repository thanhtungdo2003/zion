import { describe, expect, it } from 'vitest';
import {
  CharacterController,
  CollisionWorld,
  Heightfield,
  Layer,
  Mask,
  closestSegmentSegment,
  createCharacterState,
  makeBox,
  makeCapsule,
  makeRayHit,
  makeSphere,
  raycastRig,
  HUMANOID_RIG,
  PRONE_SPEED,
  rayBox,
  rayCapsule,
  type CharacterInput,
  type ColliderInit,
} from './index';

const DT = 1 / 30;

/** Builds a world of `n`×`n` LOD0 chunks with heights from f(x,z). */
function makeWorld(f: (x: number, z: number) => number, colliders: ColliderInit[] = [], n = 3): CollisionWorld {
  const world = new CollisionWorld({ worldSize: n * 32, seaLevel: -50 });
  for (let cx = 0; cx < n; cx++) {
    for (let cz = 0; cz < n; cz++) {
      const verts = 33;
      const h = new Float32Array(verts * verts);
      for (let j = 0; j < verts; j++) for (let i = 0; i < verts; i++) h[j * verts + i] = f(cx * 32 + i, cz * 32 + j);
      const water = new Float32Array(verts * verts).fill(Number.NaN);
      const own = cx === 0 && cz === 0 ? colliders : [];
      world.addChunk(cx, cz, new Heightfield(cx * 32, cz * 32, 1, verts, h, water), own);
    }
  }
  return world;
}

function input(partial: Partial<CharacterInput> = {}): CharacterInput {
  return { mx: 0, mz: 0, yaw: 0, jump: false, sprint: false, ...partial };
}

function run(ctrl: CharacterController, s: ReturnType<typeof createCharacterState>, inp: CharacterInput, ticks: number) {
  for (let i = 0; i < ticks; i++) ctrl.step(s, inp, DT);
}

describe('prone movement', () => {
  it('crawls without sprinting, jumping or rolling', () => {
    const ctrl = new CharacterController(makeWorld(() => 0));
    const s = createCharacterState(16, 0, 16);
    s.grounded = true;
    run(ctrl, s, input({ prone: true, mz: 1, sprint: true, jump: true, roll: true }), 30);
    expect(s.prone).toBe(true);
    expect(s.grounded).toBe(true);
    expect(s.rollTicks).toBe(0);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(PRONE_SPEED);
    expect(s.y).toBeCloseTo(0, 1);
  });

  it('fits under a low roof and cannot stand until clear', () => {
    const ctrl = new CharacterController(makeWorld(() => 0, [{ shape: makeBox(16, 1.5, 16, 2, .5, 2), layer: Layer.Static }]));
    const s = createCharacterState(16, 0, 16);
    s.grounded = true;
    s.prone = true;
    run(ctrl, s, input(), 3);
    expect(s.prone).toBe(true);
    run(ctrl, s, input({ prone: true, mz: 1 }), 90);
    expect(s.z).toBeLessThan(14);
    ctrl.step(s, input(), DT);
    expect(s.prone).toBe(false);
  });
});

describe('geometry', () => {
  it('finds closest points between crossing segments', () => {
    const out = { s: 0, t: 0 };
    closestSegmentSegment(-1, 0, 0, 1, 0, 0, 0, -1, 1, 0, 1, 1, out);
    expect(out.s).toBeCloseTo(0.5);
    expect(out.t).toBeCloseTo(0.5);
  });

  it('raycasts boxes with rotation and capsules', () => {
    const box = makeBox(10, 0, 0, 1, 1, 1, Math.PI / 4);
    const n = { x: 0, y: 0, z: 0 };
    const t = rayBox(0, 0, 0, 1, 0, 0, box, n);
    // Rotated 45°, the nearest corner is at distance sqrt(2) from the centre.
    expect(t).toBeCloseTo(10 - Math.SQRT2, 4);
    const cap = makeCapsule(5, 0, 0, 5, 2, 0, 0.5);
    expect(rayCapsule(0, 1, 0, 1, 0, 0, cap)).toBeCloseTo(4.5, 5);
    expect(rayCapsule(0, 5, 0, 1, 0, 0, cap)).toBe(-1);
  });
});

describe('collision world', () => {
  it('samples terrain height consistently across chunk borders', () => {
    const world = makeWorld((x, z) => x * 0.25 + z * 0.1);
    for (const [x, z] of [[31.999, 10], [32, 10], [32.001, 10], [40.3, 63.7]] as const) {
      expect(world.terrainHeight(x, z)).toBeCloseTo(x * 0.25 + z * 0.1, 4);
    }
    expect(Number.isNaN(world.terrainHeight(200, 200))).toBe(true);
  });

  it('raycasts terrain and statics, reporting the nearest hit', () => {
    const world = makeWorld(() => 0, [{ shape: makeSphere(10, 1, 10, 1), layer: Layer.Static }]);
    const hit = makeRayHit();
    expect(world.raycast(10, 10, 10, 0, -1, 0, 100, Mask.Weapon, hit)).toBe(true);
    expect(hit.layer).toBe(Layer.Static);
    expect(hit.y).toBeCloseTo(2, 4);
    expect(world.raycast(20, 10, 20, 0, -1, 0, 100, Mask.Weapon, hit)).toBe(true);
    expect(hit.layer).toBe(Layer.Terrain);
    expect(hit.y).toBeCloseTo(0, 4);
    // Shallow ray across the terrain hits a hill.
    const hilly = makeWorld((x) => (x > 50 ? (x - 50) * 2 : 0));
    const d = 1 / Math.sqrt(1 + 0.0001);
    expect(hilly.raycast(5, 3, 40, d, -0.01 * d, 0, 200, Mask.LineOfSight, hit)).toBe(true);
    expect(hit.x).toBeGreaterThan(50);
    expect(hit.x).toBeLessThan(53);
  });

  it('removes chunk colliders when a chunk unloads', () => {
    const world = makeWorld(() => 0, [{ shape: makeBox(5, 1, 5, 1, 1, 1), layer: Layer.Static }]);
    expect(world.overlapsCapsule(5, 1, 5, 5, 2, 5, 0.3, Mask.CharacterMovement)).toBe(true);
    world.removeChunk(0, 0);
    expect(world.overlapsCapsule(5, 1, 5, 5, 2, 5, 0.3, Layer.Static)).toBe(false);
  });
});

describe('character controller', () => {
  it('falls under gravity and lands on flat ground', () => {
    const world = makeWorld(() => 10);
    const ctrl = new CharacterController(world);
    const s = createCharacterState(48, 20, 48);
    run(ctrl, s, input(), 90);
    expect(s.grounded).toBe(true);
    expect(s.y).toBeCloseTo(10, 2);
  });

  it('walks at the expected speed and stays grounded', () => {
    const world = makeWorld(() => 10);
    const ctrl = new CharacterController(world);
    const s = createCharacterState(48, 10, 60);
    run(ctrl, s, input(), 5);
    const z0 = s.z;
    run(ctrl, s, input({ mz: 1 }), 30);
    // yaw = 0 faces −Z. ~1 s of walking minus acceleration time.
    expect(z0 - s.z).toBeGreaterThan(3.0);
    expect(z0 - s.z).toBeLessThan(3.5);
    expect(s.grounded).toBe(true);
  });

  it('cannot walk through a wall and slides along it', () => {
    const wall = makeBox(20, 12, 16, 0.5, 2, 10);
    const world = makeWorld(() => 10, [{ shape: wall, layer: Layer.Static }]);
    const ctrl = new CharacterController(world);
    const s = createCharacterState(16, 10, 16);
    // Walk towards +X (yaw = −π/2 faces +X) with some forward-diagonal component.
    run(ctrl, s, input({ yaw: -Math.PI / 2, mz: 1, mx: 0.5 }), 90);
    expect(s.x).toBeLessThanOrEqual(20 - 0.5 - 0.35 + 0.01);
    // Sliding: moved along Z while blocked in X.
    expect(Math.abs(s.z - 16)).toBeGreaterThan(2);
    expect(world.overlapsCapsule(s.x, s.y + 0.35, s.z, s.x, s.y + 1.45, s.z, 0.35, Layer.Static, 0.01)).toBe(false);
  });

  it('does not tunnel through thin walls at high speed', () => {
    const wall = makeBox(20, 12, 16, 0.05, 3, 10);
    const world = makeWorld(() => 10, [{ shape: wall, layer: Layer.Static }]);
    const ctrl = new CharacterController(world);
    const s = createCharacterState(15, 10.5, 16);
    s.vx = 50; // as if launched
    for (let i = 0; i < 20; i++) {
      ctrl.step(s, input({ yaw: -Math.PI / 2, mz: 1, sprint: true }), DT);
      expect(s.x).toBeLessThan(20);
    }
  });

  it('steps up small ledges but not tall ones', () => {
    const low = makeBox(20, 10.15, 16, 1, 0.15, 5); // 0.3 m step
    const world = makeWorld(() => 10, [{ shape: low, layer: Layer.Static }]);
    const ctrl = new CharacterController(world);
    const s = createCharacterState(16, 10, 16);
    run(ctrl, s, input(), 3);
    run(ctrl, s, input({ yaw: -Math.PI / 2, mz: 1 }), 50);
    expect(s.x).toBeGreaterThan(19.5);

    const tall = makeBox(20, 10.5, 16, 1, 0.5, 5); // 1.0 m
    const world2 = makeWorld(() => 10, [{ shape: tall, layer: Layer.Static }]);
    const ctrl2 = new CharacterController(world2);
    const s2 = createCharacterState(16, 10, 16);
    run(ctrl2, s2, input(), 3);
    run(ctrl2, s2, input({ yaw: -Math.PI / 2, mz: 1 }), 50);
    expect(s2.x).toBeLessThan(19 - 0.3);
  });

  it('cannot climb slopes steeper than the walkable limit', () => {
    // 60° slope rising towards +X from x = 50.
    const steep = Math.tan((60 * Math.PI) / 180);
    const world = makeWorld((x) => 10 + Math.max(0, x - 50) * steep);
    const ctrl = new CharacterController(world);
    const s = createCharacterState(46, 10, 48);
    run(ctrl, s, input(), 3);
    run(ctrl, s, input({ yaw: -Math.PI / 2, mz: 1, sprint: true }), 150);
    expect(s.y).toBeLessThan(11);
    // A gentle 20° slope is fine.
    const gentle = Math.tan((20 * Math.PI) / 180);
    const world2 = makeWorld((x) => 10 + Math.max(0, x - 50) * gentle);
    const ctrl2 = new CharacterController(world2);
    const s2 = createCharacterState(46, 10, 48);
    run(ctrl2, s2, input(), 3);
    run(ctrl2, s2, input({ yaw: -Math.PI / 2, mz: 1 }), 150);
    expect(s2.y).toBeGreaterThan(14);
    expect(s2.grounded).toBe(true);
  });

  it('never ends a step below the terrain surface', () => {
    const world = makeWorld((x, z) => 10 + Math.sin(x * 0.3) * 2 + Math.cos(z * 0.2) * 2);
    const ctrl = new CharacterController(world);
    const s = createCharacterState(40, 30, 40);
    for (let i = 0; i < 300; i++) {
      ctrl.step(s, input({ yaw: i * 0.05, mz: 1, sprint: true, jump: i % 37 === 0 }), DT);
      expect(s.y).toBeGreaterThanOrEqual(world.terrainHeight(s.x, s.z) - 1e-6);
    }
  });

  it('freezes when terrain is not loaded and reverts penetrating spawns', () => {
    const world = makeWorld(() => 10);
    const ctrl = new CharacterController(world);
    const s = createCharacterState(500, 10, 500);
    expect(ctrl.step(s, input({ mz: 1 }), DT).frozen).toBe(true);
    expect(s.x).toBe(500);

    const rock = makeSphere(10, 11, 10, 1.5);
    const w2 = makeWorld(() => 10, [{ shape: rock, layer: Layer.Static }]);
    const c2 = new CharacterController(w2);
    expect(c2.isFree(10, 10, 10)).toBe(false);
    expect(c2.isFree(20, 10, 20)).toBe(true);
  });

  it('is deterministic for identical input sequences', () => {
    const f = (x: number, z: number) => 10 + Math.sin(x * 0.2) * 1.5 + z * 0.05;
    const box = makeBox(30, 11, 30, 2, 1, 2, 0.3);
    const a = new CharacterController(makeWorld(f, [{ shape: box, layer: Layer.Static }]));
    const b = new CharacterController(makeWorld(f, [{ shape: box, layer: Layer.Static }]));
    const sa = createCharacterState(20, 15, 20);
    const sb = createCharacterState(20, 15, 20);
    for (let i = 0; i < 200; i++) {
      const inp = input({ yaw: Math.sin(i * 0.1), mz: 1, mx: (i % 20) / 20 - 0.5, jump: i % 50 === 0 });
      a.step(sa, inp, DT);
      b.step(sb, inp, DT);
    }
    expect(sa).toEqual(sb);
  });
});

describe('hitboxes', () => {
  it('distinguishes head and torso hits and respects yaw', () => {
    const head = raycastRig(HUMANOID_RIG, 0, 0, 5, 0, 0, 1.62, 0, 0, 0, 1, 10);
    expect(head?.zone).toBe('head');
    const torso = raycastRig(HUMANOID_RIG, 0, 0, 5, 0, 0, 1.2, 0, 0, 0, 1, 10);
    expect(torso?.zone).toBe('torso');
    expect(raycastRig(HUMANOID_RIG, 0, 0, 5, 0, 0, 2.5, 0, 0, 0, 1, 10)).toBeNull();
    // Arm at local x = +0.32 → after yaw π/2, it sits at world z offset −0.32.
    const arm = raycastRig(HUMANOID_RIG, 0, 0, 0, Math.PI / 2, -5, 1.1, -0.32, 1, 0, 0, 10);
    expect(arm?.zone).toBe('arm_r');
  });
});

describe('ladders', () => {
  const ladder = (): ColliderInit => ({ shape: makeBox(10, 2, 10, 0.44, 2, 0.125), layer: Layer.Static, tag: 2022 });
  const input = (mz: number): CharacterInput => ({ mx: 0, mz, yaw: 0, jump: false, sprint: false });

  it('climbs while pushing into the rungs, holds still when let go, never with other walls', () => {
    const world = makeWorld(() => 0, [ladder()]);
    const ctl = new CharacterController(world);
    // Standing south of the ladder, facing it (yaw 0 = −Z).
    const s = createCharacterState(10, 0, 10.6);
    for (let i = 0; i < 30; i++) ctl.step(s, input(1), DT);
    expect(s.climbing).toBe(true);
    expect(s.y).toBeGreaterThan(1.5);
    const y = s.y;
    for (let i = 0; i < 10; i++) ctl.step(s, input(0), DT);
    expect(Math.abs(s.y - y)).toBeLessThan(0.05);

    const plain = makeWorld(() => 0, [{ ...ladder(), tag: 0 }]);
    const c2 = new CharacterController(plain);
    const s2 = createCharacterState(10, 0, 10.6);
    for (let i = 0; i < 30; i++) c2.step(s2, input(1), DT);
    expect(s2.climbing).toBe(false);
    expect(s2.y).toBeLessThan(0.1);
  });
});
