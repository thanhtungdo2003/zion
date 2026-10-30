import { TICK_DT, VEHICLES, VEHICLE_ROLES, advanceBallistic, triggerCountermeasure, useVehicleRound, vehiclePoint, type ServerJsonMessage, type VehicleState, type VehicleWeapon } from '@zion/shared';
import { ZONE_DAMAGE_MULTIPLIER, type CharacterState, type CollisionWorld } from '@zion/physics';
import { castCombatRay, spreadDirection, type Combatant } from './combat';
import type { Vehicles } from './vehicles';

/**
 * Vehicle weapons: tank guns, machine guns on mounts, rocket pods and anti-tank missiles, fired by
 * whoever sits in the seat that works them (a player's trigger or a bot gunner), with real ammo
 * (loads, spares, reloads) kept in the vehicle's state; and the countermeasures (V): flares that
 * pull missiles off a helicopter, a smoke screen that hides armour from sight and missiles.
 * The rounds fly on the server (a new projectile kind for each round type on the clients).
 */

type Target = Combatant & { id: number; state: CharacterState };

interface Round {
  id: number;
  shooter: Combatant & { id: number };
  vehicleId: number;
  w: VehicleWeapon;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  traveled: number;
  dieAt: number;
  /** Guided: the vehicle it homes on (0 = flies straight). */
  lock: number;
  /** Last time a guided round's new course went to the clients. */
  syncedAt: number;
}

export interface GunneryHooks {
  /** Everyone who can be hit near a point (players and bots), never the shooter's own crew. */
  bodies(x: number, z: number, radius: number): Target[];
  /** Whether `a` and `b` are on the same side (no friendly fire). */
  friends(a: number, b: number): boolean;
  /** A round struck a person (direct hit). */
  hitBody(shooterId: number, target: Target, damage: number, zone: string, x: number, y: number, z: number, now: number, label: string): void;
  /** A blast: people round it (sides respected) take `damage`, the vehicles their share. */
  blast(shooterId: number, x: number, y: number, z: number, radius: number, damage: number, now: number, label: string): void;
  /** Smoke that bots cannot see through. */
  smoke(x: number, z: number, radius: number, until: number): void;
  broadcastAt(x: number, z: number, msg: ServerJsonMessage): void;
  /** A missile is coming at this vehicle: whether its crew fires the countermeasure (bot crews). */
  autoDefend?(v: VehicleState): boolean;
}

export class VehicleGunnery {
  private readonly rounds: Round[] = [];
  private readonly lastShot = new Map<string, number>();
  private readonly nextMount = new Map<string, number>();
  private nextId = 0x6c000000;

  constructor(private readonly vehicles: Vehicles, private readonly collision: CollisionWorld, private readonly hooks: GunneryHooks) {}

  /**
   * The seat's trigger is held, aiming along (yaw, pitch) in the world: fires when loaded and the
   * barrel can turn that far from the hull; returns whether a round left.
   */
  fire(shooter: Combatant & { id: number }, v: VehicleState, w: VehicleWeapon, yaw: number, pitch: number, now: number, lockOn?: number): boolean {
    if (v.health <= 0 || v.exploded || !v.arms) return false;
    const ammo = v.arms.ammo[w.id];
    if (!ammo) return false;
    const key = `${v.id}:${w.id}`;
    if (!useVehicleRound(w, ammo, this.lastShot.get(key) ?? -Infinity, now)) return false;
    this.lastShot.set(key, now);
    // Clamp the aim to what the mount can reach (relative to the hull's heading).
    const rel = Math.atan2(Math.sin(yaw - v.yaw), Math.cos(yaw - v.yaw));
    const ay = v.yaw + Math.max(-w.arc.yaw, Math.min(w.arc.yaw, rel));
    const ap = Math.max(-w.arc.pitchDown, Math.min(w.arc.pitchUp, pitch));
    const k = (this.nextMount.get(key) ?? 0) % w.mounts.length;
    this.nextMount.set(key, k + 1);
    const [mx, my, mz] = w.mounts[k]!;
    const o = vehiclePoint(v, mx, my, mz);
    const [dx, dy, dz] = spreadDirection(-Math.sin(ay) * Math.cos(ap), Math.sin(ap), -Math.cos(ay) * Math.cos(ap), w.spread, Math.random);
    // The vehicle's own motion carries the round (a helicopter's rockets keep its speed).
    const fwd = v.speed;
    const id = this.nextId++;
    const r: Round = { id, shooter, vehicleId: v.id, w, x: o.x, y: o.y, z: o.z, vx: dx * w.speed - Math.sin(v.yaw) * fwd, vy: dy * w.speed + (v.motion?.vy ?? 0), vz: dz * w.speed - Math.cos(v.yaw) * fwd, traveled: 0, dieAt: now + (w.range / w.speed + 1) * 1000, lock: 0, syncedAt: now };
    if (w.turnRate) r.lock = lockOn ?? this.lockTarget(v, o, dx, dy, dz, shooter.id, now);
    this.rounds.push(r);
    this.hooks.broadcastAt(o.x, o.z, { t: 'proj', id, ownerId: shooter.id, w: 0, kind: w.projectile === 'bullet' ? 'bullet' : w.projectile, x: o.x, y: o.y, z: o.z, vx: r.vx, vy: r.vy, vz: r.vz, gravity: w.gravity, maxFlightSec: w.range / w.speed + 1 });
    return true;
  }

  /** The enemy vehicle closest to the aim line (within 12°) that a missile can lock on. */
  private lockTarget(v: VehicleState, o: { x: number; y: number; z: number }, dx: number, dy: number, dz: number, shooterId: number, now: number): number {
    let best = 0, bestCos = Math.cos(12 * Math.PI / 180);
    for (const t of this.vehicles.states.values()) {
      if (t.id === v.id || t.exploded || t.health <= 0) continue;
      const occupant = t.driver ?? t.passengers?.find((p) => p);
      if (occupant && this.hooks.friends(shooterId, occupant)) continue;
      if (now < (t.arms?.cm.activeUntil ?? 0)) continue;
      const tx = t.x - o.x, ty = t.y + 1 - o.y, tz = t.z - o.z, d = Math.hypot(tx, ty, tz);
      if (d < 15 || d > 1400) continue;
      const c = (tx * dx + ty * dy + tz * dz) / d;
      if (c > bestCos) { bestCos = c; best = t.id; }
    }
    return best;
  }

  /** V: the vehicle's flares / smoke, if it has a charge left. */
  countermeasure(v: VehicleState, now: number): boolean {
    const role = VEHICLE_ROLES[v.kind], c = role.countermeasure;
    if (!c || !v.arms || v.health <= 0 || !triggerCountermeasure(role, v.arms.cm, now)) return false;
    // Missiles already homing on it lose it.
    for (const r of this.rounds) if (r.lock === v.id) r.lock = 0;
    if (c.kind === 'smoke') {
      // A screen a few metres ahead of the hull, where the launchers point.
      const at = vehiclePoint(v, 0, 1.5, -VEHICLES[v.kind].halfZ - 6);
      this.hooks.smoke(at.x, at.z, 9, now + c.durationMs);
      this.hooks.smoke(v.x, v.z, 7, now + c.durationMs);
    }
    this.hooks.broadcastAt(v.x, v.z, { t: 'vcm', id: v.id, kind: c.kind, x: v.x, y: v.y, z: v.z, yaw: v.yaw, until: now + c.durationMs });
    return true;
  }

  /** Who can be hit at all: the crew of the firing vehicle never. */
  private targets(r: Round, len: number): Target[] {
    const v = this.vehicles.states.get(r.vehicleId);
    const crew = new Set(v ? [v.driver, ...(v.passengers ?? [])].filter((id): id is number => !!id) : []);
    return this.hooks.bodies(r.x, r.z, len + 4).filter((t) => !crew.has(t.id) && t.id !== r.shooter.id && !this.hooks.friends(r.shooter.id, t.id));
  }

  step(now: number): void {
    for (let i = this.rounds.length - 1; i >= 0; i--) {
      const r = this.rounds[i]!;
      // Guided: turn towards the locked vehicle (flares or smoke on it break the lock).
      if (r.lock) {
        const t = this.vehicles.states.get(r.lock);
        if (!t || t.exploded || now < (t.arms?.cm.activeUntil ?? 0)) r.lock = 0;
        else {
          const sp = Math.hypot(r.vx, r.vy, r.vz) || 1, tx = t.x - r.x, ty = t.y + VEHICLES[t.kind].height * .5 - r.y, tz = t.z - r.z, d = Math.hypot(tx, ty, tz) || 1;
          // A bot crew sees the launch warning and fires flares / smoke (if it has a charge).
          if (d < 260 && this.hooks.autoDefend?.(t) && this.countermeasure(t, now)) { r.lock = 0; continue; }
          const turn = Math.min(1, (r.w.turnRate ?? 0) * TICK_DT);
          const nx = r.vx / sp + (tx / d - r.vx / sp) * turn, ny = r.vy / sp + (ty / d - r.vy / sp) * turn, nz = r.vz / sp + (tz / d - r.vz / sp) * turn, n = Math.hypot(nx, ny, nz) || 1;
          r.vx = nx / n * sp; r.vy = ny / n * sp; r.vz = nz / n * sp;
          if (now - r.syncedAt > 150) { r.syncedAt = now; this.hooks.broadcastAt(r.x, r.z, { t: 'proj', id: r.id, ownerId: r.shooter.id, w: 0, kind: 'missile', x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, vz: r.vz, gravity: 0, maxFlightSec: Math.max(.5, (r.dieAt - now) / 1000) }); }
        }
      }
      const ox = r.x, oy = r.y, oz = r.z;
      advanceBallistic(r, r.w.gravity, 0, TICK_DT);
      const sx = r.x - ox, sy = r.y - oy, sz = r.z - oz, len = Math.hypot(sx, sy, sz) || 1e-6;
      r.x = ox; r.y = oy; r.z = oz;
      const dx = sx / len, dy = sy / len, dz = sz / len;
      let hit = castCombatRay(r.shooter, this.targets(r, len), this.collision, now, undefined, ox, oy, oz, dx, dy, dz, len);
      // Vehicle hulls (never the firing vehicle's own).
      let vehicleHit = 0;
      const hull = this.vehicles.hull(ox, oy, oz, dx, dy, dz, Math.min(len, hit.t), r.vehicleId);
      if (hull && hull.t < hit.t + .5) { hit = { target: null, zone: null, t: Math.min(hull.t, hit.t), rewoundMs: 0, normal: [-dx, -dy, -dz] }; vehicleHit = hull.id; }
      // Or stopped by a vehicle's own collision box.
      else if (!hit.target && (hit.colliderTag ?? 0) > 50000 && this.vehicles.states.has(hit.colliderTag! - 50000) && hit.colliderTag! - 50000 !== r.vehicleId) vehicleHit = hit.colliderTag! - 50000;
      const t = hit.t;
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      const ground = this.collision.terrainHeight(x, z);
      const stopped = !!hit.target || !!vehicleHit || t < len - 1e-4 || (Number.isFinite(ground) && y <= ground);
      r.x = x; r.y = Number.isFinite(ground) && r.w.projectile !== 'bullet' ? Math.max(y, ground + .05) : y; r.z = z;
      r.traveled += t;
      if (!stopped && now < r.dieAt && r.traveled < r.w.range) continue;
      this.rounds.splice(i, 1);
      this.hooks.broadcastAt(r.x, r.z, { t: 'projEnd', id: r.id, x: r.x, y: r.y, z: r.z, hit: !!hit.target, impact: stopped, ...(stopped && !hit.target && !vehicleHit ? { normal: hit.normal } : {}) });
      if (!stopped) continue;
      if (vehicleHit) {
        // Direct hit on a vehicle: the round's anti-armour damage, through armour as the weapon allows.
        const v = this.vehicles.states.get(vehicleHit);
        if (v) this.vehicles.hitAt(r.x, r.y, r.z, r.w.vehicleDamage, now, 50000 + v.id);
      }
      if (hit.target && hit.zone) this.hooks.hitBody(r.shooter.id, hit.target as Target, Math.round(r.w.damage * (ZONE_DAMAGE_MULTIPLIER[hit.zone] ?? 1)), hit.zone, r.x, r.y, r.z, now, r.w.name);
      if (r.w.blast) {
        this.hooks.blast(r.shooter.id, r.x, r.y, r.z, r.w.blast.radius, r.w.blast.damage, now, r.w.name);
        this.vehicles.blast(r.x, r.y, r.z, r.w.blast.radius, r.w.blast.vehicleDamage, now);
      }
    }
  }

  /** Every round in flight (the match is over / the room closes). */
  clear(): void { this.rounds.length = 0; this.lastShot.clear(); }
}
