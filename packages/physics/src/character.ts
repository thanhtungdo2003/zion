import { Layer, Mask } from './layers';
import { makeContact, type Contact } from './shapes';
import type { CollisionWorld } from './world';

export interface CharacterParams {
  radius: number;
  height: number;
  eyeHeight: number;
  walkSpeed: number;
  sprintSpeed: number;
  backwardFactor: number;
  swimSpeed: number;
  swimSprintSpeed: number;
  gravity: number;
  jumpVelocity: number;
  maxFallSpeed: number;
  groundAccel: number;
  airAccel: number;
  waterAccel: number;
  /** Minimum contact normal Y that counts as walkable ground (cos of max slope angle). */
  walkableNormalY: number;
  stepHeight: number;
  snapDistance: number;
  /** Water depth above the feet at which the character starts swimming. */
  swimDepth: number;
  /** Feet depth below the surface while floating. */
  swimFloatDepth: number;
  /** Water depth above the feet at which movement is slowed (wading). */
  wadeDepth: number;
  /** World-border margin in metres. */
  boundsMargin: number;
  /** Dodge roll: ground speed, duration and cooldown after it ends (seconds). */
  rollSpeed: number;
  rollDuration: number;
  rollCooldown: number;
  /** Climbing speed on ladders (m/s). */
  climbSpeed: number;
  /** Collider tags (asset ids) that can be climbed. */
  ladderTags: readonly number[];
}

export const DEFAULT_CHARACTER: Readonly<CharacterParams> = Object.freeze({
  radius: 0.35,
  height: 1.8,
  eyeHeight: 1.62,
  walkSpeed: 3.4,
  sprintSpeed: 6.2,
  backwardFactor: 0.65,
  swimSpeed: 2.0,
  swimSprintSpeed: 3.2,
  gravity: 22,
  jumpVelocity: 6.8,
  maxFallSpeed: 55,
  groundAccel: 45,
  airAccel: 7,
  waterAccel: 10,
  walkableNormalY: 0.7, // ~45.6°
  stepHeight: 0.45,
  snapDistance: 0.4,
  swimDepth: 1.3,
  swimFloatDepth: 1.35,
  wadeDepth: 0.55,
  boundsMargin: 2,
  rollSpeed: 7.5,
  rollDuration: 0.8,
  rollCooldown: 3,
  climbSpeed: 2.4,
  // Camp asset 2022 (rusty iron wall ladder).
  ladderTags: [2022],
});

export interface CharacterState {
  prone: boolean;
  /** Feet position. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  swimming: boolean;
  /** Consecutive ticks in which the controller had to revert an invalid (penetrating) move. */
  stuckTicks: number;
  /** Remaining ticks of an active dodge roll (0 = not rolling). */
  rollTicks: number;
  /** Ticks until another roll may start. */
  rollCooldown: number;
  /** Direction of the active roll (same convention as yaw). */
  rollYaw: number;
  /** On a ladder this tick (derived each step from contacts; drives the climb animation). */
  climbing: boolean;
}

export interface CharacterInput {
  /** Strafe axis −1..1. */
  mx: number;
  /** Forward axis −1..1. */
  mz: number;
  yaw: number;
  jump: boolean;
  sprint: boolean;
  roll?: boolean;
  prone?: boolean;
  /** Movement speed multiplier (armour and held weapon); 1 when omitted. */
  speedMul?: number;
}

export interface StepInfo {
  /** Terrain around the character is not loaded; nothing was simulated. */
  frozen: boolean;
  hitWall: boolean;
  jumped: boolean;
  steppedUp: boolean;
  /** The move ended in penetration and was rolled back. */
  reverted: boolean;
}

export function createCharacterState(x: number, y: number, z: number): CharacterState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, grounded: false, swimming: false, stuckTicks: 0, rollTicks: 0, rollCooldown: 0, rollYaw: 0, climbing: false, prone: false };
}

export const PRONE_HEIGHT = 0.7;
export const PRONE_EYE_HEIGHT = 0.45;
export const PRONE_SPEED = 1.15;
export function characterEyeHeight(state: Pick<CharacterState, 'prone'>): number {
  return state.prone ? PRONE_EYE_HEIGHT : DEFAULT_CHARACTER.eyeHeight;
}

export function copyCharacterState(src: CharacterState, dst: CharacterState): CharacterState {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
  dst.vx = src.vx;
  dst.vy = src.vy;
  dst.vz = src.vz;
  dst.grounded = src.grounded;
  dst.swimming = src.swimming;
  dst.stuckTicks = src.stuckTicks;
  dst.rollTicks = src.rollTicks;
  dst.rollCooldown = src.rollCooldown;
  dst.rollYaw = src.rollYaw;
  dst.climbing = src.climbing;
  dst.prone = src.prone;
  return dst;
}

const MAX_SUBSTEPS = 24;
const RESOLVE_ITERATIONS = 4;
const STUCK_TOLERANCE = 0.06;

/**
 * Kinematic capsule character controller (collide-and-slide with depenetration, step-up,
 * ground snapping, slope limit and swimming). Fully deterministic for a given world + input
 * sequence: the server runs it authoritatively; the client runs the very same code for prediction.
 */
export class CharacterController {
  private readonly contacts: Contact[] = Array.from({ length: 64 }, makeContact);
  private readonly start = createCharacterState(0, 0, 0);
  private readonly alt = createCharacterState(0, 0, 0);
  private readonly scratchInfo: StepInfo = blankInfo();
  readonly mask: number = Mask.CharacterMovement;

  constructor(
    readonly world: CollisionWorld,
    readonly params: Readonly<CharacterParams> = DEFAULT_CHARACTER,
  ) {}

  /** Is the area needed to simulate a character at (x, z) loaded? */
  canSimulateAt(x: number, z: number): boolean {
    const m = this.params.radius + 1.5;
    return this.world.isAreaLoaded(x - m, z - m, x + m, z + m);
  }

  step(s: CharacterState, input: CharacterInput, dt: number, info: StepInfo = blankInfo()): StepInfo {
    resetInfo(info);
    const p = this.params;
    const w = this.world;
    if (!this.canSimulateAt(s.x, s.z)) {
      info.frozen = true;
      return info;
    }
    copyCharacterState(s, this.start);

    // --- Horizontal intent ------------------------------------------------------------------
    let mx = input.mx;
    let mz = input.mz;
    const len = Math.sqrt(mx * mx + mz * mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const sin = Math.sin(input.yaw);
    const cos = Math.cos(input.yaw);
    // forward = (−sin, 0, −cos), right = (cos, 0, −sin) — three.js camera convention.
    const wishX = cos * mx - sin * mz;
    const wishZ = -sin * mx - cos * mz;

    const water = w.waterLevel(s.x, s.z);
    const submersion = water - s.y;
    s.swimming = submersion > p.swimDepth;
    const wading = !s.swimming && submersion > p.wadeDepth;

    if (s.swimming || s.climbing) s.prone = false;
    else if (input.prone && !input.jump && s.grounded && s.rollTicks === 0) s.prone = true;
    else if ((!input.prone || input.jump) && s.prone && this.isFree(s.x, s.y, s.z)) s.prone = false;

    let speed = (s.swimming ? (input.sprint ? p.swimSprintSpeed : p.swimSpeed) : input.sprint && mz > 0.3 ? p.sprintSpeed : p.walkSpeed) * (input.speedMul ?? 1);
    if (s.prone) speed = PRONE_SPEED * (input.speedMul ?? 1);
    if (mz < 0) speed *= p.backwardFactor;
    if (wading) speed *= 0.7;
    const targetX = wishX * speed;
    const targetZ = wishZ * speed;

    // --- Dodge roll: commits to one direction at a fixed speed for its duration -------------
    if (s.rollTicks > 0) s.rollTicks--;
    else if (s.rollCooldown > 0) s.rollCooldown--;
    if (input.roll && !s.prone && s.rollTicks === 0 && s.rollCooldown === 0 && s.grounded && !s.swimming) {
      s.rollTicks = Math.max(1, Math.round(p.rollDuration / dt));
      s.rollCooldown = Math.round(p.rollCooldown / dt);
      // Roll where the player is steering; standing still rolls toward the facing direction.
      s.rollYaw = wishX * wishX + wishZ * wishZ > 0.01 ? Math.atan2(-wishX, -wishZ) : input.yaw;
    }
    const rolling = s.rollTicks > 0;

    if (rolling) {
      s.vx = -Math.sin(s.rollYaw) * p.rollSpeed;
      s.vz = -Math.cos(s.rollYaw) * p.rollSpeed;
    } else {
      const accel = s.swimming ? p.waterAccel : s.grounded ? p.groundAccel : p.airAccel;
      const dvx = targetX - s.vx;
      const dvz = targetZ - s.vz;
      const dvLen = Math.sqrt(dvx * dvx + dvz * dvz);
      const maxDv = accel * dt;
      if (dvLen <= maxDv) {
        s.vx = targetX;
        s.vz = targetZ;
      } else {
        s.vx += (dvx / dvLen) * maxDv;
        s.vz += (dvz / dvLen) * maxDv;
      }
    }

    // --- Ladders: push into one to climb, pull away from it (in the air) to climb down --------
    const ladder = !s.swimming && !rolling && !s.prone ? this.ladderNormal(s) : null;
    let climbing = false;
    if (ladder) {
      const into = -(wishX * ladder.nx + wishZ * ladder.nz);
      if (into > 0.3) { s.vy = p.climbSpeed; climbing = true; }
      else if (into < -0.3 && !s.grounded) { s.vy = -p.climbSpeed; climbing = true; }
      else if (!s.grounded && wishX * wishX + wishZ * wishZ < 0.01) { s.vy = 0; climbing = true; }
      if (climbing && input.jump) {
        // Kick off the ladder.
        s.vy = p.jumpVelocity * 0.5;
        s.vx = ladder.nx * 3;
        s.vz = ladder.nz * 3;
        climbing = false;
      } else if (climbing) {
        // Stay against the rungs.
        s.vx = -ladder.nx * 0.6;
        s.vz = -ladder.nz * 0.6;
      }
    }
    s.climbing = climbing;

    // --- Vertical ---------------------------------------------------------------------------
    if (climbing) {
      s.grounded = false;
    } else if (s.swimming) {
      const targetY = water - p.swimFloatDepth;
      const vy = (targetY - s.y) * 3;
      s.vy = vy < -2.5 ? -2.5 : vy > 2 ? 2 : vy;
      s.grounded = false;
    } else if (s.grounded && input.jump && !rolling && !s.prone) {
      s.vy = p.jumpVelocity;
      s.grounded = false;
      info.jumped = true;
    } else {
      s.vy -= p.gravity * dt;
      if (s.vy < -p.maxFallSpeed) s.vy = -p.maxFallSpeed;
    }

    const wasGrounded = this.start.grounded;
    const moveX = s.vx * dt;
    const moveZ = s.vz * dt;
    s.grounded = false;
    this.move(s, moveX, s.vy * dt, moveZ, info);

    // --- Step up small obstacles ------------------------------------------------------------
    if (info.hitWall && wasGrounded && !s.swimming && !s.prone && (moveX !== 0 || moveZ !== 0)) {
      if (this.tryStepUp(s, moveX, moveZ)) info.steppedUp = true;
    }

    // --- Stick to the ground when walking down slopes / steps --------------------------------
    if (wasGrounded && !info.jumped && !s.grounded && !s.swimming && s.vy <= 0) {
      const a = copyCharacterState(s, this.alt);
      a.grounded = false;
      this.move(a, 0, -p.snapDistance, 0, resetInfo(this.scratchInfo));
      if (a.grounded) {
        s.x = a.x;
        s.y = a.y;
        s.z = a.z;
        s.vy = 0;
        s.grounded = true;
      }
    }

    // --- Hard constraints -------------------------------------------------------------------
    // The heightfield is 2.5D: being below it is never valid (prevents terrain clipping).
    const ground = w.terrainHeight(s.x, s.z);
    if (ground === ground && s.y < ground) {
      s.y = ground;
      if (s.vy < 0) s.vy = 0;
    }
    const lo = p.boundsMargin;
    const hi = w.worldSize - p.boundsMargin;
    if (s.x < lo) {
      s.x = lo;
      s.vx = 0;
    } else if (s.x > hi) {
      s.x = hi;
      s.vx = 0;
    }
    if (s.z < lo) {
      s.z = lo;
      s.vz = 0;
    } else if (s.z > hi) {
      s.z = hi;
      s.vz = 0;
    }

    // --- Validate final pose; roll back rather than ever ending inside solid geometry ---------
    if (
      w.overlapsCapsule(
        s.x, s.y + p.radius, s.z,
        s.x, s.y + (s.prone ? Math.max(PRONE_HEIGHT, p.radius * 2) : p.height) - p.radius, s.z,
        p.radius, this.mask & ~Layer.Terrain, STUCK_TOLERANCE, this.contacts,
      )
    ) {
      const stuck = this.start.stuckTicks + 1;
      copyCharacterState(this.start, s);
      s.vx = 0;
      s.vz = 0;
      s.vy = Math.min(0, s.vy);
      s.stuckTicks = stuck;
      info.reverted = true;
    } else {
      s.stuckTicks = 0;
    }

    s.swimming = w.waterLevel(s.x, s.z) - s.y > p.swimDepth;
    return info;
  }

  /** Outward normal (XZ) of a climbable collider the character is touching, or null. */
  private ladderNormal(s: CharacterState): { nx: number; nz: number } | null {
    const p = this.params;
    if (!p.ladderTags.length) return null;
    const r = p.radius + 0.12;
    const n = this.world.capsuleContacts(s.x, s.y + r, s.z, s.x, s.y + p.height - r, s.z, r, Layer.Static, this.contacts);
    for (let i = 0; i < n; i++) {
      const c = this.contacts[i]!;
      if (!p.ladderTags.includes(c.tag) || Math.abs(c.ny) > 0.6) continue;
      const l = Math.hypot(c.nx, c.nz) || 1;
      return { nx: c.nx / l, nz: c.nz / l };
    }
    return null;
  }

  /** Is a character standing at (x,y,z) free of solid overlap? */
  isFree(x: number, y: number, z: number, tolerance = 0.01): boolean {
    const p = this.params;
    return !this.world.overlapsCapsule(
      x, y + p.radius, z,
      x, y + p.height - p.radius, z,
      p.radius, this.mask, tolerance, this.contacts,
    );
  }

  private move(s: CharacterState, dx: number, dy: number, dz: number, info: StepInfo): void {
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(len / (this.params.radius * 0.5))));
    const sx = dx / steps;
    const sy = dy / steps;
    const sz = dz / steps;
    for (let k = 0; k < steps; k++) {
      s.x += sx;
      s.y += sy;
      s.z += sz;
      this.resolve(s, info);
    }
  }

  private resolve(s: CharacterState, info: StepInfo): void {
    const p = this.params;
    const r = p.radius;
    for (let iter = 0; iter < RESOLVE_ITERATIONS; iter++) {
      const n = this.world.capsuleContacts(
        s.x, s.y + r, s.z,
        s.x, s.y + (s.prone ? Math.max(PRONE_HEIGHT, r * 2) : p.height) - r, s.z,
        r, this.mask, this.contacts,
      );
      if (n === 0) return;
      let best = this.contacts[0]!;
      for (let i = 1; i < n; i++) if (this.contacts[i]!.depth > best.depth) best = this.contacts[i]!;
      if (best.depth <= 1e-5) return;
      const { nx, ny, nz, depth } = best;
      if (ny >= p.walkableNormalY) {
        // Walkable ground: resolve vertically so the character never slides on slopes it can stand on.
        s.y += depth / ny;
        s.grounded = true;
        if (s.vy < 0) s.vy = 0;
      } else if (ny <= -p.walkableNormalY) {
        // Ceiling.
        s.x += nx * depth;
        s.y += ny * depth;
        s.z += nz * depth;
        if (s.vy > 0) s.vy = 0;
      } else {
        // Wall or too-steep slope: push out along the normal and slide.
        s.x += nx * depth;
        s.y += ny * depth;
        s.z += nz * depth;
        const vn = s.vx * nx + s.vy * ny + s.vz * nz;
        if (vn < 0) {
          s.vx -= nx * vn;
          s.vy -= ny * vn;
          s.vz -= nz * vn;
        }
        info.hitWall = true;
      }
    }
  }

  private tryStepUp(s: CharacterState, moveX: number, moveZ: number): boolean {
    const p = this.params;
    const start = this.start;
    const a = copyCharacterState(start, this.alt);
    a.vx = s.vx;
    a.vz = s.vz;
    a.y += p.stepHeight;
    if (!this.isFree(a.x, a.y, a.z, 0.001)) return false;
    const tmp = resetInfo(this.scratchInfo);
    // Probe at least ~one radius forward so the capsule's rounded bottom clears the ledge edge and
    // lands on its top face; otherwise slow approaches would only ever touch the edge's curve.
    const moveLen = Math.sqrt(moveX * moveX + moveZ * moveZ);
    const probe = Math.max(moveLen, p.radius * 0.9) / moveLen;
    this.move(a, moveX * probe, 0, moveZ * probe, tmp);
    a.grounded = false;
    this.move(a, 0, -(p.stepHeight + 0.05), 0, tmp);
    if (!a.grounded) return false;
    const progA = (a.x - start.x) * (a.x - start.x) + (a.z - start.z) * (a.z - start.z);
    const progS = (s.x - start.x) * (s.x - start.x) + (s.z - start.z) * (s.z - start.z);
    const rise = a.y - start.y;
    // Only a genuine step (a raise) may use the probed position; never a flat-ground shortcut.
    if (rise < 0.02 || rise > p.stepHeight + 0.01 || progA <= progS + 1e-4) return false;
    s.x = a.x;
    s.y = a.y;
    s.z = a.z;
    s.vx = a.vx;
    s.vz = a.vz;
    s.vy = 0;
    s.grounded = true;
    return true;
  }
}

function blankInfo(): StepInfo {
  return { frozen: false, hitWall: false, jumped: false, steppedUp: false, reverted: false };
}

function resetInfo(info: StepInfo): StepInfo {
  info.frozen = false;
  info.hitWall = false;
  info.jumped = false;
  info.steppedUp = false;
  info.reverted = false;
  return info;
}
