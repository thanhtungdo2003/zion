import { GRENADE_GRAVITY, type C4Pose } from '@zion/shared';
import { Mask, makeRayHit, raycastRig, type CollisionWorld, type ProjectileState, type RigPart } from '@zion/physics';
import { Player } from './player';

export interface StickyTarget {
  state: { x: number; y: number; z: number };
  yaw: number;
  active: boolean;
  dead: boolean;
  rig: readonly RigPart[];
}

/** One bomb and the inventory UID of its remote; all collision and attachment are authoritative. */
export class C4Charge {
  nx = 0; ny = 1; nz = 0;
  private attachment: { target: StickyTarget; x: number; y: number; z: number; nx: number; nz: number } | null = null;
  constructor(readonly id: number, readonly accountId: string, readonly itemUid: number, readonly s: ProjectileState) {}

  step(world: CollisionWorld, targets: readonly StickyTarget[], dt: number): void {
    if (this.attachment) {
      const a = this.attachment, t = a.target;
      if (!t.active || t.dead) { this.attachment = null; return; }
      const c = Math.cos(t.yaw), sin = Math.sin(t.yaw);
      this.s.x = t.state.x + a.x * c + a.z * sin;
      this.s.y = t.state.y + a.y;
      this.s.z = t.state.z - a.x * sin + a.z * c;
      this.nx = a.nx * c + a.nz * sin;
      this.nz = -a.nx * sin + a.nz * c;
      return;
    }
    const s = this.s;
    if (s.resting || !world.isAreaLoaded(s.x - 1, s.z - 1, s.x + 1, s.z + 1)) return;
    s.vy -= GRENADE_GRAVITY * dt;
    const speed = Math.hypot(s.vx, s.vy, s.vz);
    if (speed < 1e-6) return;
    const dx = s.vx / speed, dy = s.vy / speed, dz = s.vz / speed;
    const distance = speed * dt;
    const hit = makeRayHit();
    let nearest = distance + .06;
    let contacted = false, target: StickyTarget | null = null;
    if (world.raycast(s.x, s.y, s.z, dx, dy, dz, nearest, Mask.LineOfSight, hit)) {
      nearest = hit.t; contacted = true;
      this.nx = hit.nx; this.ny = hit.ny; this.nz = hit.nz;
    }
    for (const mob of targets) {
      // Players must never become attachment targets, including the thrower and teammates.
      if (mob instanceof Player || !mob.active || mob.dead) continue;
      const body = raycastRig(mob.rig, mob.state.x, mob.state.y, mob.state.z, mob.yaw, s.x, s.y, s.z, dx, dy, dz, nearest);
      if (!body) continue;
      nearest = body.t; contacted = true; target = mob;
      this.nx = -dx; this.ny = -dy; this.nz = -dz;
    }
    const travel = contacted ? Math.max(0, nearest - .06) : distance;
    s.x += dx * travel; s.y += dy * travel; s.z += dz * travel;
    if (!contacted) return;
    s.vx = s.vy = s.vz = 0; s.resting = true;
    if (target) {
      const c = Math.cos(target.yaw), sin = Math.sin(target.yaw);
      const x = s.x - target.state.x, z = s.z - target.state.z;
      this.attachment = { target, x: x * c - z * sin, y: s.y - target.state.y, z: x * sin + z * c,
        nx: this.nx * c - this.nz * sin, nz: this.nx * sin + this.nz * c };
    }
  }

  pose(): C4Pose { return { id: this.id, x: this.s.x, y: this.s.y, z: this.s.z, nx: this.nx, ny: this.ny, nz: this.nz, stuck: this.s.resting }; }
}
