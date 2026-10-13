import { describe, expect, it } from 'vitest';
import { createVehicleMotion, VEHICLES, type VehicleState } from '@zion/shared';
import { CollisionWorld, Heightfield, Layer, makeBox, makeCapsule } from '@zion/physics';
import { JoltVehicles } from './jolt-vehicles';

function world(height = (_x: number, _z: number) => 30) {
  const w = new CollisionWorld({ worldSize: 192, seaLevel: 20 });
  for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) {
    const heights = new Float32Array(1089);
    for (let i = 0; i < 33; i++) for (let j = 0; j < 33; j++) heights[j * 33 + i] = height(x * 32 + i, z * 32 + j);
    w.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, heights, new Float32Array(1089).fill(NaN)), []);
  }
  return w;
}
function car(w: CollisionWorld, kind: VehicleState['kind'] = 'car', z = 170, x = 96): VehicleState {
  return { id: 1, kind, x, y: w.terrainHeight(x, z), z, yaw: 0, speed: 0, health: VEHICLES[kind].health, driver: 1, explodeAt: 0, exploded: false, motion: createVehicleMotion(kind) };
}
function run(sim: JoltVehicles, vehicles: VehicleState[], seconds: number, throttle = 1, steer = 0, each?: () => void) {
  let worst = 0;
  for (let i = 0; i < seconds * 30; i++) {
    const impacts = sim.step(vehicles, (v) => (v.driver ? { throttle, steer } : undefined), 1 / 30, i * 1000 / 30);
    for (const s of impacts.values()) worst = Math.max(worst, s);
    each?.();
  }
  return worst;
}

describe('Jolt vehicles', () => {
  it.each(['car', 'jeep', 'quad', 'grizzly'] as const)('drives a %s forward on its wheels', (kind) => {
    const w = world(), v = car(w, kind), sim = new JoltVehicles(w);
    try {
      sim.add(v);
      run(sim, [v], 4);
      expect(v.z).toBeLessThan(150);
      expect(v.speed).toBeGreaterThan(8);
      expect(Math.abs(v.y - 30)).toBeLessThan(.3);
      expect(Math.abs(v.motion!.roll)).toBeLessThan(.1);
      expect(v.motion!.grounded).toBe(true);
    } finally { sim.dispose(); }
  });

  it('steers right with positive steer input', () => {
    const w = world(), v = car(w), sim = new JoltVehicles(w);
    try {
      sim.add(v); run(sim, [v], 1.5); run(sim, [v], 1.5, .5, 1);
      // Yaw decreases when turning right (yaw is a left-handed turn about +Y).
      expect(v.yaw).toBeLessThan(-.3);
    } finally { sim.dispose(); }
  });

  it('pitches with the ramp and flies off its crest', () => {
    const w = world((_x, z) => (z < 150 && z > 136 ? 30 + (150 - z) * .3 : 30)), v = car(w, 'car', 185), sim = new JoltVehicles(w);
    try {
      sim.add(v);
      let tilt = 0, air = 0;
      run(sim, [v], 6, 1, 0, () => {
        if (v.z < 147 && v.z > 139) tilt = Math.max(tilt, v.motion!.pitch);
        if (v.z < 134) air = Math.max(air, v.y - w.terrainHeight(v.x, v.z));
      });
      expect(tilt).toBeGreaterThan(.15);
      expect(air).toBeGreaterThan(1);
    } finally { sim.dispose(); }
  });

  it('bounces off a wall hit at an angle instead of sticking, and can reverse away', () => {
    const w = world(), v = car(w), sim = new JoltVehicles(w);
    w.setOwnerColliders(77, [{ shape: makeBox(99, 32, 130, .15, 4, 60), layer: Layer.Static }]);
    try {
      sim.add(v); v.yaw = -.5; v.speed = 25;
      const crash = run(sim, [v], 4, 1, 0, () => expect(v.x).toBeLessThan(99));
      expect(crash).toBeGreaterThan(4);
      expect(v.health).toBeLessThan(VEHICLES.car.health);
      const x = v.x, z = v.z;
      run(sim, [v], 2, -1);
      expect(Math.hypot(v.x - x, v.z - z)).toBeGreaterThan(2);
    } finally { sim.dispose(); }
  });

  it('does not climb a tree trunk', () => {
    const w = world(), v = car(w), sim = new JoltVehicles(w);
    w.setOwnerColliders(77, [{ shape: makeCapsule(96.6, 30, 140, 96.6, 38, 140, .35), layer: Layer.Static }]);
    try {
      sim.add(v);
      let top = 0;
      run(sim, [v], 4, 1, 0, () => { top = Math.max(top, v.y); });
      expect(top).toBeLessThan(31.5);
    } finally { sim.dispose(); }
  });

  it('shoves a parked vehicle by momentum', () => {
    const w = world(), a = car(w), b = { ...car(w, 'car', 150), id: 2, driver: null, motion: createVehicleMotion('car') }, sim = new JoltVehicles(w);
    try {
      sim.add(a); sim.add(b);
      run(sim, [a, b], 5);
      expect(b.z).toBeLessThan(148);
      expect(b.health).toBeLessThanOrEqual(VEHICLES.car.health);
    } finally { sim.dispose(); }
  });
});
