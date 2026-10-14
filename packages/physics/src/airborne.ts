import { BATTLE_FLIGHT } from '@zion/shared';
import type { CharacterInput, CharacterState } from './character';
import type { CollisionWorld } from './world';
import { Mask } from './layers';
import { makeRayHit } from './shapes';

const hit = makeRayHit();
/** Deterministic insertion movement shared by the authoritative server and prediction. */
export function stepAirborne(s: CharacterState, input: CharacterInput, world: CollisionWorld, dt: number): void {
  if (!s.flight || s.flight === 1) { s.freefall = 0; return; }
  if (s.flight === 2) s.freefall = (s.freefall ?? 0) + dt;
  // High up, keep flying over terrain that is not streamed in yet (stopping here made prediction
  // freeze and snap back, felt as lag); only near the ground wait for the landing area.
  const ground = world.terrainHeight(s.x, s.z);
  if (!Number.isFinite(ground) && s.y - world.seaLevel < 250) return;
  const altitude = Number.isFinite(ground) ? s.y - ground : Infinity;
  // The canopy can only be pulled after a few seconds clear of the plane; the low-altitude auto
  // deploy stays as a safety.
  const canDeploy = (s.freefall ?? 0) * 1000 >= BATTLE_FLIGHT.deployDelayMs;
  if (s.flight === 2 && ((input.jump && canDeploy) || altitude <= BATTLE_FLIGHT.autoDeployHeight)) s.flight = 3;
  const canopy = s.flight === 3, dive = input.sprint && !canopy;
  const length = Math.max(1, Math.hypot(input.mx, input.mz));
  const speed = canopy ? 18 : dive ? 24 : 32;
  const mx = input.mx / length, mz = input.mz / length;
  const c = Math.cos(input.yaw), sin = Math.sin(input.yaw);
  const k = 1 - Math.exp(-dt * (canopy ? 2 : 3));
  s.vx += ((c * mx - sin * mz) * speed - s.vx) * k;
  s.vz += ((-sin * mx - c * mz) * speed - s.vz) * k;
  s.vy += ((canopy ? -7 : dive ? -85 : -42) - s.vy) * (1 - Math.exp(-dt * (canopy ? 5 : 2)));
  const dx = s.vx * dt, dy = s.vy * dt, dz = s.vz * dt;
  const distance = Math.hypot(dx, dy, dz);
  if (distance > 0 && world.raycast(s.x, s.y + .15, s.z, dx / distance, dy / distance, dz / distance, distance + .15, Mask.CharacterMovement, hit)) {
    if (hit.ny > .7) { s.x = hit.x; s.y = hit.y + .02; s.z = hit.z; s.flight = 0; s.grounded = true; s.vx = s.vy = s.vz = 0; return; }
    s.vx = s.vz = 0;
  } else {
    s.x = Math.max(3, Math.min(world.worldSize - 3, s.x + dx));
    s.z = Math.max(3, Math.min(world.worldSize - 3, s.z + dz));
  }
  const nextGround = world.terrainHeight(s.x, s.z);
  if (Number.isFinite(nextGround) && s.y + dy <= nextGround) {
    s.y = nextGround + .02; s.flight = 0; s.grounded = true; s.vx = s.vy = s.vz = 0;
  } else { s.y += dy; s.grounded = false; }
  s.prone = false; s.swimming = false; s.rollTicks = 0;
}
