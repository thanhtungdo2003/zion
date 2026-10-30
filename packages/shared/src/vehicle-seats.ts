import { z } from 'zod';
import { VEHICLES, type VehicleKind } from './vehicles';
import { VEHICLE_ROLES } from './vehicle-arms';

/**
 * Seats as set in the Studio's vehicle tab. Each seat has its own contact points, in the
 * vehicle's metres (+X right, +Y up, −Z forward):
 * - `hip`: where the rider's seat (buttocks) rests; the rider's origin follows from it
 *   (`pos` — the older form — is the origin itself);
 * - `hands`: where the left and right hands grip (wheel, bars, handles);
 * - `feet`: where the left and right feet rest (pedals, footrests, floor);
 * - `eye`: the first-person eye, from the rider's origin.
 * Seats can be added after the vehicle's own (`count` above its data) or the passenger seats at
 * the end removed (never the driver's or a weapon seat). Anything not set keeps the vehicle data.
 * The server places riders by it; clients draw riders on it and start the first-person view there.
 */
const vec = z.tuple([z.number().finite().min(-20).max(20), z.number().finite().min(-5).max(10), z.number().finite().min(-20).max(20)]);
const pair = z.tuple([vec, vec]);
const seatTune = z.object({ pos: vec.optional(), hip: vec.optional(), eye: vec.optional(), hands: pair.optional(), feet: pair.optional() }).strict();
export type SeatVec = readonly [number, number, number];
export interface SeatTune {
  pos?: SeatVec;
  hip?: SeatVec;
  eye?: SeatVec;
  hands?: readonly [SeatVec, SeatVec];
  feet?: readonly [SeatVec, SeatVec];
}
export interface VehicleSeatTuning { count?: number; seats?: Record<string, SeatTune> }
export type SeatTuning = Partial<Record<VehicleKind, VehicleSeatTuning>>;

const vehicleTuning = z.preprocess(
  // The first saved form was the seats themselves, keyed by index.
  (v) => (v && typeof v === 'object' && !('seats' in v) && !('count' in v) ? { seats: v } : v),
  z.object({ count: z.number().int().min(1).max(24).optional(), seats: z.record(z.string().regex(/^\d{1,2}$/), seatTune).optional() }).strict(),
);
export const seatTuningSchema = z.record(z.string(), vehicleTuning)
  .refine((t) => Object.keys(t).every((k) => k in VEHICLES), 'unknown vehicle')
  .refine((t) => Object.entries(t).every(([k, v]) => {
    const kind = k as VehicleKind, count = v.count ?? VEHICLES[kind].seats.length;
    // Never fewer seats than the driver's and the weapon seats; added seats need a place.
    if (count < minSeats(kind)) return false;
    for (let i = VEHICLES[kind].seats.length; i < count; i++) if (!v.seats?.[i]?.pos && !v.seats?.[i]?.hip) return false;
    return true;
  }), 'invalid seat count');

/** Seated, the hips rest this far above (and a little behind) the rider's origin; standing, the hips are higher. */
export const SEATED_HIP: SeatVec = [0, .47, .05];
export const STANDING_HIP: SeatVec = [0, .95, 0];
/** Seated eye above the rider's origin; standing at a gun, a standing eye. */
export const SEATED_EYE: SeatVec = [0, 1.28, 0];
export const STANDING_EYE: SeatVec = [0, 1.62, 0];

let tuning: SeatTuning = {};

export function setSeatTuning(t: SeatTuning): void { tuning = t; }
export function seatTuning(): SeatTuning { return tuning; }

const tuneOf = (kind: VehicleKind, seat: number): SeatTune | undefined => tuning[kind]?.seats?.[seat];
/** Seats a vehicle has (its own, plus or minus what the Studio set). */
export const seatCount = (kind: VehicleKind): number => tuning[kind]?.count ?? VEHICLES[kind].seats.length;
/** The fewest seats a vehicle may be left with: the driver's and every weapon seat. */
export function minSeats(kind: VehicleKind): number {
  return Math.max(1, ...VEHICLE_ROLES[kind].weapons.map((w) => w.seat + 1));
}
/** A rider stands at this seat (a weapon seat other than the driver's). */
const stands = (kind: VehicleKind, seat: number) => seat > 0 && VEHICLE_ROLES[kind].weapons.some((w) => w.seat === seat);

/** The rider's origin at a seat: from its hip point, its position, or the vehicle data. */
export function seatPosition(kind: VehicleKind, seat: number): SeatVec {
  const t = tuneOf(kind, seat);
  if (t?.hip) { const o = stands(kind, seat) ? STANDING_HIP : SEATED_HIP; return [t.hip[0] - o[0], t.hip[1] - o[1], t.hip[2] - o[2]]; }
  return t?.pos ?? VEHICLES[kind].seats[seat] ?? VEHICLES[kind].seats.at(-1) ?? VEHICLES[kind].seat;
}
/** The hip point of a seat (as set, or where the rider's origin puts it). */
export function seatHip(kind: VehicleKind, seat: number): SeatVec {
  const t = tuneOf(kind, seat);
  if (t?.hip) return t.hip;
  const p = seatPosition(kind, seat), o = stands(kind, seat) ? STANDING_HIP : SEATED_HIP;
  return [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
}
/** Whether a seat's place was set in the Studio (then it is taken as it is, not fitted to the model). */
export const seatTuned = (kind: VehicleKind, seat: number): boolean => !!(tuneOf(kind, seat)?.pos || tuneOf(kind, seat)?.hip);
/** The first-person eye of a seat, from its origin (vehicle metres). */
export function seatEye(kind: VehicleKind, seat: number, standing = false): SeatVec {
  return tuneOf(kind, seat)?.eye ?? (standing ? STANDING_EYE : SEATED_EYE);
}
/** Where a seat's hands grip and feet rest (vehicle metres), where set. */
export function seatContacts(kind: VehicleKind, seat: number): { hands?: readonly [SeatVec, SeatVec]; feet?: readonly [SeatVec, SeatVec] } {
  const t = tuneOf(kind, seat);
  return { ...(t?.hands ? { hands: t.hands } : {}), ...(t?.feet ? { feet: t.feet } : {}) };
}
