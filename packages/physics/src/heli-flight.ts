import { HELI_FLIGHT, VEHICLES, createVehicleMotion, enginePower, partHealth, type HeliControls, type HeliIntent, type VehicleState } from '@zion/shared';

/**
 * Helicopter flight as forces on a rigid body (the airframe is a Jolt body like any vehicle):
 * - the main rotor's thrust acts along the airframe's up axis: collective × rpm² × the rotor's and
 *   engine's health; tilting the airframe tilts the thrust, which is what moves the aircraft, so
 *   speed builds and bleeds off through inertia and drag (nothing sets a velocity or a position);
 * - the cyclic and pedals are torques: a stability system turns the pilot's stick into a commanded
 *   attitude and yaw rate and applies the torque that reaches it (critically damped), limited by
 *   the rotor's authority (no rpm, no control);
 * - drag is quadratic along each axis of the airframe (the rotor disc resists vertical motion most);
 * - a damaged tail rotor cannot hold the main rotor's torque: the airframe turns against it;
 * - collisions are the body's own contacts (Jolt), impacts and blade strikes damage it.
 * The collective is a lever: W raises it, S lowers it, it stays where it was left. With neither
 * held, the altitude hold eases the lever towards zero climb (a governor moving the real
 * control, the aircraft still answering through its own inertia).
 */

const G = 9.81;

export interface HeliBody {
  /** Column-major rotation basis (right, up, back), world velocity and angular velocity. */
  basis: readonly number[];
  v: readonly [number, number, number];
  w: readonly [number, number, number];
  /** Height of the rotor hub above whatever is under it (m). */
  clearance: number;
  airborne: boolean;
}

export interface HeliForces { force: [number, number, number]; torque: [number, number, number] }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const dot = (b: readonly number[], o: number, x: number, y: number, z: number) => b[o]! * x + b[o + 1]! * y + b[o + 2]! * z;

/**
 * One step of a helicopter's controls and rotor: updates its rotor rpm and collective and returns
 * the force and torque (world) to apply over `dt`. `pilot` is a person's controls, `intent` a
 * bot's (or a crew holding on with nobody at the controls); neither: nobody flies it.
 */
export function heliForces(v: VehicleState, body: HeliBody, pilot: HeliControls | null, intent: HeliIntent | null, dt: number): HeliForces {
  const cfg = HELI_FLIGHT[v.kind]!, def = VEHICLES[v.kind], m = v.motion ??= createVehicleMotion(v.kind);
  const mass = def.mass, alive = v.health > 0 && !v.exploded, power = alive ? enginePower(v) : 0;
  // Rotor rpm: the engine spins it up with someone aboard; with none (or no engine) it winds down.
  const manned = !!pilot || !!intent;
  const target = power > 0 && (manned || body.airborne) ? 1 : 0;
  v.rotor = clamp((v.rotor ?? 0) + clamp(target - (v.rotor ?? 0), -dt * .12, dt * cfg.spool), 0, 1);
  const rpm = v.rotor, main = partHealth(v, 'mainRotor'), tail = partHealth(v, 'tailRotor');
  const lift = main <= 0 ? 0 : .3 + .7 * main, cockpit = partHealth(v, 'cockpit') < .5 ? .6 : 1;
  const b = body.basis, [vx, vy, vz] = body.v, [wx, wy, wz] = body.w;
  // Attitude now: pitch (nose up +), bank (right side down +), and the body rates.
  const pitch = Math.asin(clamp(-b[7]!, -1, 1));
  const bank = -Math.asin(clamp(b[1]!, -1, 1));
  const q = dot(b, 0, wx, wy, wz), r = dot(b, 3, wx, wy, wz), p = dot(b, 6, wx, wy, wz);
  const hoverCollective = 1 / (cfg.thrust * Math.max(.5, b[4]!) * Math.max(.3, rpm * rpm * lift * Math.max(.35, power)));
  // Commands.
  let collective = m.collective ?? 0, wantPitch = 0, wantBank = 0, wantYaw = 0;
  if (pilot) {
    if (Math.abs(pilot.collective) > .05) collective += pilot.collective * dt * .45;
    // Altitude hold: the lever eases towards zero climb.
    else if (body.airborne) collective += clamp(hoverCollective - .06 * vy - collective, -dt * .35, dt * .35);
    wantPitch = -clamp(pilot.stickY, -1, 1) * cfg.maxPitch;
    // The mouse is the cyclic (nose and bank); A and D the pedals (the tail rotor turns the nose).
    wantBank = clamp(pilot.stickX, -1, 1) * cfg.maxBank;
    wantYaw = -clamp(pilot.bank, -1, 1) * cfg.yawRate;
  } else if (intent) {
    collective += clamp(hoverCollective + .08 * (intent.climb - vy) - collective, -dt * .5, dt * .5);
    wantPitch = -clamp(intent.forward, -1, 1) * cfg.maxPitch * .8;
    wantYaw = -clamp(intent.turn, -1, 1) * cfg.yawRate;
    wantBank = clamp(intent.turn, -1, 1) * cfg.maxBank * .45;
  } else collective += clamp(-collective, -dt * .2, dt * .2);
  collective = m.collective = clamp(collective, 0, 1);
  // Main rotor thrust along the airframe's up axis (a little more in ground effect).
  const groundEffect = 1 + .12 * Math.max(0, 1 - body.clearance / cfg.radius);
  const thrust = collective * cfg.thrust * mass * G * rpm * rpm * lift * power * groundEffect;
  // Drag along the airframe's axes.
  const vf = -dot(b, 6, vx, vy, vz), vs = dot(b, 0, vx, vy, vz), vu = dot(b, 3, vx, vy, vz);
  const df = -cfg.dragForward * Math.abs(vf) * vf, ds = -cfg.dragSide * Math.abs(vs) * vs, du = -cfg.dragVertical * Math.abs(vu) * vu;
  const force: [number, number, number] = [
    b[3]! * (thrust + du) + b[0]! * ds - b[6]! * df,
    b[4]! * (thrust + du) + b[1]! * ds - b[7]! * df,
    b[5]! * (thrust + du) + b[2]! * ds - b[8]! * df,
  ];
  // Stability system: angular accelerations that bring the attitude to the command, critically
  // damped, as torques on an inertia of the airframe's size; the rotor's authority limits them.
  const W = def.halfX * 2, H = def.height, L = def.halfZ * 2, w0 = cfg.response * cockpit;
  const Ix = mass * (H * H + L * L) / 12, Iy = mass * (W * W + L * L) / 12, Iz = mass * (W * W + H * H) / 12;
  const authority = rpm * rpm * lift;
  const ax = clamp(w0 * w0 * (wantPitch - pitch) - 2 * w0 * q, -4, 4) * authority;
  const az = clamp(w0 * w0 * (bank - wantBank) - 2 * w0 * p, -4, 4) * authority;
  let ay = clamp(2.5 * (wantYaw - r), -3, 3) * rpm * tail;
  // A failing tail rotor leaves the main rotor's torque unopposed.
  ay += (1 - tail) * 1.4 * (thrust / (mass * G)) * rpm;
  const tx = Ix * ax, ty = Iy * ay, tz = Iz * az;
  const torque: [number, number, number] = [
    b[0]! * tx + b[3]! * ty + b[6]! * tz,
    b[1]! * tx + b[4]! * ty + b[7]! * tz,
    b[2]! * tx + b[5]! * ty + b[8]! * tz,
  ];
  return { force, torque };
}
