import type { InputMessage } from '@zion/shared';
import { Mask, makeRayHit, type CollisionWorld } from '@zion/physics';

export interface ShotBore { x: number; y: number; z: number; dx: number; dy: number; dz: number }

/** Accept a reachable animated muzzle, keeping its origin on the player's side of cover. */
export function animatedBore(
  feet: { x: number; y: number; z: number }, fallback: ShotBore,
  bore: InputMessage['bore'], collision: Pick<CollisionWorld, 'raycast'>,
): ShotBore {
  if (!bore || !Object.values(bore).every(Number.isFinite)
    || Math.hypot(bore.x, bore.z) > 2.4 || bore.y < -.5 || bore.y > 3
    || Math.abs(Math.hypot(bore.dx, bore.dy, bore.dz) - 1) >= .01) return fallback;
  const out = { ...bore, x: feet.x + bore.x, y: feet.y + bore.y, z: feet.z + bore.z };
  const n = Math.hypot(out.dx, out.dy, out.dz);
  out.dx /= n; out.dy /= n; out.dz /= n;
  const sx = out.x - fallback.x, sy = out.y - fallback.y, sz = out.z - fallback.z;
  const distance = Math.hypot(sx, sy, sz), hit = makeRayHit();
  if (distance > 1e-5 && collision.raycast(fallback.x, fallback.y, fallback.z,
    sx / distance, sy / distance, sz / distance, distance, Mask.Weapon, hit)) {
    const t = Math.max(0, hit.t - .02) / distance;
    out.x = fallback.x + sx * t; out.y = fallback.y + sy * t; out.z = fallback.z + sz * t;
  }
  return out;
}
