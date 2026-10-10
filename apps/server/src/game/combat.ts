import { MAX_LAG_COMPENSATION_MS } from '@zion/shared';
import {
  DEFAULT_CHARACTER,
  rigBounds,
  Mask,
  ZONE_DAMAGE_MULTIPLIER,
  makeRayHit,
  raycastRig,
  type CollisionWorld,
  type HitZone,
  type RigPart,
} from '@zion/physics';
import type { PoseHistory, PoseSample, Player } from './player';

export const MELEE = {
  range: 2.1,
  cooldownMs: 650,
  baseDamage: 12,
  /** Visual "attacking" flag duration. */
  swingMs: 300,
} as const;

export interface MeleeResult {
  target: Combatant;
  zone: HitZone;
  damage: number;
  x: number;
  y: number;
  z: number;
  rewoundMs: number;
}

/** Aim direction from yaw/pitch (three.js camera convention: yaw 0 looks −Z, +pitch looks up). */
export function aimDirection(yaw: number, pitch: number): [number, number, number] {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

const pose: PoseSample = { t: 0, x: 0, y: 0, z: 0, yaw: 0 };
const losHit = makeRayHit();

/** Anything that can be shot: players and zombies. */
export interface Combatant {
  readonly history: PoseHistory;
  readonly dead: boolean;
  readonly active: boolean;
  readonly rig: readonly RigPart[];
}

export interface RayResult<T extends Combatant = Player> {
  target: T | null;
  zone: HitZone | null;
  /** Distance to the hit (or to whatever blocked the ray, or the full range). */
  t: number;
  rewoundMs: number;
}

/**
 * Lag-compensated ray against player hitboxes, occluded by world geometry:
 *  - origin and direction come from the server's own state (the client cannot claim a hit),
 *  - targets are rewound to the client's render time, bounded by MAX_LAG_COMPENSATION_MS,
 *  - the ray is tested against per-body-part hitboxes, then against world geometry.
 */
export function castCombatRay<T extends Combatant>(
  attacker: Combatant,
  candidates: readonly T[],
  collision: CollisionWorld,
  nowMs: number,
  clientRenderTime: number | undefined,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  range: number,
): RayResult<T> {
  const rewindTo =
    clientRenderTime === undefined
      ? nowMs
      : Math.min(nowMs, Math.max(nowMs - MAX_LAG_COMPENSATION_MS, clientRenderTime));
  let best: { target: T; t: number; zone: HitZone } | null = null;
  for (const target of candidates) {
    if ((target as Combatant) === attacker || target.dead || !target.active) continue;
    if (!target.history.sample(rewindTo, pose)) continue;
    // Broad phase: distance from the ray to the bounding sphere around the rewound pose.
    const cx = pose.x - ox;
    const bounds = rigBounds(target.rig);
    const cy = pose.y + bounds.centerY - oy;
    const cz = pose.z - oz;
    const along = cx * dx + cy * dy + cz * dz;
    const br = bounds.radius;
    if (along < -br || along > range + br) continue;
    const perp2 = cx * cx + cy * cy + cz * cz - along * along;
    if (perp2 > br * br) continue;
    const hit = raycastRig(target.rig, pose.x, pose.y, pose.z, pose.yaw, ox, oy, oz, dx, dy, dz, range);
    if (hit && (!best || hit.t < best.t)) best = { target, t: hit.t, zone: hit.zone };
  }
  const limit = best ? best.t : range;
  if (collision.raycast(ox, oy, oz, dx, dy, dz, limit, Mask.LineOfSight, losHit)) {
    return { target: null, zone: null, t: losHit.t, rewoundMs: nowMs - rewindTo };
  }
  return { target: best?.target ?? null, zone: best?.zone ?? null, t: limit, rewoundMs: nowMs - rewindTo };
}

/** Server-authoritative melee: a short combat ray from the eyes along the aim. */
export function resolveMelee(
  attacker: Player,
  candidates: readonly Combatant[],
  collision: CollisionWorld,
  nowMs: number,
  clientRenderTime: number | undefined,
  weapon: { range: number; damage: number; arc?: number } = { range: MELEE.range, damage: MELEE.baseDamage },
): MeleeResult | null {
  const s = attacker.state;
  const ox = s.x;
  const oy = s.y + DEFAULT_CHARACTER.eyeHeight;
  const oz = s.z;
  // Blades sweep: a fan of rays across the swing arc, the closest hit wins.
  const arc = weapon.arc ?? 0;
  let r: RayResult<Combatant> | null = null;
  let dx = 0;
  let dy = 0;
  let dz = 0;
  for (const off of arc > 0 ? [0, -arc, arc, -arc / 2, arc / 2] : [0]) {
    const d = aimDirection(attacker.yaw + off, attacker.pitch);
    const hit = castCombatRay(attacker, candidates, collision, nowMs, clientRenderTime, ox, oy, oz, d[0], d[1], d[2], weapon.range);
    if (hit.target && (!r?.target || hit.t < r.t)) {
      r = hit;
      [dx, dy, dz] = d;
    }
  }
  if (!r?.target || !r.zone) return null;
  return {
    target: r.target,
    zone: r.zone,
    damage: Math.round(weapon.damage * ZONE_DAMAGE_MULTIPLIER[r.zone]),
    x: ox + dx * r.t,
    y: oy + dy * r.t,
    z: oz + dz * r.t,
    rewoundMs: r.rewoundMs,
  };
}

/**
 * Blade swing: the nearest enemy standing in front of the attacker (a wide frontal wedge within
 * reach), regardless of where the cursor or barrel pitch points. Targets are lag-compensated
 * like rays, and walls between attacker and target block the cut.
 */
export function resolveBladeSweep(
  attacker: Player,
  candidates: readonly Combatant[],
  collision: CollisionWorld,
  nowMs: number,
  clientRenderTime: number | undefined,
  weapon: { range: number; damage: number; halfAngle: number },
): MeleeResult | null {
  const rewindTo =
    clientRenderTime === undefined ? nowMs : Math.min(nowMs, Math.max(nowMs - MAX_LAG_COMPENSATION_MS, clientRenderTime));
  const s = attacker.state;
  const fx = -Math.sin(attacker.yaw);
  const fz = -Math.cos(attacker.yaw);
  const cosLimit = Math.cos(weapon.halfAngle);
  let best: { target: Combatant; d: number; x: number; y: number; z: number } | null = null;
  for (const target of candidates) {
    if (target === attacker || target.dead || !target.active) continue;
    if (!target.history.sample(rewindTo, pose)) continue;
    const dx = pose.x - s.x;
    const dz = pose.z - s.z;
    const dist = Math.hypot(dx, dz);
    // Reach is measured to the target's body surface, so big bodies are as easy to hit as small.
    if (dist - 0.4 > weapon.range || Math.abs(pose.y - s.y) > 1.6) continue;
    // Point-blank always counts; otherwise it must be inside the frontal wedge.
    if (dist > 0.6 && (dx * fx + dz * fz) / dist < cosLimit) continue;
    if (best && dist >= best.d) continue;
    const ty = pose.y + 1;
    const oy = s.y + 1.1;
    const l = Math.hypot(dx, ty - oy, dz) || 1;
    if (collision.raycast(s.x, oy, s.z, dx / l, (ty - oy) / l, dz / l, Math.max(0, l - 0.4), Mask.LineOfSight, losHit)) continue;
    best = { target, d: dist, x: pose.x - (dx / (dist || 1)) * 0.3, y: ty, z: pose.z - (dz / (dist || 1)) * 0.3 };
  }
  if (!best) return null;
  return { target: best.target, zone: 'torso', damage: Math.round(weapon.damage), x: best.x, y: best.y, z: best.z, rewoundMs: nowMs - rewindTo };
}

/** Random direction inside a cone of half-angle `spread` around (dx,dy,dz). */
export function spreadDirection(dx: number, dy: number, dz: number, spread: number, rand: () => number): [number, number, number] {
  if (spread <= 0) return [dx, dy, dz];
  // Orthonormal basis around the aim.
  let ux = 0;
  let uy = 1;
  const uz = 0;
  if (Math.abs(dy) > 0.9) {
    ux = 1;
    uy = 0;
  }
  let rx = uy * dz - uz * dy;
  let ry = uz * dx - ux * dz;
  let rz = ux * dy - uy * dx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const vx = dy * rz - dz * ry;
  const vy = dz * rx - dx * rz;
  const vz = dx * ry - dy * rx;
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(rand()) * Math.tan(spread);
  const ox = dx + (rx * Math.cos(a) + vx * Math.sin(a)) * r;
  const oy = dy + (ry * Math.cos(a) + vy * Math.sin(a)) * r;
  const oz = dz + (rz * Math.cos(a) + vz * Math.sin(a)) * r;
  const l = Math.hypot(ox, oy, oz) || 1;
  return [ox / l, oy / l, oz / l];
}
