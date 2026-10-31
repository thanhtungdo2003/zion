import { beforeAll, describe, expect, it } from 'vitest';
import { VEHICLES, createVehicleMotion, type HeliControls, type VehicleKind, type VehicleState } from '@zion/shared';
import { CollisionWorld } from './world';
import { Heightfield } from './heightfield';
import { Layer } from './layers';
import { makeBox } from './shapes';
import { JoltVehicles, loadJolt } from './jolt-vehicles';

/** Helicopters flown as rigid bodies by rotor forces (heli-flight.ts) through JoltVehicles. */
beforeAll(() => loadJolt());

function world(): CollisionWorld {
  const w = new CollisionWorld({ worldSize: 384, seaLevel: 0 });
  for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) w.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089).fill(30), new Float32Array(1089).fill(NaN)), []);
  return w;
}
const heli = (kind: VehicleKind = 'z10'): VehicleState => ({ id: 1, kind, x: 192, y: 30, z: 300, yaw: 0, speed: 0, health: VEHICLES[kind].health, driver: 1, explodeAt: 0, exploded: false, motion: createVehicleMotion(kind) });
const fly = (sim: JoltVehicles, v: VehicleState, seconds: number, c: Partial<HeliControls>, each?: () => void) => {
  for (let i = 0; i < seconds * 30; i++) {
    sim.step([v], () => ({ throttle: 0, steer: 0, heli: { collective: 0, bank: 0, stickX: 0, stickY: 0, ...c } }), 1 / 30, i * 33);
    each?.();
  }
};

describe('helicopter flight', () => {
  it('spools up, lifts off on the collective, and holds its height when the lever is left', () => {
    const w = world(), sim = new JoltVehicles(w), v = heli();
    try {
      sim.add(v);
      fly(sim, v, 4, {});
      // Rotor at speed, lever down: still on the ground.
      expect(v.rotor!).toBeGreaterThan(.9);
      expect(v.y - 30).toBeLessThan(.3);
      fly(sim, v, 4, { collective: 1 });
      expect(v.y - 30).toBeGreaterThan(5);
      const climbing = v.motion!.vy;
      expect(climbing).toBeGreaterThan(1);
      // Lever left alone: the climb dies away over a few seconds (inertia), it does not stop dead.
      fly(sim, v, .2, {});
      expect(v.motion!.vy).toBeGreaterThan(climbing * .4);
      fly(sim, v, 6, {});
      expect(Math.abs(v.motion!.vy)).toBeLessThan(1);
      const h = v.y;
      fly(sim, v, 3, {});
      expect(Math.abs(v.y - h)).toBeLessThan(2.5);
    } finally { sim.dispose(); }
  });

  it('flies forward by dipping the nose, carries its speed, and needs time to stop', () => {
    const w = world(), sim = new JoltVehicles(w), v = heli();
    try {
      sim.add(v);
      fly(sim, v, 4, {}); fly(sim, v, 4, { collective: 1 }); fly(sim, v, 3, {});
      fly(sim, v, 6, { stickY: 1 });
      // Nose down, moving forward (−Z for yaw 0).
      expect(v.speed).toBeGreaterThan(15);
      const fast = v.speed;
      // Stick back to the middle: no instant stop.
      fly(sim, v, 1, {});
      expect(v.speed).toBeGreaterThan(fast * .6);
      // Pulling back (nose up) brakes it, through the tilt of the rotor, over seconds.
      let t = 0;
      fly(sim, v, 10, { stickY: -1 }, () => { if (v.speed > 1) t++; });
      expect(t / 30).toBeGreaterThan(1.5);
      expect(v.speed).toBeLessThan(fast);
    } finally { sim.dispose(); }
  });

  it('turns the nose on A/D (pedals), banks and drifts on the mouse (cyclic); a broken tail rotor spins it', () => {
    const w = world(), sim = new JoltVehicles(w), v = heli(), x0 = v.x;
    try {
      sim.add(v);
      fly(sim, v, 4, {}); fly(sim, v, 4, { collective: 1 }); fly(sim, v, 3, {});
      // D: the nose swings right (yaw falls) without banking over.
      const yaw0 = v.yaw;
      fly(sim, v, 1.5, { bank: 1 });
      expect(Math.atan2(Math.sin(v.yaw - yaw0), Math.cos(v.yaw - yaw0))).toBeLessThan(-.4);
      expect(Math.abs(v.motion!.roll)).toBeLessThan(.15);
      fly(sim, v, 2, {});
      // Mouse right: banks right and drifts that way.
      const xs = v.x, side = { x: Math.cos(v.yaw), z: -Math.sin(v.yaw) }, zs = v.z;
      fly(sim, v, 4, { stickX: 1 });
      expect(v.motion!.roll).toBeLessThan(-.2);
      expect((v.x - xs) * side.x + (v.z - zs) * side.z).toBeGreaterThan(3);
      void x0;
      fly(sim, v, 3, {});
      let turned = 0, last = v.yaw;
      v.parts = { tailRotor: 0 };
      fly(sim, v, 3, {}, () => { turned += Math.atan2(Math.sin(v.yaw - last), Math.cos(v.yaw - last)); last = v.yaw; });
      expect(Math.abs(turned)).toBeGreaterThan(1);
    } finally { sim.dispose(); }
  });

  it('flying into a wall at speed hurts it; nothing snaps it back', () => {
    const w = world(), sim = new JoltVehicles(w), v = heli();
    w.setOwnerColliders(77, [{ shape: makeBox(192, 90, 220, 30, 70, 1), layer: Layer.Static }]);
    try {
      sim.add(v);
      fly(sim, v, 4, {}); fly(sim, v, 4, { collective: 1 }); fly(sim, v, 2, {});
      let worst = 0;
      for (let i = 0; i < 30 * 12; i++) {
        const impacts = sim.step([v], () => ({ throttle: 0, steer: 0, heli: { collective: 0, bank: 0, stickX: 0, stickY: 1 } }), 1 / 30, 20000 + i * 33);
        worst = Math.max(worst, impacts.get(1) ?? 0);
      }
      expect(v.z).toBeGreaterThan(219);
      expect(worst).toBeGreaterThan(6);
      expect(v.health).toBeLessThan(VEHICLES.z10.health);
    } finally { sim.dispose(); }
  });
});
