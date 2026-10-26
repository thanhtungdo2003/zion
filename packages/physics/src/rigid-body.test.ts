import { beforeAll, describe, expect, it } from 'vitest';
import { CollisionWorld } from './world';
import { Heightfield } from './heightfield';
import { Layer } from './layers';
import { makeBox } from './shapes';
import { JoltVehicles, MAX_FREE_BODIES, loadJolt } from './jolt-vehicles';
import { boxInertia, poseTransform, proxyFromColliders, proxyVolume, solidMass, yawPose, type RigidBodyDef } from './rigid-body';

/**
 * Lightweight rigid-body checks (a handful of bodies, at most a few simulated seconds each, no
 * rendering): safe on a low-end machine and part of the default test run.
 */
beforeAll(() => loadJolt());

const GROUND = 30;
function world() {
  const w = new CollisionWorld({ worldSize: 96, seaLevel: 0 });
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) {
    w.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089).fill(GROUND), new Float32Array(1089).fill(NaN)), []);
  }
  return w;
}
const crate = (mass: number, half = .4, material: RigidBodyDef['material'] = 'wood'): RigidBodyDef =>
  ({ parts: [{ type: 'box', cx: 0, cy: half, cz: 0, hx: half, hy: half, hz: half, yaw: 0 }], mass, material });
function run(sim: JoltVehicles, seconds: number, each?: (t: number) => void): void {
  for (let i = 0; i < Math.round(seconds * 30); i++) { sim.step([], () => undefined, 1 / 30, i * 1000 / 30); each?.(i / 30); }
}

describe('rigid bodies on Jolt', () => {
  it('falls, lands on the ground and goes to sleep', () => {
    const sim = new JoltVehicles(world());
    try {
      sim.addBody(1, crate(20), yawPose(48, GROUND + 3, 48, .3));
      run(sim, 4);
      const s = sim.bodyState(1)!;
      expect(Math.abs(s.pose.y - GROUND)).toBeLessThan(.03);
      expect(Math.hypot(...s.v)).toBeLessThan(.05);
      expect(s.awake).toBe(false);
    } finally { sim.dispose(); }
  });

  it('the same impulse moves a light body five times faster than one five times heavier', () => {
    const sim = new JoltVehicles(world());
    try {
      sim.addBody(1, crate(10), yawPose(40, GROUND + 5, 48, 0));
      sim.addBody(2, crate(50), yawPose(56, GROUND + 5, 48, 0));
      // Through the centre of mass: pure translation, v = J / m.
      sim.applyImpulse(1, 40, 0, 0, 40, GROUND + 5.4, 48);
      sim.applyImpulse(2, 40, 0, 0, 56, GROUND + 5.4, 48);
      run(sim, 1 / 30);
      const a = sim.bodyState(1)!.v[0], b = sim.bodyState(2)!.v[0];
      expect(a).toBeCloseTo(4, 1);
      expect(b).toBeCloseTo(.8, 1);
      expect(a / b).toBeCloseTo(5, 1);
    } finally { sim.dispose(); }
  });

  it('an off-centre hit spins the body about the expected axis; a centred hit does not', () => {
    const sim = new JoltVehicles(world());
    try {
      sim.addBody(1, crate(20), yawPose(40, GROUND + 6, 48, 0));
      sim.addBody(2, crate(20), yawPose(56, GROUND + 6, 48, 0));
      // +X push at the top edge: torque r × J points along -Z, the top tips towards +X.
      sim.applyImpulse(1, 30, 0, 0, 40, GROUND + 6.8, 48);
      sim.applyImpulse(2, 30, 0, 0, 56, GROUND + 6.4, 48);
      run(sim, 1 / 30);
      const off = sim.bodyState(1)!.w, centred = sim.bodyState(2)!.w;
      // ω = I⁻¹ (r × J): r = 0.4 m above the centre, I = m (hy² + hx²) / 3 for a cube.
      const iz = boxInertia(20, .4, .4, .4)[2];
      expect(off[2]).toBeCloseTo(-.4 * 30 / iz, 0);
      expect(Math.hypot(...centred)).toBeLessThan(.05);
    } finally { sim.dispose(); }
  });

  it('slides along the ground and stops, sooner on a grippier material', () => {
    const sim = new JoltVehicles(world());
    const slid: number[] = [];
    try {
      sim.addBody(1, crate(20, .3, 'plastic'), yawPose(20, GROUND + .01, 30, 0), [6, 0, 0]);
      sim.addBody(2, crate(20, .3, 'rubber'), yawPose(20, GROUND + .01, 60, 0), [6, 0, 0]);
      run(sim, 4);
      for (const id of [1, 2]) {
        const s = sim.bodyState(id)!;
        expect(Math.hypot(...s.v)).toBeLessThan(.05);
        slid.push(s.pose.x - 20);
      }
      expect(slid[0]).toBeGreaterThan(1);
      expect(slid[1]).toBeLessThan(slid[0]!);
    } finally { sim.dispose(); }
  });

  it('a fast small body does not tunnel through a thin wall (continuous collision)', () => {
    const w = world();
    w.setOwnerColliders(1, [{ shape: makeBox(60, GROUND + 1.5, 48, .05, 1.5, 3), layer: Layer.Static, tag: 1 }]);
    const sim = new JoltVehicles(w);
    try {
      sim.addBody(1, crate(1, .05, 'metal'), yawPose(40, GROUND + 1, 48, 0), [55, 0, 0]);
      let furthest = 0;
      run(sim, 1, () => { furthest = Math.max(furthest, sim.bodyState(1)!.pose.x); });
      expect(furthest).toBeLessThan(60);
    } finally { sim.dispose(); }
  });

  it('a stack of three crates stands still', () => {
    const sim = new JoltVehicles(world());
    try {
      for (let i = 0; i < 3; i++) sim.addBody(i + 1, crate(15), yawPose(48, GROUND + i * .8 + .005, 48, 0));
      run(sim, 3);
      const top = sim.bodyState(3)!.pose;
      expect(Math.hypot(top.x - 48, top.z - 48)).toBeLessThan(.05);
      expect(top.y).toBeCloseTo(GROUND + 1.6, 1);
    } finally { sim.dispose(); }
  });

  it('refuses bodies past the budget and removes them cleanly', () => {
    const sim = new JoltVehicles(world());
    try {
      for (let i = 0; i < MAX_FREE_BODIES; i++) expect(sim.addBody(i, crate(5, .1), yawPose(10 + (i % 10) * .5, GROUND + 1 + Math.floor(i / 10) * .5, 10, 0))).toBe(true);
      expect(sim.addBody(999, crate(5, .1), yawPose(40, GROUND + 1, 40, 0))).toBe(false);
      for (let i = 0; i < MAX_FREE_BODIES; i++) sim.removeBody(i);
      expect(sim.bodyCount).toBe(0);
    } finally { sim.dispose(); }
  });
});

describe('physics proxies', () => {
  it('keeps each collider of the asset as its own part, scaled', () => {
    const parts = proxyFromColliders([
      { type: 'box', center: [0, .5, 0], halfExtents: [1, .5, .1] },
      { type: 'box', center: [.9, .5, .4], halfExtents: [.1, .5, .4], yaw: 0 },
    ], 2);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toMatchObject({ type: 'box', cx: 1.8, cy: 1, cz: .8, hx: .2, hy: 1, hz: .8 });
    // An L-shaped barrier is much less solid than its bounding box.
    expect(proxyVolume(parts)).toBeLessThan(4 * 2 * 2.4 * .5);
  });

  it('falls back to one bounding box when an asset has too many colliders', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ type: 'sphere' as const, center: [i, 0, 0], radius: .5 }));
    const [only, ...rest] = proxyFromColliders(many);
    expect(rest).toHaveLength(0);
    expect(only).toMatchObject({ type: 'box', cx: 5.5, hx: 6 });
  });

  it('solid mass follows density and pose transforms are rigid', () => {
    expect(solidMass(crate(1, .5).parts, 'wood')).toBeCloseTo(600, 5);
    const p = poseTransform({ x: 1, y: 2, z: 3, qx: 0, qy: Math.SQRT1_2, qz: 0, qw: Math.SQRT1_2 }, 1, 0, 0);
    expect(p[0]).toBeCloseTo(1, 6); expect(p[2]).toBeCloseTo(2, 6);
  });
});
