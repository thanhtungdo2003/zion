import { raySphere, rayCapsule } from './geometry';
import { makeCapsule, type CapsuleShape } from './shapes';

/**
 * Hitboxes are separate from movement colliders: a character moves as one capsule but is *hit*
 * per body part. Rig parts are defined in the character's local frame (feet origin, facing −Z)
 * and posed from the server's authoritative (or lag-compensated historical) transform.
 */
export type HitZone = 'head' | 'torso' | 'arm_l' | 'arm_r' | 'leg_l' | 'leg_r';

export interface RigPart {
  zone: HitZone;
  /** Local segment endpoints (a == b for a sphere) and radius. */
  a: readonly [number, number, number];
  b: readonly [number, number, number];
  r: number;
}

export const HUMANOID_RIG: readonly RigPart[] = [
  { zone: 'head', a: [0, 1.62, 0], b: [0, 1.62, 0], r: 0.13 },
  { zone: 'torso', a: [0, 1.0, 0], b: [0, 1.4, 0], r: 0.22 },
  { zone: 'arm_l', a: [-0.32, 0.85, 0], b: [-0.3, 1.38, 0], r: 0.07 },
  { zone: 'arm_r', a: [0.32, 0.85, 0], b: [0.3, 1.38, 0], r: 0.07 },
  { zone: 'leg_l', a: [-0.11, 0.1, 0], b: [-0.11, 0.86, 0], r: 0.1 },
  { zone: 'leg_r', a: [0.11, 0.1, 0], b: [0.11, 0.86, 0], r: 0.1 },
];

/** Hunched zombie: head low and forward, arms hanging out in front. */
export const ZOMBIE_RIG: readonly RigPart[] = [
  { zone: 'head', a: [0, 1.58, -0.3], b: [0, 1.58, -0.3], r: 0.203 },
  { zone: 'torso', a: [0, 0.9, -0.03], b: [0, 1.38, -0.22], r: 0.324 },
  { zone: 'arm_l', a: [-0.36, 1.36, -0.2], b: [-0.36, 0.72, -0.55], r: 0.108 },
  { zone: 'arm_r', a: [0.36, 1.36, -0.2], b: [0.36, 0.72, -0.55], r: 0.108 },
  { zone: 'leg_l', a: [-0.12, 0.08, 0], b: [-0.12, 0.8, 0], r: 0.135 },
  { zone: 'leg_r', a: [0.12, 0.08, 0], b: [0.12, 0.8, 0], r: 0.135 },
];

/** Zombie dragging itself along the ground (head toward −Z). */
export const ZOMBIE_CRAWL_RIG: readonly RigPart[] = [
  { zone: 'head', a: [0, 0.32, -0.8], b: [0, 0.32, -0.8], r: 0.203 },
  { zone: 'torso', a: [0, 0.25, 0.25], b: [0, 0.3, -0.5], r: 0.324 },
  { zone: 'arm_l', a: [-0.32, 0.25, -0.5], b: [-0.38, 0.1, -1.1], r: 0.108 },
  { zone: 'arm_r', a: [0.32, 0.25, -0.5], b: [0.38, 0.1, -1.1], r: 0.108 },
  { zone: 'leg_l', a: [-0.12, 0.18, 0.35], b: [-0.14, 0.1, 1.1], r: 0.135 },
  { zone: 'leg_r', a: [0.12, 0.18, 0.35], b: [0.14, 0.1, 1.1], r: 0.135 },
];

export const ZONE_DAMAGE_MULTIPLIER: Readonly<Record<HitZone, number>> = {
  head: 2.0,
  torso: 1.0,
  arm_l: 0.6,
  arm_r: 0.6,
  leg_l: 0.7,
  leg_r: 0.7,
};

export interface RigHit {
  t: number;
  zone: HitZone;
}

const scratchCapsule: CapsuleShape = makeCapsule(0, 0, 0, 0, 0, 0, 0);

/**
 * Ray vs a posed rig. Returns the nearest part hit within maxDist, or null.
 * (px,py,pz) is the feet position, yaw uses the three.js rotation.y convention.
 */
export function raycastRig(
  rig: readonly RigPart[],
  px: number,
  py: number,
  pz: number,
  yaw: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
): RigHit | null {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let best: RigHit | null = null;
  for (const part of rig) {
    const ax = px + part.a[0] * c + part.a[2] * s;
    const ay = py + part.a[1];
    const az = pz - part.a[0] * s + part.a[2] * c;
    const bx = px + part.b[0] * c + part.b[2] * s;
    const by = py + part.b[1];
    const bz = pz - part.b[0] * s + part.b[2] * c;
    let t: number;
    if (ax === bx && ay === by && az === bz) {
      t = raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, part.r);
    } else {
      scratchCapsule.ax = ax;
      scratchCapsule.ay = ay;
      scratchCapsule.az = az;
      scratchCapsule.bx = bx;
      scratchCapsule.by = by;
      scratchCapsule.bz = bz;
      scratchCapsule.r = part.r;
      t = rayCapsule(ox, oy, oz, dx, dy, dz, scratchCapsule);
    }
    if (t >= 0 && t <= maxDist && (!best || t < best.t)) best = { t, zone: part.zone };
  }
  return best;
}

/** Conservative bounding sphere of the rig (for broad-phase target selection). */
export const HUMANOID_BOUNDS = { centerY: 0.9, radius: 1.0 } as const;
