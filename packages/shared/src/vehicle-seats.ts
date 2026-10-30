import { z } from 'zod';
import { VEHICLES, type VehicleKind } from './vehicles';

/**
 * Seats as tuned in the Studio's vehicle tab: where a rider sits (the seat's origin, vehicle
 * metres) and where their eye is for the first-person view (offset from that origin). Anything not
 * tuned keeps the vehicle data's seat and the default eye. The server applies it to riders
 * (positions, shots, hits); clients to drawing riders and to the first-person camera. One table
 * for the whole process: every server and match share it.
 */
export interface SeatTune {
  pos?: readonly [number, number, number];
  eye?: readonly [number, number, number];
}
export type SeatTuning = Partial<Record<VehicleKind, Record<string, SeatTune>>>;

const vec = z.tuple([z.number().finite().min(-20).max(20), z.number().finite().min(-5).max(10), z.number().finite().min(-20).max(20)]);
export const seatTuningSchema = z.record(z.string(), z.record(z.string().regex(/^\d{1,2}$/), z.object({ pos: vec.optional(), eye: vec.optional() }).strict()))
  .refine((t) => Object.keys(t).every((k) => k in VEHICLES), 'unknown vehicle');

/** Seated eye above the rider's origin; standing at a gun, a standing eye. */
export const SEATED_EYE: readonly [number, number, number] = [0, 1.28, 0];
export const STANDING_EYE: readonly [number, number, number] = [0, 1.62, 0];

let tuning: SeatTuning = {};

export function setSeatTuning(t: SeatTuning): void { tuning = t; }
export function seatTuning(): SeatTuning { return tuning; }

/** The seat as tuned (or as in the vehicle data). */
export function seatPosition(kind: VehicleKind, seat: number): readonly [number, number, number] {
  return tuning[kind]?.[seat]?.pos ?? VEHICLES[kind].seats[seat] ?? VEHICLES[kind].seat;
}
/** Whether a seat's position was tuned in the Studio (then it is taken as it is, not fitted to the model). */
export const seatTuned = (kind: VehicleKind, seat: number): boolean => !!tuning[kind]?.[seat]?.pos;
/** The first-person eye of a seat, from its origin (vehicle metres). */
export function seatEye(kind: VehicleKind, seat: number, standing = false): readonly [number, number, number] {
  return tuning[kind]?.[seat]?.eye ?? (standing ? STANDING_EYE : SEATED_EYE);
}
