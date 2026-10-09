import { wrapAngle } from '@zion/shared';

/**
 * "AI mob": a small behaviour brain for human NPCs (camp guards). It never touches physics or
 * combat itself; each tick it turns what the NPC perceives into a movement intent (local
 * strafe/forward axes for the CharacterController) and a smoothly turned look yaw. Because the
 * client avatar lets the head follow the yaw up to its limit before rotating the body, gradual
 * yaw changes read as the NPC glancing around and then turning its whole body.
 *
 *  - idle:    stand still and glance around the home facing.
 *  - patrol:  stroll to a random point inside the home area, facing the way it walks.
 *  - engage:  a target is in sight — turn to face it and hold position.
 *  - retreat: a threat is too close — keep facing it and walk backwards away from it.
 */
export type MobMode = 'idle' | 'patrol' | 'engage' | 'retreat';

export interface MobHome {
  x: number;
  z: number;
  /** Yaw the NPC faces when on watch. */
  yaw: number;
  /** Radius of the patrol area around home. */
  radius: number;
  /** Furthest a retreat may take the NPC from home. */
  leash: number;
}

export interface MobPerception {
  x: number;
  z: number;
  /** Visible target to face (e.g. a zombie in line of sight). */
  target: { x: number; z: number } | null;
  /** Nearest threat regardless of sight, with its distance. */
  threat: { x: number; z: number; distance: number } | null;
}

export interface MobIntent {
  mx: number;
  mz: number;
  yaw: number;
  /** True when the current yaw is close enough to the target to fire. */
  aimed: boolean;
}

/** Threats closer than this make the NPC back away. */
export const RETREAT_DISTANCE = 7;
/** Stop backing off once the threat is this far away (hysteresis). */
const RETREAT_CLEAR = 9;
const TURN_RATE_CALM = 2.6;
const TURN_RATE_ALERT = 9;
const AIM_TOLERANCE = 0.2;
const ARRIVE_DISTANCE = 0.6;
const STUCK_MS = 2500;

export class MobBrain {
  mode: MobMode = 'idle';
  yaw: number;
  private lookYaw: number;
  private decideAt = -1;
  private goalX = 0;
  private goalZ = 0;
  private lastX = 0;
  private lastZ = 0;
  private progressAt = 0;

  constructor(readonly home: MobHome, private readonly random: () => number = Math.random) {
    this.yaw = home.yaw;
    this.lookYaw = home.yaw;
  }

  think(p: MobPerception, now: number, dt: number): MobIntent {
    if (this.decideAt < 0) this.decideAt = now + 1500 + this.random() * 2500;
    const h = this.home;

    if (p.threat && (p.threat.distance < RETREAT_DISTANCE
      || (this.mode === 'retreat' && p.threat.distance < RETREAT_CLEAR))) {
      this.mode = 'retreat';
      const face = Math.atan2(-(p.threat.x - p.x), -(p.threat.z - p.z));
      this.turnTowards(face, TURN_RATE_ALERT, dt);
      // Away from the threat, pulled back towards home so the NPC doesn't drift off.
      let wx = p.x - p.threat.x, wz = p.z - p.threat.z;
      const wl = Math.hypot(wx, wz) || 1;
      wx /= wl; wz /= wl;
      const hx = h.x - p.x, hz = h.z - p.z;
      const hd = Math.hypot(hx, hz);
      if (hd > h.leash * 0.5) {
        const pull = Math.min(1, (hd - h.leash * 0.5) / (h.leash * 0.5));
        wx += (hx / hd) * pull; wz += (hz / hd) * pull;
      }
      const atLeash = hd >= h.leash && (wx * hx + wz * hz) < 0;
      const aim = p.target ?? p.threat;
      const aimed = Math.abs(wrapAngle(Math.atan2(-(aim.x - p.x), -(aim.z - p.z)) - this.yaw)) < AIM_TOLERANCE;
      if (atLeash) return { mx: 0, mz: 0, yaw: this.yaw, aimed };
      return { ...this.toLocal(wx, wz), yaw: this.yaw, aimed };
    }

    if (p.target) {
      this.mode = 'engage';
      const face = Math.atan2(-(p.target.x - p.x), -(p.target.z - p.z));
      this.turnTowards(face, TURN_RATE_ALERT, dt);
      this.decideAt = now + 2000;
      return { mx: 0, mz: 0, yaw: this.yaw, aimed: Math.abs(wrapAngle(face - this.yaw)) < AIM_TOLERANCE };
    }

    if (this.mode === 'engage' || this.mode === 'retreat') {
      // Threat gone: walk back into the home area.
      this.startPatrol(now, true);
    }

    if (this.mode === 'patrol') {
      const dx = this.goalX - p.x, dz = this.goalZ - p.z;
      const d = Math.hypot(dx, dz);
      if (Math.hypot(p.x - this.lastX, p.z - this.lastZ) > 0.3) {
        this.lastX = p.x; this.lastZ = p.z; this.progressAt = now;
      }
      if (d < ARRIVE_DISTANCE || now - this.progressAt > STUCK_MS) {
        this.mode = 'idle';
        this.lookYaw = h.yaw;
        this.decideAt = now + 2000 + this.random() * 3000;
      } else {
        const face = Math.atan2(-dx, -dz);
        this.turnTowards(face, TURN_RATE_CALM * 1.5, dt);
        // Only step off once roughly facing the way to go.
        if (Math.abs(wrapAngle(face - this.yaw)) > 0.6) return { mx: 0, mz: 0, yaw: this.yaw, aimed: false };
        return { ...this.toLocal(dx / d, dz / d), yaw: this.yaw, aimed: false };
      }
    }

    // idle: glance around the watch direction, sometimes wander off on a short patrol.
    if (now >= this.decideAt) {
      if (this.random() < 0.35) this.startPatrol(now, false);
      else {
        this.lookYaw = h.yaw + (this.random() * 2 - 1) * 1.7;
        this.decideAt = now + 1500 + this.random() * 3000;
      }
    }
    this.turnTowards(this.lookYaw, TURN_RATE_CALM, dt);
    return { mx: 0, mz: 0, yaw: this.yaw, aimed: false };
  }

  private startPatrol(now: number, home: boolean): void {
    const a = this.random() * Math.PI * 2;
    const r = home ? this.random() * 1.5 : 1.5 + this.random() * (this.home.radius - 1.5);
    this.goalX = this.home.x + Math.sin(a) * r;
    this.goalZ = this.home.z + Math.cos(a) * r;
    this.mode = 'patrol';
    this.progressAt = now;
    this.lastX = Infinity;
  }

  private turnTowards(target: number, rate: number, dt: number): void {
    const diff = wrapAngle(target - this.yaw);
    if (diff === 0) return;
    const max = rate * dt;
    this.yaw = wrapAngle(this.yaw + Math.max(-max, Math.min(max, diff)));
  }

  /** World direction → controller axes for the current yaw (the rotation is its own inverse). */
  private toLocal(wx: number, wz: number): { mx: number; mz: number } {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return { mx: c * wx - s * wz, mz: -s * wx - c * wz };
  }
}
