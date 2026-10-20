import { WeaponId, type GunSpec, type ProjectileSpec } from './weapons';

export interface BallisticState { x: number; y: number; z: number; vx: number; vy: number; vz: number; }

/** Exact integration with gravity and linear air resistance, independent of render rate. */
export function advanceBallistic(s: BallisticState, gravity: number, drag: number, dt: number): void {
  if (drag <= 0) {
    s.x += s.vx * dt; s.y += s.vy * dt - .5 * gravity * dt * dt; s.z += s.vz * dt;
    s.vy -= gravity * dt;
    return;
  }
  const decay = Math.exp(-drag * dt);
  const travel = -Math.expm1(-drag * dt) / drag;
  s.x += s.vx * travel; s.z += s.vz * travel;
  s.y += s.vy * travel - gravity * (dt - travel) / drag;
  s.vx *= decay; s.vz *= decay;
  s.vy = s.vy * decay - gravity * travel;
}

/** Ballistic ammunition; existing effective ranges and damage remain weapon-specific. */
export function bulletSpec(weapon: number, gun: GunSpec): ProjectileSpec {
  // Game-paced muzzle speeds: rounds visibly arc and drop past their zero (real ones are ~2× faster).
  const speed = gun.pellets > 1 ? 260
    : [WeaponId.GL18, WeaponId.Revolver, WeaponId.MP5, WeaponId.Uzi, WeaponId.Deagle].some(id => id === weapon) ? 270
    : [WeaponId.AWM, WeaponId.Barrett, WeaponId.SVD, WeaponId.Kar98k, WeaponId.Remington700].some(id => id === weapon) ? 560 : 400;
  return { kind: 'bullet', speed, gravity: 9.81, drag: .12, maxFlightSec: gun.range / speed * 1.5, maxRange: gun.range };
}

/**
 * Zeroing: the round leaves the body at muzzle height, the sight line runs at eye height. Tilt the
 * shot so it crosses the sight line at `distance` metres, including the drop over that distance,
 * so the reticle / front sight is exact at the zero and close everywhere a fight happens.
 */
export function zeroedDirection(ax: number, ay: number, az: number, muzzleY: number, eyeY: number, distance: number, speed: number, gravity: number): [number, number, number] {
  const tx = ax * distance, ty = eyeY - muzzleY + ay * distance, tz = az * distance;
  const flat = Math.hypot(tx, tz) || 1e-6;
  const pitch = Math.atan2(ty, flat) + Math.atan(gravity * distance / (2 * speed * speed));
  const c = Math.cos(pitch);
  return [tx / flat * c, Math.sin(pitch), tz / flat * c];
}

/**
 * The shot already points from the muzzle at what the crosshair is on (third / first person):
 * lift it just enough for the drop over the zero distance, so the round lands on the crosshair
 * there (a few centimetres high before it) and falls below it further out.
 */
export function droppedDirection(ax: number, ay: number, az: number, distance: number, speed: number, gravity: number): [number, number, number] {
  const flat = Math.hypot(ax, az) || 1e-6;
  const pitch = Math.atan2(ay, flat) + Math.atan(gravity * distance / (2 * speed * speed));
  const c = Math.cos(pitch);
  return [ax / flat * c, Math.sin(pitch), az / flat * c];
}

/** Zero range: 100 m through an optic (capped by the gun's reach), 50 m on iron sights. */
export function zeroDistance(gun: GunSpec, optic: boolean): number {
  return Math.max(10, Math.min(gun.range * .8, optic ? 100 : 50));
}

/** ADS settles over time; walking and sustained fire widen the cone, prone steadies it. */
export function gunSpread(gun: GunSpec, aim: number, speed: number, prone: boolean, heat = 0): number {
  const ads = Math.max(0, Math.min(1, aim));
  const aimed = gun.pellets > 1 ? .72 : .3;
  return gun.spread * (1.45 + (aimed - 1.45) * ads)
    * (1 + Math.min(8, Math.max(0, speed)) * .14) * (prone ? .72 : 1) * (1 + Math.max(0, heat) * .6);
}
