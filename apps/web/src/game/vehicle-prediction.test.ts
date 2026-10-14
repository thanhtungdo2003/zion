import { beforeAll, describe, expect, it } from 'vitest';
import { VEHICLES, createVehicleMotion, type VehicleState } from '@zion/shared';
import { CollisionWorld, Heightfield, loadJolt } from '@zion/physics';
import { VehiclePrediction } from './vehicle-prediction';

beforeAll(() => loadJolt());

function world() {
  const w = new CollisionWorld({ worldSize: 192, seaLevel: 0 });
  for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) w.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089).fill(10), new Float32Array(1089).fill(NaN)), []);
  return w;
}
const car = (): VehicleState => ({ id: 7, kind: 'car', x: 96, y: 10, z: 170, yaw: 0, speed: 0, health: VEHICLES.car.health, driver: 1, explodeAt: 0, exploded: false, motion: createVehicleMotion('car') });

describe('vehicle prediction', () => {
  it('drives the local car immediately from the same inputs', () => {
    const p = new VehiclePrediction(world());
    p.begin(car());
    for (let i = 0; i < 60; i++) p.step(1, 0, i * 1000 / 30);
    expect(p.pose(1)!.z).toBeLessThan(165);
    p.end();
  });

  it('folds small server corrections in gradually and snaps large ones', () => {
    const p = new VehiclePrediction(world());
    p.begin(car());
    for (let i = 0; i < 30; i++) p.step(0, 0, i * 1000 / 30);
    const at = p.pose(1)!;
    p.reconcile({ ...at, x: at.x + 1 }, 500, 0);
    p.step(0, 0, 1000);
    const nudged = p.pose(1)!.x - at.x;
    expect(nudged).toBeGreaterThan(.05); expect(nudged).toBeLessThan(.5);
    for (let i = 0; i < 30; i++) p.step(0, 0, 1033 + i * 33);
    expect(p.pose(1)!.x - at.x).toBeGreaterThan(.9);
    p.reconcile({ ...at, x: at.x + 20 }, 1900, 0);
    expect(p.pose(1)!.x).toBeCloseTo(at.x + 20, 1);
    p.end();
  });
});
