import { beforeAll, describe, expect, it } from 'vitest';
import { Surface, VEHICLES, createVehicleMotion, type VehicleKind, type VehicleState } from '@zion/shared';
import { CollisionWorld } from './world';
import { Heightfield } from './heightfield';
import { JoltVehicles, loadJolt } from './jolt-vehicles';

/**
 * Ride over uneven ground: gentle undulations (slopes up to ~8°) must not throw a vehicle over.
 * Stiff anti-roll bars once levered a jeep 90° onto its side driving straight across them, and a
 * tank bucked off its corner wheels.
 */
beforeAll(() => loadJolt());

function undulating(amp: number) {
  const w = new CollisionWorld({ worldSize: 384, seaLevel: 0 });
  for (let cx = 0; cx < 12; cx++) for (let cz = 0; cz < 12; cz++) {
    const heights = new Float32Array(1089), water = new Float32Array(1089).fill(NaN), surf = new Uint8Array(1089).fill(Surface.Sand);
    for (let j = 0; j < 33; j++) for (let i = 0; i < 33; i++) {
      const x = cx * 32 + i, z = cz * 32 + j;
      heights[j * 33 + i] = 30 + amp * (Math.sin(x * .21) * Math.cos(z * .17) + .5 * Math.sin(x * .53 + z * .41));
    }
    w.addChunk(cx, cz, new Heightfield(cx * 32, cz * 32, 1, 33, heights, water, surf), []);
  }
  return w;
}
function drive(kind: VehicleKind, seconds: number, control: (t: number) => { throttle: number; steer: number }, amp = .4) {
  const w = undulating(amp), sim = new JoltVehicles(w), z = 300;
  const v: VehicleState = { id: 1, kind, x: 192, y: w.terrainHeight(192, z) + .3, z, yaw: 0, speed: 0, health: VEHICLES[kind].health, driver: 1, explodeAt: 0, exploded: false, motion: createVehicleMotion(kind) };
  sim.add(v);
  let roll = 0, lift = 0;
  try {
    for (let i = 0; i < seconds * 30; i++) {
      sim.step([v], () => control(i / 30), 1 / 30, i * 1000 / 30);
      roll = Math.max(roll, Math.abs(v.motion!.roll));
      lift = Math.max(lift, v.y - w.terrainHeight(v.x, v.z));
    }
  } finally { sim.dispose(); }
  return { v, roll: roll * 180 / Math.PI, lift };
}

describe('vehicle ride', () => {
  it('a jeep driven flat out across undulations stays on its wheels', () => {
    const r = drive('jeep', 10, () => ({ throttle: 1, steer: 0 }));
    expect(r.roll).toBeLessThan(45);
    expect(r.v.speed).toBeGreaterThan(12);
  }, 30000);

  it('a tank rides its road wheels over the same ground without bucking', () => {
    const r = drive('tank', 10, () => ({ throttle: 1, steer: 0 }));
    expect(r.roll).toBeLessThan(20);
    expect(r.lift).toBeLessThan(.8);
    expect(r.v.speed).toBeGreaterThan(10);
  }, 30000);

  it('a tank turns on the spot on its tracks', () => {
    const r = drive('tank', 4, (t) => ({ throttle: 0, steer: t > 1 ? 1 : 0 }), 0);
    expect(Math.abs(r.v.yaw)).toBeGreaterThan(.6);
    expect(Math.hypot(r.v.x - 192, r.v.z - 300)).toBeLessThan(.6);
  }, 30000);
});
