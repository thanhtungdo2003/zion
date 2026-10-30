import { describe, expect, it, vi } from 'vitest';
import { CollisionWorld, Heightfield, createCharacterState, makeBox, makeRayHit, Mask, Layer } from '@zion/physics';
import type { VehicleKind, VehicleState } from '@zion/shared';
import { VEHICLES } from '@zion/shared';
import type { WorldGenerator } from '@zion/worldgen';
import { Vehicles, type BotRider } from './vehicles';
import { driveTowards, newDriveMemory } from './warfare-driving';

/** Flat 192 m square of ground at 30 m. */
function world(): CollisionWorld {
  const w = new CollisionWorld({ worldSize: 192, seaLevel: 20 });
  for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) w.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089).fill(30), new Float32Array(1089).fill(Number.NaN)), []);
  return w;
}
const bot = (id: number, x: number, z: number): BotRider => ({ id, dead: false, state: createCharacterState(x, 30, z), yaw: 0, vehicleId: 0, vehicleSeat: 0 });
const vehicle = (kind: VehicleKind, x: number, z: number, yaw = 0): VehicleState => ({ id: 1, kind, x, y: 30.1, z, yaw, speed: 0, driver: null, explodeAt: 0, exploded: false, health: VEHICLES[kind].health });

/** Drives with the real vehicle physics until it arrives (or time runs out); returns where it ended. */
function drive(kind: VehicleKind, w: CollisionWorld, from: { x: number; z: number; yaw: number }, to: { x: number; z: number }) {
  const s = new Vehicles(w, { config: { mode: 'survival' }, roads: null } as unknown as WorldGenerator);
  const v = vehicle(kind, from.x, from.z, from.yaw);
  s.states.set(v.id, v);
  (s as unknown as { install(v: VehicleState): void }).install(v);
  const driver = bot(7, from.x + 2, from.z), rider = bot(8, from.x - 2, from.z);
  expect(s.boardBot(driver, v, true)).toBe(true);
  expect(s.boardBot(rider, v, true)).toBe(true);
  expect(driver.vehicleSeat).toBe(0);
  expect(rider.vehicleSeat).toBeGreaterThan(0);
  const hit = makeRayHit();
  const probe = (angle: number, length: number) => {
    const yaw = v.yaw - angle, fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), r = VEHICLES[kind].halfZ + .6;
    return w.raycast(v.x + fx * r, v.y + 1.1, v.z + fz * r, -Math.sin(yaw), 0, -Math.cos(yaw), length, Mask.LineOfSight, hit) ? hit.t : length;
  };
  const mem = newDriveMemory(v.x, v.z, 0);
  let arrived = false, now = 0;
  try {
    for (let i = 0; i < 30 * 60 && !arrived; i++) {
      now += 1000 / 30;
      const c = driveTowards(v, to, now, mem, probe);
      arrived = c.arrived;
      s.driveBot(driver, c.throttle, c.steer, now);
      s.step(now, 1 / 30, new Map(), vi.fn(), vi.fn());
    }
    // The bots rode along in their seats and get out beside the vehicle.
    expect(Math.hypot(driver.state.x - v.x, driver.state.z - v.z)).toBeLessThan(3);
    expect(s.exitBot(driver)).toBe(true);
    expect(driver.vehicleId).toBe(0);
    expect(v.driver).toBeNull();
    return { arrived, x: v.x, z: v.z, seconds: now / 1000 };
  } finally { s.dispose(); }
}

describe('bots driving the game\'s jeep and quad', () => {
  it.each(['jeep', 'quad'] as const)('a bot drives a %s round to a point behind it on its own', (kind) => {
    const r = drive(kind, world(), { x: 40, z: 150, yaw: 0 }, { x: 150, z: 40 });
    expect(r.arrived).toBe(true);
    expect(Math.hypot(r.x - 150, r.z - 40)).toBeLessThan(14);
  });

  it('steers round a wall in the way', () => {
    const w = world();
    w.setOwnerColliders(0x7000_0001, [{ shape: makeBox(96, 32, 96, 12, 2.5, .5), layer: Layer.Static }]);
    const r = drive('jeep', w, { x: 96, z: 160, yaw: 0 }, { x: 96, z: 30 });
    expect(r.arrived).toBe(true);
  });
});
