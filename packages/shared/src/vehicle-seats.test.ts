import { afterEach, describe, expect, it } from 'vitest';
import { VEHICLES, createVehicleMotion, vehicleSeat, type VehicleState } from './vehicles';
import { SEATED_EYE, seatEye, seatPosition, seatTuningSchema, setSeatTuning } from './vehicle-seats';

const z10 = (): VehicleState => ({ id: 1, kind: 'z10', x: 10, y: 5, z: 20, yaw: 0, speed: 0, health: 1500, driver: 1, explodeAt: 0, exploded: false, motion: createVehicleMotion('z10') });

describe('seat tuning (Studio)', () => {
  afterEach(() => setSeatTuning({}));

  it('moves a seat and its eye for everyone, and leaves the others as in the data', () => {
    expect(seatPosition('z10', 0)).toEqual(VEHICLES.z10.seats[0]);
    expect(seatEye('z10', 0)).toEqual(SEATED_EYE);
    setSeatTuning(seatTuningSchema.parse({ z10: { 0: { pos: [0, .6, -2.2], eye: [0, 1.45, -.15] } } }));
    expect(seatPosition('z10', 0)).toEqual([0, .6, -2.2]);
    expect(seatEye('z10', 0)).toEqual([0, 1.45, -.15]);
    expect(vehicleSeat(z10(), 0)).toMatchObject({ x: 10, z: 17.8 });
    expect(seatPosition('z10', 1)).toEqual(VEHICLES.z10.seats[1]);
  });

  it('refuses unknown vehicles and absurd values', () => {
    expect(seatTuningSchema.safeParse({ ufo: { 0: { pos: [0, 0, 0] } } }).success).toBe(false);
    expect(seatTuningSchema.safeParse({ jeep: { 0: { pos: [0, 99, 0] } } }).success).toBe(false);
  });
});
