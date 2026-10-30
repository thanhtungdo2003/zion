import { describe, expect, it } from 'vitest';
import { VEHICLE_ROLES } from './vehicle-arms';
import { VEHICLES, createVehicleMotion, type VehicleKind, type VehicleState } from './vehicles';
import { mountedSeat, seatAim, slewMount, weaponMuzzle } from './vehicle-mounts';

const at = (kind: VehicleKind, yaw = 0): VehicleState => ({ id: 1, kind, x: 100, y: 10, z: 100, yaw, speed: 0, health: VEHICLES[kind].health, driver: 1, passengers: [2], explodeAt: 0, exploded: false, motion: createVehicleMotion(kind) });
const gun = (kind: VehicleKind, id: string) => VEHICLE_ROLES[kind].weapons.find((w) => w.id === id)!;

describe('weapon mounts', () => {
  it('a turret traverses towards the aim at its own rate and gets there', () => {
    const v = at('t80u');
    // Aim straight behind (world yaw π with the hull facing yaw 0).
    slewMount(v, 0, Math.PI, 0, 1);
    expect(Math.abs(seatAim(v, 0)[0])).toBeCloseTo(.7, 5);
    for (let i = 0; i < 10; i++) slewMount(v, 0, Math.PI, 0, 1);
    expect(Math.abs(seatAim(v, 0)[0])).toBeCloseTo(Math.PI, 3);
    expect(slewMount(v, 0, Math.PI, 0, 0)).toBeLessThan(1e-3);
  });

  it('the cannon fires from the end of the barrel wherever the turret points', () => {
    const v = at('t80u'), cannon = gun('t80u', 'cannon');
    expect(weaponMuzzle(v, cannon).z).toBeLessThan(v.z - 5);
    v.aim = [Math.PI / 2, 0];
    // Turned to the left (+yaw): the muzzle is out to the hull's left (−X), level with the ring.
    const m = weaponMuzzle(v, cannon);
    expect(m.x).toBeLessThan(v.x - 5);
    expect(Math.abs(m.z - (v.z - .3))).toBeLessThan(.2);
    v.aim = [0, .3];
    expect(weaponMuzzle(v, cannon).y).toBeGreaterThan(10 + 1.6 + 1);
  });

  it('a roof gun and its gunner ride round with the turret', () => {
    const v = at('t62a'), mg = gun('t62a', 'hmg1');
    const seat0 = mountedSeat(v, 1), muzzle0 = weaponMuzzle(v, mg);
    v.aim = [Math.PI, 0, Math.PI, 0];
    const seat1 = mountedSeat(v, 1), muzzle1 = weaponMuzzle(v, mg);
    // Half a turn about the ring at (0, −0.2): both mirror through it.
    expect(seat1.x - v.x).toBeCloseTo(-(seat0.x - v.x), 3);
    expect(seat1.z - (v.z - .2)).toBeCloseTo(-(seat0.z - (v.z - .2)), 3);
    expect(muzzle1.z).toBeGreaterThan(v.z);
    expect(muzzle0.z).toBeLessThan(v.z);
  });
});
