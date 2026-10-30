import { VEHICLES, createVehicleMotion, type VehicleState } from '@zion/shared';
import { Mask } from './layers';
import { makeRayHit } from './shapes';
import type { CollisionWorld } from './world';

/**
 * Helicopter flight, a force model at game scale (not a flight simulator):
 * - the rotor spools up with a pilot aboard (≈3 s) and only lifts once nearly at speed;
 * - the collective (Space up / C down) sets the climb rate, gravity wins when the rotor slows;
 * - the cyclic (W/S) tilts the nose and accelerates along the heading against air drag;
 * - the pedals (A/D) turn it; it banks into turns and pitches with acceleration (visual);
 * - the ground stops it: a hard landing or flying into terrain or a building damages it.
 * Without a pilot in the air it settles slowly (the autopilot of a trained crew), then lands.
 */

export interface HeliInput { throttle: number; steer: number; lift: number }

const hit = makeRayHit();
const approach = (v: number, target: number, rate: number) => v + Math.max(-rate, Math.min(rate, target - v));

/** One step; returns the impact speed when it struck something hard (0 otherwise). */
export function stepHelicopter(v: VehicleState, input: HeliInput | undefined, world: CollisionWorld, dt: number): number {
  const def = VEHICLES[v.kind], m = v.motion ??= createVehicleMotion(v.kind);
  const alive = v.health > 0 && !v.exploded;
  const ground = world.terrainHeight(v.x, v.z);
  const floor = Number.isFinite(ground) ? ground : v.y;
  const airborne = v.y > floor + .15;
  // Rotor: spools with a pilot (or keeps turning in flight), winds down otherwise.
  const powered = alive && (!!input || airborne);
  v.rotor = approach(v.rotor ?? 0, powered ? 1 : 0, dt * (powered ? .34 : .12));
  const flying = (v.rotor ?? 0) > .85 && alive;
  // Vertical: the collective asks for a climb rate; a slow rotor cannot hold the weight.
  const wantVy = !alive ? -30 : input ? input.lift * 7 : airborne ? -2.2 : 0;
  if (flying) m.vy = approach(m.vy, wantVy, dt * 9);
  else m.vy -= 9.81 * (1 - (v.rotor ?? 0) * .9) * dt;
  // Cyclic: accelerate along the heading, air drag takes the speed off.
  const throttle = flying ? input?.throttle ?? 0 : 0, steer = input?.steer ?? 0;
  if (flying && airborne) v.speed += throttle * def.acceleration * dt;
  // Drag: top speed where it balances the cyclic's push.
  v.speed -= v.speed * (airborne ? def.acceleration / def.maxSpeed : 3) * dt;
  v.speed = Math.max(-def.maxSpeed * .3, Math.min(def.maxSpeed, v.speed));
  m.lateral = (m.lateral ?? 0) * Math.exp(-dt * 1.5);
  // Pedals: turn (faster when slow), easing in and out.
  const yawRate = (flying ? steer * def.turn * 1.25 : 0) * (airborne ? 1 : .4);
  m.yawVelocity = approach(m.yawVelocity ?? 0, yawRate, dt * 3);
  v.yaw -= (m.yawVelocity ?? 0) * dt;
  // Attitude (seen, and where the guns point): nose down to speed up, bank into turns.
  m.pitch = approach(m.pitch, airborne ? -throttle * .2 - v.speed / def.maxSpeed * .06 : 0, dt * .8);
  m.roll = approach(m.roll, airborne ? -steer * .28 * Math.min(1, Math.abs(v.speed) / 20 + .3) : 0, dt * 1.2);
  // Move, stopping at whatever is in the way.
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
  const vx = fx * v.speed + rx * (m.lateral ?? 0), vz = fz * v.speed + rz * (m.lateral ?? 0);
  const step = Math.hypot(vx, vz) * dt;
  let impact = 0;
  if (step > 1e-4) {
    const dx = vx * dt / step, dz = vz * dt / step, reach = def.halfZ * .55;
    // From the fuselage's middle height, a little ahead of the nose.
    if (world.raycast(v.x, v.y + def.height * .5, v.z, dx, 0, dz, step + reach, Mask.LineOfSight, hit) && hit.t < step + reach) {
      impact = Math.max(impact, Math.abs(v.speed));
      v.speed = 0; m.lateral = 0;
    } else { v.x += vx * dt; v.z += vz * dt; }
  }
  v.y += m.vy * dt;
  // Ground (and roofs) under the skids.
  const under = world.terrainHeight(v.x, v.z);
  let base = Number.isFinite(under) ? under : -Infinity;
  if (world.raycast(v.x, v.y + 1.2, v.z, 0, -1, 0, 1.2 + Math.max(0, -m.vy * dt) + .05, Mask.LineOfSight, hit)) base = Math.max(base, v.y + 1.2 - hit.t);
  if (v.y <= base) {
    if (m.vy < -6) impact = Math.max(impact, -m.vy);
    if (Math.abs(v.speed) > 14) impact = Math.max(impact, Math.abs(v.speed) * .8);
    v.y = base; m.vy = Math.max(0, m.vy); m.grounded = true;
  } else m.grounded = false;
  return impact;
}

/** Damage from an impact speed (m/s): nothing for a firm landing, a wreck for a crash. */
export const heliImpactDamage = (speed: number): number => (speed < 6 ? 0 : Math.round((speed - 6) ** 1.6 * 25));
