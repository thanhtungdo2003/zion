import type { VehicleKind } from './vehicles';

/**
 * Flight configuration of each helicopter, the rigid body flown by rotor forces in the physics
 * package (heli-flight.ts). Positions are vehicle metres (+X right, +Y up, −Z forward).
 *
 * Mass and size come from VEHICLES; this is what the rotor and the airframe add:
 * - `thrust`: main rotor thrust at full collective and rpm, in multiples of the weight (hover
 *   needs 1 / thrust of the collective);
 * - `maxPitch` / `maxBank`: the attitude the cyclic commands at full stick (rad); the tilt of the
 *   rotor disc is what moves the aircraft, so these also bound its acceleration and top speed;
 * - `yawRate`: the turn rate the tail rotor gives at full pedal (rad/s);
 * - `response`: how quickly the stability system brings the airframe to the commanded attitude
 *   (natural frequency, rad/s), critically damped;
 * - drag: `dragForward` (m²: ½ρ·Cd·A along the nose), sideways and vertical (the rotor disc);
 * - `hub` and `radius`: the main rotor, for blade strikes; `tail`: the tail rotor;
 * - `spool`: rotor rpm gained per second (0–1) when the engine is running.
 */
export interface HeliFlight {
  thrust: number;
  maxPitch: number;
  maxBank: number;
  yawRate: number;
  response: number;
  dragForward: number;
  dragSide: number;
  dragVertical: number;
  hub: readonly [number, number, number];
  radius: number;
  tail: readonly [number, number, number];
  spool: number;
}

export const HELI_FLIGHT: Partial<Record<VehicleKind, HeliFlight>> = {
  // A heavy transport: steady and slow to answer.
  mi17: { thrust: 1.45, maxPitch: .38, maxBank: .5, yawRate: .75, response: 2.1, dragForward: 18, dragSide: 60, dragVertical: 170, hub: [0, 4.9, .83], radius: 10.5, tail: [.6, 5.07, 14.2], spool: .3 },
  // Attack helicopters: lighter, more power for their weight, nimble.
  z10: { thrust: 1.7, maxPitch: .48, maxBank: .65, yawRate: 1.15, response: 3, dragForward: 6.5, dragSide: 22, dragVertical: 70, hub: [0, 3.05, 0], radius: 6.2, tail: [.48, 3.3, 6.9], spool: .38 },
  tiger: { thrust: 1.7, maxPitch: .48, maxBank: .65, yawRate: 1.15, response: 3, dragForward: 6.5, dragSide: 22, dragVertical: 70, hub: [0, 3.43, -.6], radius: 6.6, tail: [.5, 3, 7.55], spool: .38 },
};

/**
 * A pilot's controls, all −1…1:
 * - `collective`: raising (W) or lowering (S) the collective lever; it stays where it is left;
 * - `bank`: the cyclic to the left (A, −) or right (D, +);
 * - `stickX` / `stickY`: the mouse as the cyclic and pedals — right turns the nose right (and
 *   banks into the turn), forward (mouse up) dips the nose to fly forward.
 * Bots (and a crew holding a hover with nobody at the controls) fly by intent instead: a climb
 * rate, a forward push and a turn, which the same stability system turns into rotor commands.
 */
export interface HeliControls { collective: number; bank: number; stickX: number; stickY: number }
export interface HeliIntent { climb: number; forward: number; turn: number }
