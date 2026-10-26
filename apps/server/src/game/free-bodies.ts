import { CHUNK_SIZE, ENTITY_INTEREST_RADIUS_CHUNKS, type BodiesMessage } from '@zion/shared';
import {
  DYNAMIC_BODY_TAG, Layer, dynamicBodyOwner, isDynamicBodyTag, makeBox, makeCapsule, makeSphere, poseTransform, proxyBounds, quatToBasis,
  type BodyPose, type CollisionWorld, type ColliderInit, type JoltVehicles, type RigidBodyDef,
} from '@zion/physics';

/**
 * Free rigid bodies on the server: knocked props simulated by Jolt (in the same Jolt system as the
 * vehicles, so cars shove them by mass and speed). The server is authoritative; clients only play
 * back the poses it sends.
 *
 * - Each body also stands in the CollisionWorld as its proxy parts (layer Dynamic), so shots, blasts
 *   and sight lines meet it where it actually lies.
 * - Walkers push it aside with a soft contact (their 80 kg against its mass) instead of being stopped.
 * - Poses go out at 15 Hz for awake bodies only, once more when a body falls asleep, and in full to
 *   a joining player: sleeping bodies cost no bandwidth.
 */
const PLAYER_MASS = 80;
/** Horizontal reach of a walker's body for pushing (m). */
const WALKER_RADIUS = .35;
/** Interest radius for body poses: the same as entity snapshots. */
const VIEW = ENTITY_INTEREST_RADIUS_CHUNKS * CHUNK_SIZE;
/** Bullet momentum is scaled up this much: real rounds barely move a barrel, which reads as a bug. */
const SHOT_PUSH = 2.5;

export interface Walker { x: number; y: number; z: number; vx: number; vz: number }
export interface Viewer { x: number; z: number; send(text: string): void }

interface Free {
  asset: number;
  scale: number;
  def: RigidBodyDef;
  /** Horizontal reach of the proxy from its origin, and its height. */
  reach: number;
  height: number;
  /** Local centre of the proxy bounds (impulse aim point). */
  centre: [number, number, number];
  awake: boolean;
}

export class FreeBodies {
  private readonly live = new Map<number, Free>();
  private nextId = 1;
  private readonly gone: number[] = [];
  /** Bodies that changed since the last sync (woke, moved or fell asleep). */
  private readonly dirty = new Set<number>();
  /** Raycasts / shot impulses / pushes this second, for the physics profile. */
  readonly counters = { shots: 0, pushes: 0, blasts: 0 };

  constructor(private readonly sim: () => JoltVehicles, private readonly world: CollisionWorld) {}

  get count(): number { return this.live.size; }

  /** A new body at `pose`; null when the solver budget is spent (the caller falls back to cosmetic debris). */
  spawn(asset: number, scale: number, def: RigidBodyDef, pose: BodyPose, v: readonly number[] = [0, 0, 0], w: readonly number[] = [0, 0, 0]): number | null {
    const id = this.nextId++;
    if (this.nextId >= DYNAMIC_BODY_TAG) this.nextId = 1;
    if (!this.sim().addBody(id, def, pose, v, w)) return null;
    const b = proxyBounds(def.parts);
    this.live.set(id, {
      asset, scale, def, awake: true,
      reach: Math.max(Math.hypot(b.minX, b.minZ), Math.hypot(b.maxX, b.maxZ), Math.hypot(b.minX, b.maxZ), Math.hypot(b.maxX, b.minZ)),
      height: b.maxY - b.minY, centre: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2],
    });
    this.place(id);
    this.dirty.add(id);
    return id;
  }

  remove(id: number): void {
    if (!this.live.delete(id)) return;
    this.sim().removeBody(id);
    this.world.removeOwnerColliders(dynamicBodyOwner(id));
    this.dirty.delete(id);
    this.gone.push(id);
  }

  has(id: number): boolean { return this.live.has(id); }
  pose(id: number): BodyPose | null { return this.sim().bodyState(id)?.pose ?? null; }

  /** A round struck the body at (x, y, z) flying along unit (dx, dy, dz). */
  shot(tag: number, x: number, y: number, z: number, dx: number, dy: number, dz: number, damage: number): boolean {
    if (!isDynamicBodyTag(tag)) return false;
    const id = tag - DYNAMIC_BODY_TAG;
    if (!this.live.has(id)) return false;
    // Momentum of a rifle round is about 0.01 kg × 700 m/s; damage stands in for calibre.
    const j = (2 + damage * .08) * SHOT_PUSH;
    this.sim().applyImpulse(id, dx * j, dy * j, dz * j, x, y, z);
    this.counters.shots++;
    this.dirty.add(id);
    return true;
  }

  /** A blast at (x, y, z): every body in reach is thrown outward, off its centre (so it tumbles). */
  blast(x: number, y: number, z: number, radius: number): void {
    const reach = radius * 1.4;
    for (const [id, f] of this.live) {
      const p = this.pose(id);
      if (!p) continue;
      const [cx, cy, cz] = poseTransform(p, ...f.centre), d = Math.hypot(cx - x, cy - y, cz - z);
      if (d > reach) continue;
      const k = 1 - d / reach, n = d || 1, mass = this.sim().bodyMass(id);
      // Velocity change like the old cosmetic throw (3–15 m/s), now as an impulse on the real mass.
      const dv = 3 + 12 * k, ux = (cx - x) / n, uz = (cz - z) / n, uy = Math.max(.35, (cy - y) / n + .4);
      this.sim().applyImpulse(id, ux * dv * mass, uy * dv * mass, uz * dv * mass, cx - ux * .15, cy - f.height * .2, cz - uz * .15);
      this.counters.blasts++;
      this.dirty.add(id);
    }
  }

  /**
   * Walkers push bodies they walk into: the contact drives the body's velocity along the contact
   * normal towards the walker's (a light cone flies off, a drum rolls away slowly), applied at hip
   * height so tall things tip over.
   */
  push(walkers: Iterable<Walker>, dt: number): void {
    if (!this.live.size) return;
    for (const w of walkers) {
      for (const [id, f] of this.live) {
        const state = this.sim().bodyState(id);
        if (!state) continue;
        const p = state.pose, [cx, cy, cz] = poseTransform(p, ...f.centre);
        const dx = cx - w.x, dz = cz - w.z, d = Math.hypot(dx, dz), touch = f.reach * .8 + WALKER_RADIUS;
        if (d >= touch || cy + f.height / 2 < w.y || cy - f.height / 2 > w.y + 1.8) continue;
        const nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0;
        const closing = (w.vx * nx + w.vz * nz) - (state.v[0] * nx + state.v[2] * nz);
        const overlap = touch - d;
        if (closing <= 0 && overlap < .05) continue;
        const mass = this.sim().bodyMass(id), reduced = mass * PLAYER_MASS / (mass + PLAYER_MASS);
        const j = Math.max(0, closing) * reduced + overlap * 600 * dt;
        const hy = Math.min(cy + f.height / 2, w.y + 1);
        this.sim().applyImpulse(id, nx * j, 0, nz * j, cx - nx * f.reach * .5, hy, cz - nz * f.reach * .5);
        this.counters.pushes++;
        this.dirty.add(id);
      }
    }
  }

  /** After the physics step: refresh colliders of moving bodies and send poses to whoever sees them. */
  sync(now: number, send: boolean, viewers: Iterable<Viewer>): void {
    for (const [id, f] of this.live) {
      const awake = this.sim().bodyState(id)?.awake ?? false;
      if (awake || f.awake) { this.place(id); this.dirty.add(id); }
      f.awake = awake;
    }
    if (!send || (!this.dirty.size && !this.gone.length)) return;
    const rows = new Map<number, BodiesMessage['list'][number]>();
    for (const id of this.dirty) { const row = this.row(id); if (row) rows.set(id, row); }
    const gone = this.gone.splice(0);
    for (const v of viewers) {
      const list = [...rows.values()].filter((r) => Math.hypot(r[3] - v.x, r[5] - v.z) < VIEW);
      if (!list.length && !gone.length) continue;
      v.send(JSON.stringify({ t: 'bodies', at: Math.round(now), list, ...(gone.length ? { gone } : {}) } satisfies BodiesMessage));
    }
    this.dirty.clear();
  }

  /** Every body (a joining player). */
  message(now: number): BodiesMessage {
    return { t: 'bodies', at: Math.round(now), list: [...this.live.keys()].map((id) => this.row(id)!).filter(Boolean), full: true };
  }

  /** Jolt and solver figures for the profile log. */
  profile(): { bodies: number; awake: number } {
    let awake = 0;
    for (const f of this.live.values()) if (f.awake) awake++;
    return { bodies: this.live.size, awake };
  }

  private row(id: number): BodiesMessage['list'][number] | null {
    const f = this.live.get(id), s = this.sim().bodyState(id);
    if (!f || !s) return null;
    const p = s.pose, mm = (v: number) => Math.round(v * 1000) / 1000, q = (v: number) => Math.round(v * 10000) / 10000;
    return [id, f.asset, f.scale, mm(p.x), mm(p.y), mm(p.z), q(p.qx), q(p.qy), q(p.qz), q(p.qw), s.awake ? 0 : 1];
  }

  /** The body's proxy parts at its current pose, as CollisionWorld colliders. */
  private place(id: number): void {
    const f = this.live.get(id), p = this.pose(id);
    if (!f || !p) return;
    const basis = quatToBasis(p.qx, p.qy, p.qz, p.qw), tag = DYNAMIC_BODY_TAG + id;
    const colliders: ColliderInit[] = f.def.parts.map((part) => {
      if (part.type === 'sphere') { const [x, y, z] = poseTransform(p, part.cx, part.cy, part.cz); return { shape: makeSphere(x, y, z, part.r), layer: Layer.Dynamic, tag }; }
      if (part.type === 'capsule') {
        const a = poseTransform(p, part.ax, part.ay, part.az), b = poseTransform(p, part.bx, part.by, part.bz);
        return { shape: makeCapsule(a[0], a[1], a[2], b[0], b[1], b[2], part.r), layer: Layer.Dynamic, tag };
      }
      const [x, y, z] = poseTransform(p, part.cx, part.cy, part.cz);
      const shape = part.type === 'box' ? makeBox(x, y, z, part.hx, part.hy, part.hz) : makeBox(x, y, z, part.r, part.hh, part.r);
      // Part yaw inside the body, then the body's rotation.
      const yaw = part.type === 'box' ? part.yaw : 0, c = Math.cos(yaw), s = Math.sin(yaw);
      const local = [c, 0, -s, 0, 1, 0, s, 0, c];
      shape.basis = [0, 1, 2].flatMap((col) => [0, 1, 2].map((row) => basis[row]! * local[col * 3]! + basis[3 + row]! * local[col * 3 + 1]! + basis[6 + row]! * local[col * 3 + 2]!));
      return { shape, layer: Layer.Dynamic, tag };
    });
    this.world.setOwnerColliders(dynamicBodyOwner(id), colliders);
  }
}
