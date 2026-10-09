import { Mask } from './layers';
import { makeRayHit } from './shapes';
import type { CollisionWorld } from './world';

export interface ProjectileState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Came to rest; no further simulation needed. */
  resting: boolean;
}

const hit = makeRayHit();
const RADIUS = 0.08;
const RESTITUTION = 0.38;
const FRICTION = 0.7;

/**
 * Bouncing projectile (grenade) step: gravity, swept against terrain and solid props with
 * reflection. Deterministic, so the client replays the server's throw with the same code.
 */
export function stepProjectile(s: ProjectileState, world: CollisionWorld, gravity: number, dt: number): void {
  if (s.resting) return;
  s.vy -= gravity * dt;
  let remaining = dt;
  for (let iter = 0; iter < 3 && remaining > 1e-5; iter++) {
    const speed = Math.hypot(s.vx, s.vy, s.vz);
    if (speed < 1e-4) break;
    const dist = speed * remaining;
    const dx = s.vx / speed;
    const dy = s.vy / speed;
    const dz = s.vz / speed;
    if (!world.raycast(s.x, s.y, s.z, dx, dy, dz, dist + RADIUS, Mask.LineOfSight, hit)) {
      s.x += dx * dist;
      s.y += dy * dist;
      s.z += dz * dist;
      break;
    }
    const travel = Math.max(0, hit.t - RADIUS);
    s.x += dx * travel;
    s.y += dy * travel;
    s.z += dz * travel;
    remaining *= 1 - travel / Math.max(dist, 1e-6);
    // Reflect around the surface normal, losing energy.
    const vn = s.vx * hit.nx + s.vy * hit.ny + s.vz * hit.nz;
    s.vx = (s.vx - 2 * vn * hit.nx) * FRICTION;
    s.vy = s.vy - 2 * vn * hit.ny;
    s.vz = (s.vz - 2 * vn * hit.nz) * FRICTION;
    const nvn = s.vx * hit.nx + s.vy * hit.ny + s.vz * hit.nz;
    // Scale only the normal component by restitution.
    s.vx += (RESTITUTION - 1) * nvn * hit.nx;
    s.vy += (RESTITUTION - 1) * nvn * hit.ny;
    s.vz += (RESTITUTION - 1) * nvn * hit.nz;
    if (hit.ny > 0.6 && Math.hypot(s.vx, s.vy, s.vz) < 0.6) {
      s.vx = s.vy = s.vz = 0;
      s.resting = true;
      break;
    }
  }
  // Never sink below the heightfield.
  const ground = world.terrainHeight(s.x, s.z);
  if (ground === ground && s.y < ground + RADIUS) {
    s.y = ground + RADIUS;
    if (s.vy < 0) s.vy = -s.vy * RESTITUTION;
  }
}
