import { describe, expect, it } from 'vitest';
import { VEHICLES, createVehicleMotion, vehiclePoint, type VehicleKind, type VehicleState } from './vehicles';
import { damagePart, enginePower, mountRate, partAt, partHealth, trackDrive, weaponState } from './vehicle-parts';
import { slewMount } from './vehicle-mounts';

const at = (kind: VehicleKind): VehicleState => ({ id: 1, kind, x: 50, y: 10, z: 50, yaw: 0, speed: 0, health: VEHICLES[kind].health, driver: 1, explodeAt: 0, exploded: false, motion: createVehicleMotion(kind) });
const hit = (v: VehicleState, x: number, y: number, z: number) => { const p = vehiclePoint(v, x, y, z); return partAt(v, p.x, p.y, p.z); };

describe('vehicle parts', () => {
  it('tells where a hit lands on a tank, following the turret round', () => {
    const v = at('t80u');
    expect(hit(v, 0, 1.6, -4)).toBe('gun');
    expect(hit(v, 0, 1.9, 0)).toBe('turret');
    expect(hit(v, -1.7, .6, 0)).toBe('tracks');
    expect(hit(v, 0, 1, 2.8)).toBe('engine');
    v.aim = [Math.PI / 2, 0];
    // Turret turned to the left: the barrel now lies out to the hull's left.
    expect(hit(v, -4, 1.6, -.3)).toBe('gun');
    expect(hit(v, 0, 1.6, -4)).not.toBe('gun');
  });

  it('a damaged part changes how the vehicle works', () => {
    const v = at('t80u');
    expect(enginePower(v)).toBe(1);
    damagePart(v, 'engine', VEHICLES.t80u.health * .15);
    expect(partHealth(v, 'engine')).toBeCloseTo(.5, 5);
    expect(enginePower(v)).toBeLessThan(1);
    damagePart(v, 'tracks', VEHICLES.t80u.health);
    expect(trackDrive(v)).toBe(0);
    damagePart(v, 'turret', VEHICLES.t80u.health);
    expect(mountRate(v, 0)).toBe(0);
    // A jammed turret does not turn.
    slewMount(v, 0, 1, 0, 1);
    expect(v.aim?.[0] ?? 0).toBe(0);
    damagePart(v, 'gun', VEHICLES.t80u.health);
    expect(weaponState(v, 0).fires).toBe(false);
  });

  it('a helicopter has rotors, engine and cockpit', () => {
    const v = at('z10');
    expect(hit(v, 0, 1.4, 6.9)).toBe('tailRotor');
    expect(hit(v, 0, 3, 0)).toBe('mainRotor');
    expect(hit(v, 0, 1, -4.5)).toBe('cockpit');
  });
});
