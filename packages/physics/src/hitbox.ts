import { raySphere, rayCapsule } from './geometry';
import { makeCapsule, type CapsuleShape } from './shapes';
import { isCrawling, ZombieVariant } from '@zion/shared';

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

/** Feet-origin matches the render skeleton lowered into a driving seat. */
export const SEATED_RIG: readonly RigPart[] = [
  { zone: 'head', a: [0, 1.37, -.05], b: [0, 1.37, -.05], r: .14 },
  { zone: 'torso', a: [0, .72, 0], b: [0, 1.15, -.04], r: .22 },
  { zone: 'arm_l', a: [-.3, 1.1, 0], b: [-.3, .88, -.48], r: .08 },
  { zone: 'arm_r', a: [.3, 1.1, 0], b: [.3, .88, -.48], r: .08 },
  { zone: 'leg_l', a: [-.16, .7, 0], b: [-.16, .45, -.48], r: .12 },
  { zone: 'leg_r', a: [.16, .7, 0], b: [.16, .45, -.48], r: .12 },
];

/** Authored prone root tilts the body forward, with the head raised just above the ground. */
export const PRONE_RIG: readonly RigPart[] = [
  { zone: 'head', a: [0, .4, -1.5], b: [0, .4, -1.5], r: .14 },
  { zone: 'torso', a: [0, .28, -.8], b: [0, .3, -1.2], r: .22 },
  { zone: 'arm_l', a: [-.3, .3, -1.2], b: [-.25, .25, -1.65], r: .08 },
  { zone: 'arm_r', a: [.3, .3, -1.2], b: [.25, .25, -1.65], r: .08 },
  { zone: 'leg_l', a: [-.12, .18, -.08], b: [-.12, .2, -.8], r: .1 },
  { zone: 'leg_r', a: [.12, .18, -.08], b: [.12, .2, -.8], r: .1 },
];

/**
 * A player's hit rig for a stance: crouched (squatting, everything lower) and/or leaning out to
 * a side (the upper body and head shift sideways, the legs stay). Cached per combination.
 */
const humanoidPoses = new Map<string, readonly RigPart[]>();
export function humanoidRig(crouched: boolean, lean: number): readonly RigPart[] {
  if (!crouched && !lean) return HUMANOID_RIG;
  const key = `${crouched ? 1 : 0}:${lean}`;
  let rig = humanoidPoses.get(key);
  if (!rig) {
    const move = (p: readonly [number, number, number]): [number, number, number] => {
      const y = crouched ? (p[1] > .86 ? p[1] - .5 : p[1] * .42) : p[1];
      // Lean pivots at the hips: higher points move further sideways (+X is the right).
      const shift = lean * .42 * Math.max(0, Math.min(1, (y - (crouched ? .36 : .86)) / .76));
      return [p[0] + shift, y - Math.abs(shift) * .15, p[2]];
    };
    rig = HUMANOID_RIG.map((part) => ({ ...part, a: move(part.a), b: move(part.b) }));
    humanoidPoses.set(key, rig);
  }
  return rig;
}

function bruteRig(rig: readonly RigPart[]): readonly RigPart[] {
  return rig.map((p) => ({ ...p, a: [p.a[0] * 1.5, p.a[1] * 1.5, p.a[2] * 1.5], b: [p.b[0] * 1.5, p.b[1] * 1.5, p.b[2] * 1.5], r: p.r * 1.5 }));
}
const BRUTE_RIG = bruteRig(ZOMBIE_RIG);
const BRUTE_CRAWL_RIG = bruteRig(ZOMBIE_CRAWL_RIG);

/** Shared by server hit detection and client aiming, including the low Crimson stance. */
export function zombieHitRig(variant: ZombieVariant, limbs: number, grounded: boolean): readonly RigPart[] {
  const crawl = isCrawling(limbs) || (variant === ZombieVariant.Crimson && grounded);
  return variant === ZombieVariant.Brute ? (crawl ? BRUTE_CRAWL_RIG : BRUTE_RIG) : (crawl ? ZOMBIE_CRAWL_RIG : ZOMBIE_RIG);
}

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

const boundsCache = new WeakMap<readonly RigPart[], { centerY: number; radius: number }>();
/** Covers scaled/crawling rigs as well as ordinary humanoids. Cached per immutable rig. */
export function rigBounds(rig: readonly RigPart[]): { centerY: number; radius: number } {
  const cached = boundsCache.get(rig); if (cached) return cached;
  let bottom = Infinity, top = -Infinity;
  for (const p of rig) { bottom = Math.min(bottom, p.a[1] - p.r, p.b[1] - p.r); top = Math.max(top, p.a[1] + p.r, p.b[1] + p.r); }
  const centerY = Number.isFinite(bottom) ? (bottom + top) / 2 : 0;
  let radius = 0;
  for (const p of rig) for (const endpoint of [p.a, p.b]) radius = Math.max(radius, Math.hypot(endpoint[0], endpoint[1] - centerY, endpoint[2]) + p.r);
  const bounds = { centerY, radius }; boundsCache.set(rig, bounds); return bounds;
}
