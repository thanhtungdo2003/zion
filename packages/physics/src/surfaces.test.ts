import { beforeAll, describe, expect, it } from 'vitest';
import { Surface, VEHICLES, createVehicleMotion, type VehicleState } from '@zion/shared';
import { CollisionWorld } from './world';
import { Heightfield } from './heightfield';
import { JoltVehicles, loadJolt } from './jolt-vehicles';
import { yawPose, type RigidBodyDef } from './rigid-body';
import { contactFriction, pairFriction, terrainMaterial } from './surfaces';

/**
 * Contact friction from the materials in contact: the table itself, then the same bodies and
 * vehicles on different ground (a few simulated seconds each, light enough for the default run).
 */
beforeAll(() => loadJolt());

const GROUND = 30;
/** Flat ground (or a slope rising `slope` m per m along +x), one terrain surface everywhere, or by x. */
function world(surface: (x: number) => Surface, slope = 0, wet = false) {
  const w = new CollisionWorld({ worldSize: 192, seaLevel: 0 });
  for (let cx = 0; cx < 6; cx++) for (let cz = 0; cz < 6; cz++) {
    const heights = new Float32Array(1089), water = new Float32Array(1089).fill(NaN), surf = new Uint8Array(1089);
    for (let j = 0; j < 33; j++) for (let i = 0; i < 33; i++) {
      const k = j * 33 + i, x = cx * 32 + i;
      heights[k] = GROUND + x * slope; surf[k] = surface(x);
      if (wet) water[k] = heights[k]! + .05;
    }
    w.addChunk(cx, cz, new Heightfield(cx * 32, cz * 32, 1, 33, heights, water, surf), []);
  }
  return w;
}
const crate = (material: RigidBodyDef['material'] = 'wood'): RigidBodyDef =>
  ({ parts: [{ type: 'box', cx: 0, cy: .3, cz: 0, hx: .3, hy: .3, hz: .3, yaw: 0 }], mass: 20, material });
function steps(sim: JoltVehicles, seconds: number, vehicles: VehicleState[] = [], throttle = 0): void {
  for (let i = 0; i < Math.round(seconds * 30); i++) sim.step(vehicles, (v) => (v.driver ? { throttle, steer: 0 } : undefined), 1 / 30, i * 1000 / 30);
}
function car(w: CollisionWorld, x = 96, z = 170): VehicleState {
  return { id: 1, kind: 'car', x, y: w.terrainHeight(x, z), z, yaw: 0, speed: 0, health: VEHICLES.car.health, driver: 1, explodeAt: 0, exploded: false, motion: createVehicleMotion('car') };
}

describe('surface materials', () => {
  it('pairs: tyres grip asphalt, lose it on mud and ice; sticking holds more than sliding', () => {
    expect(pairFriction('rubber', 'asphalt')[0]).toBeGreaterThan(1);
    expect(pairFriction('rubber', 'mud')[1]).toBeLessThan(pairFriction('rubber', 'asphalt')[1] / 3);
    expect(pairFriction('rubber', 'ice')[1]).toBeLessThan(.1);
    expect(pairFriction('wood', 'grass')).not.toEqual(pairFriction('wood', 'concrete'));
    expect(contactFriction('wood', 'concrete', 0)).toBeGreaterThan(contactFriction('wood', 'concrete', 1));
    expect(terrainMaterial(Surface.Asphalt)).toBe('asphalt');
    expect(terrainMaterial(Surface.Grass, true)).toBe('wet');
    expect(terrainMaterial(Surface.Snow, true)).toBe('ice');
  });

  it('a crate shoved along the ground slides far on ice and stops short on grass', () => {
    const w = world((x) => (x < 96 ? Surface.Grass : Surface.Snow)), sim = new JoltVehicles(w);
    const iceWorld = world(() => Surface.Snow, 0, true), iceSim = new JoltVehicles(iceWorld);
    try {
      sim.addBody(1, crate(), yawPose(20, GROUND + .01, 48, 0), [5, 0, 0]);
      iceSim.addBody(1, crate(), yawPose(20, GROUND + .06, 48, 0), [5, 0, 0]);
      steps(sim, 3); steps(iceSim, 3);
      const grass = sim.bodyState(1)!.pose.x - 20, ice = iceSim.bodyState(1)!.pose.x - 20;
      expect(grass).toBeLessThan(4);
      expect(ice).toBeGreaterThan(grass * 2.5);
    } finally { sim.dispose(); iceSim.dispose(); }
  });

  it('static friction: a crate rests on a slope its grip can hold, and slides down ice at the same angle', () => {
    // 20° (tan .36): below concrete-on-wood sticking, far above wood-on-ice.
    const rock = world(() => Surface.Rock, .36), ice = world(() => Surface.Snow, .36, true);
    const a = new JoltVehicles(rock), b = new JoltVehicles(ice);
    try {
      a.addBody(1, crate(), yawPose(60, rock.terrainHeight(60, 48) + .05, 48, 0));
      b.addBody(1, crate(), yawPose(60, ice.terrainHeight(60, 48) + .1, 48, 0));
      steps(a, 3); steps(b, 3);
      expect(Math.abs(a.bodyState(1)!.pose.x - 60)).toBeLessThan(.5);
      expect(60 - b.bodyState(1)!.pose.x).toBeGreaterThan(3);
    } finally { a.dispose(); b.dispose(); }
  });

  it('a car pulls away hard on asphalt, slowly on mud, and its tyres report the ground', () => {
    const run = (surface: Surface) => {
      const w = world(() => surface), v = car(w), sim = new JoltVehicles(w);
      try { sim.add(v); steps(sim, 3, [v], 1); return { speed: v.speed, ground: sim.wheelSurfaces(1) }; } finally { sim.dispose(); }
    };
    const road = run(Surface.Asphalt), mud = run(Surface.Mud);
    expect(road.ground).toContain('asphalt');
    expect(mud.ground).toContain('mud');
    expect(road.speed).toBeGreaterThan(mud.speed * 1.3);
  });
});
