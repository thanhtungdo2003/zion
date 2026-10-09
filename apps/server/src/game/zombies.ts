import {
  CHUNK_SIZE,
  ENTITY_INTEREST_RADIUS_CHUNKS,
  EntityFlags,
  EntityKind,
  Limb,
  TICK_DT,
  ZOMBIE_ID_BASE,
  ZombieVariant,
  zombieMaxHealth,
  isCrawling,
  limbsLeft,
  type EntityState,
} from '@zion/shared';
import {
  CharacterController,
  DEFAULT_CHARACTER,
  Mask,
  ZOMBIE_CRAWL_RIG,
  ZOMBIE_RIG,
  createCharacterState,
  makeRayHit,
  type CharacterParams,
  type CharacterState,
  type CollisionWorld,
} from '@zion/physics';
import { PoseHistory, type Player } from './player';
import type { SpawnService } from './spawn';
import { NavigationState, ZombieNavigation } from './navigation';

const HORDE_MIN = 5;
const HORDE_MAX = 6;
const SPAWN_MIN_DIST = 34;
const SPAWN_MAX_DIST = 55;
const DESPAWN_DIST = 140;
const MAX_ZOMBIES = 120;
const CORPSE_MS = 9000;
const ATTACK_RANGE = 1.5;
const ATTACK_MS = 1200;
/** Wind-up: the bite lands this long after the attack animation starts (if still in reach). */
const BITE_DELAY_MS = 700;

const ZOMBIE_PARAMS: CharacterParams = {
  ...DEFAULT_CHARACTER,
  walkSpeed: 2.2,
  sprintSpeed: 4.9,
  backwardFactor: 1,
  jumpVelocity: 0,
  // Low traction so knockback visibly shoves them.
  groundAccel: 11,
};

export interface ZombieHooks {
  /** A zombie hit a player. */
  attackPlayer(zombie: Zombie, player: Player, damage: number, now: number): void;
}

export class Zombie {
  readonly navigation = new NavigationState();
  readonly state: CharacterState;
  readonly history = new PoseHistory();
  readonly active = true;
  yaw = (Math.random() * 2 - 1) * Math.PI;
  health: number;
  readonly maxHealth: number;
  wireReadyAt = 0;
  /** Set on fire by a flamethrower: burns until `burnUntil`, ticking at `burnAt`. */
  burnUntil = 0;
  burnAt = 0;
  burnBy: Player | null = null;
  burnDps = 0;
  dead = false;
  deadAt = 0;
  /** Broken-limb mask (see Limb). */
  limbs = 0;
  target: Player | null = null;
  /** Point the horde drifts around when it has no prey. */
  anchorX: number;
  anchorZ: number;
  wanderYaw = Math.random() * Math.PI * 2;
  staggerUntil = 0;
  attackReadyAt = 0;
  attackingUntil = 0;
  /** Pending bite: lands at `biteAt` on `biteTarget` if it is still in reach and this zombie lives. */
  biteAt = 0;
  biteTarget: Player | null = null;
  biteDamage = 0;
  /** Heard a gunshot / was shot: hunts this point even out of sight. */
  alertX = 0;
  alertZ = 0;
  alertUntil = 0;

  constructor(
    readonly id: number,
    x: number,
    y: number,
    z: number,
    readonly variant: ZombieVariant = ZombieVariant.Rotting,
  ) {
    this.maxHealth = zombieMaxHealth(variant);
    this.health = this.maxHealth;
    this.state = createCharacterState(x, y, z);
    this.state.grounded = true;
    this.anchorX = x;
    this.anchorZ = z;
  }

  get rig() {
    return isCrawling(this.limbs) ? ZOMBIE_CRAWL_RIG : ZOMBIE_RIG;
  }
}

function isNight(tod: number): boolean {
  return tod < 0.22 || tod > 0.8;
}

/**
 * Spawns zombie hordes (5–6) around players day and night, runs their AI on the shared character
 * controller, and resolves limb damage, knockback and death. Fully server-authoritative.
 */
export class ZombieDirector {
  readonly zombies = new Map<number, Zombie>();
  private nextId = ZOMBIE_ID_BASE;
  private nextSpawnCheck = 0;
  private readonly controllers = new Map<number, CharacterController>();
  private readonly navigation: ZombieNavigation;
  private readonly attackHit = makeRayHit();

  constructor(
    private readonly collision: CollisionWorld,
    private readonly spawns: SpawnService,
    private readonly hooks: ZombieHooks,
  ) { this.navigation = new ZombieNavigation(collision); }

  /** Controller for a given ground speed (crawlers move slower depending on limbs left). */
  private controller(speed: number): CharacterController {
    const key = Math.round(speed * 10);
    let c = this.controllers.get(key);
    if (!c) {
      c = new CharacterController(this.collision, { ...ZOMBIE_PARAMS, walkSpeed: speed, sprintSpeed: speed });
      this.controllers.set(key, c);
    }
    return c;
  }

  step(players: readonly Player[], now: number, tod: number): void {
    const night = isNight(tod);
    if (now >= this.nextSpawnCheck) {
      this.nextSpawnCheck = now + 2000;
      this.spawnHordes(players, night);
      this.despawn(players, now);
    }
    this.separate(players);
    this.navigation.beginTick();
    for (const z of this.zombies.values()) {
      if (!z.dead) this.think(z, players, now, night);
      else this.stepPhysics(z, 0, 0);
      z.history.push(now, z.state.x, z.state.y, z.state.z, z.yaw);
    }
  }

  private spawnHordes(players: readonly Player[], night: boolean): void {
    const cap = night ? 18 : 11;
    for (const p of players) {
      if (!p.active || p.dead || this.zombies.size >= MAX_ZOMBIES) continue;
      let near = 0;
      for (const z of this.zombies.values()) if (!z.dead && dist2(z.state, p.state) < 70 * 70) near++;
      if (near + HORDE_MIN > cap || Math.random() > (night ? 0.45 : 0.25)) continue;
      const a = Math.random() * Math.PI * 2;
      const d = SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
      const cx = p.state.x + Math.cos(a) * d;
      const cz = p.state.z + Math.sin(a) * d;
      const count = HORDE_MIN + Math.floor(Math.random() * (HORDE_MAX - HORDE_MIN + 1));
      for (let i = 0; i < count; i++) {
        const pos = this.spawns.validateAt(cx + (Math.random() - 0.5) * 7, cz + (Math.random() - 0.5) * 7);
        if (!pos || !this.spawns.allowsZombieSpawn(pos.x, pos.z)) continue;
        const z = new Zombie(this.nextId++, pos.x, pos.y, pos.z, i === 0 ? ZombieVariant.Brute : i % 2 ? ZombieVariant.Gaunt : ZombieVariant.Rotting);
        z.anchorX = cx;
        z.anchorZ = cz;
        this.zombies.set(z.id, z);
      }
    }
  }

  private despawn(players: readonly Player[], now: number): void {
    for (const [id, z] of this.zombies) {
      if (z.dead && now - z.deadAt > CORPSE_MS) {
        this.navigation.clear(z.navigation);
        this.zombies.delete(id);
        continue;
      }
      let close = false;
      for (const p of players) if (p.active && dist2(z.state, p.state) < DESPAWN_DIST * DESPAWN_DIST) close = true;
      if (!close) {
        this.navigation.clear(z.navigation);
        this.zombies.delete(id);
      }
    }
  }

  private speedFor(z: Zombie, night: boolean, chasing: boolean): number {
    if (isCrawling(z.limbs)) {
      const left = limbsLeft(z.limbs);
      const base = left >= 3 ? 1.1 : left === 2 ? 0.8 : left === 1 ? 0.45 : 0;
      return enraged(z) ? base * 1.4 : base;
    }
    if (z.variant === ZombieVariant.Brute) return chasing ? 1.25 : 0.75;
    if (!chasing) return 1.2;
    // Badly hurt zombies roar and charge, day or night.
    return night || enraged(z) ? ZOMBIE_PARAMS.sprintSpeed : ZOMBIE_PARAMS.walkSpeed;
  }

  /**
   * Bodies don't overlap: overlapping zombies (and zombies pressed against players) push each
   * other apart through their velocities, so the controller still resolves walls normally.
   */
  private separate(players: readonly Player[]): void {
    const list = [...this.zombies.values()].filter((z) => !z.dead);
    const R = 0.75;
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!.state;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!.state;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R || Math.abs(a.y - b.y) > 1.5) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (R - d) * 7;
        const nx = d2 > 1e-6 ? dx / d : Math.random() - 0.5;
        const nz = d2 > 1e-6 ? dz / d : Math.random() - 0.5;
        a.vx -= nx * push;
        a.vz -= nz * push;
        b.vx += nx * push;
        b.vz += nz * push;
      }
      for (const p of players) {
        if (!p.active || p.dead) continue;
        const dx = a.x - p.state.x;
        const dz = a.z - p.state.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        a.vx += (dx / d) * (R - d) * 7;
        a.vz += (dz / d) * (R - d) * 7;
      }
    }
  }

  private think(z: Zombie, players: readonly Player[], now: number, night: boolean): void {
    const s = z.state;
    const sense = enraged(z) ? 60 : night ? 34 : 22;
    // Keep the current target while it is alive and in range; otherwise pick the nearest.
    if (z.target && (z.target.dead || !z.target.active || dist2(s, z.target.state) > (sense * 1.6) ** 2)) z.target = null;
    if (!z.target) {
      let best = sense * sense;
      for (const p of players) {
        if (!p.active || p.dead) continue;
        const d = dist2(s, p.state);
        if (d < best) {
          best = d;
          z.target = p;
        }
      }
    }
    let goalX: number;
    let goalZ: number;
    let chasing = false;
    if (z.target) {
      goalX = z.target.state.x;
      goalZ = z.target.state.z;
      chasing = true;
    } else if (now < z.alertUntil) {
      goalX = z.alertX;
      goalZ = z.alertZ;
      chasing = true;
    } else {
      if (Math.random() < 0.01) z.wanderYaw += (Math.random() - 0.5) * 2;
      // Drift around the horde's anchor.
      const ax = z.anchorX - s.x;
      const az = z.anchorZ - s.z;
      const far = ax * ax + az * az > 64;
      goalX = s.x + (far ? ax : -Math.sin(z.wanderYaw) * 4);
      goalZ = s.z + (far ? az : -Math.cos(z.wanderYaw) * 4);
    }
    const dist = Math.hypot(goalX - s.x, goalZ - s.z);
    const goal = { x: goalX, y: z.target?.state.y ?? this.collision.terrainHeight(goalX, goalZ), z: goalZ };
    const waypoint = chasing
      ? this.navigation.steer(z.navigation, s, goal, now)
      : this.navigation.map.trace(s, goalX, goalZ);
    if (!chasing) {
      this.navigation.clear(z.navigation);
      if (!waypoint) z.wanderYaw += 0.5;
    }
    const dx = (waypoint?.x ?? goalX) - s.x;
    const dz = (waypoint?.z ?? goalZ) - s.z;
    const waypointDist = Math.hypot(dx, dz);
    const want = waypointDist > 0.05 ? Math.atan2(-dx, -dz) : z.yaw;
    if (waypointDist > 0.05) {
      let d = want - z.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      // Keep yaw wrapped to ±π: snapshots quantise angles in that range, so an unwrapped yaw
      // would saturate and the zombie would appear frozen facing one way.
      z.yaw = wrapAngle(z.yaw + Math.max(-0.25, Math.min(0.25, d)));
    }

    // Attack when in reach.
    const t = z.target;
    const inReach = t && dist < ATTACK_RANGE && Math.abs(s.y - t.state.y) < 1.2 &&
      this.collision.lineOfSight(s.x, s.y + 0.9, s.z, t.state.x, t.state.y + 0.9, t.state.z,
        Mask.LineOfSight, this.attackHit);
    // A started bite resolves after its wind-up: only if the victim is still within reach.
    if (z.biteAt && now >= z.biteAt) {
      const v = z.biteTarget;
      z.biteAt = 0;
      z.biteTarget = null;
      if (v && !v.dead && !z.dead && this.canBite(z, v)) this.hooks.attackPlayer(z, v, z.biteDamage, now);
    }
    if (t && inReach && !z.biteAt && now >= z.attackReadyAt && now >= z.staggerUntil) {
      z.attackReadyAt = now + ATTACK_MS;
      // The attack animation plays through the wind-up and the bite itself.
      z.attackingUntil = now + BITE_DELAY_MS + 300;
      const armsLeft = 2 - (z.limbs & Limb.ArmL ? 1 : 0) - (z.limbs & Limb.ArmR ? 1 : 0);
      z.biteDamage = Math.round((night ? 16 : 11) * (isCrawling(z.limbs) ? 0.7 : 1) * (armsLeft === 0 ? 0.6 : 1));
      z.biteAt = now + BITE_DELAY_MS;
      z.biteTarget = t;
    }

    const staggered = now < z.staggerUntil;
    const speed = this.speedFor(z, night, chasing);
    const move = !!waypoint && !staggered && speed > 0 &&
      !(inReach && dist <= ATTACK_RANGE * 0.7) && waypointDist > (chasing ? 0.1 : 0.5);
    const idleRandom = !chasing && Math.random() < 0.3; // wanderers shuffle in fits and starts
    // Brake before corners; steer along the checked corridor while the visual facing turns smoothly.
    const approachSpeed = Math.min(speed, Math.sqrt(2 * ZOMBIE_PARAMS.groundAccel * waypointDist) * 0.65);
    this.stepPhysics(z, move && !idleRandom ? 1 : 0, approachSpeed, want);
  }

  private stepPhysics(z: Zombie, mz: number, speed: number, yaw = z.yaw): void {
    this.controller(Math.max(speed, 0.3)).step(z.state, { mx: 0, mz, yaw, jump: false, sprint: false }, TICK_DT);
  }

  /** Applies a hit. Returns what happened so the caller can broadcast it. */
  /** Victim within biting range (distance, height and line of sight). */
  private canBite(z: Zombie, v: Player): boolean {
    const s = z.state;
    return Math.hypot(v.state.x - s.x, v.state.z - s.z) < ATTACK_RANGE + 0.2 && Math.abs(s.y - v.state.y) < 1.2 &&
      this.collision.lineOfSight(s.x, s.y + 0.9, s.z, v.state.x, v.state.y + 0.9, v.state.z, Mask.LineOfSight, this.attackHit);
  }

  hit(z: Zombie, zone: string, damage: number, dirX: number, dirZ: number, impulse: number, now: number, attacker: Player | null): { killed: boolean; broke: number } {
    if (z.dead) return { killed: false, broke: 0 };
    // Knockback: shove along the shot direction and briefly stagger.
    const s = z.state;
    const len = Math.hypot(dirX, dirZ) || 1;
    s.vx += (dirX / len) * impulse;
    s.vz += (dirZ / len) * impulse;
    z.staggerUntil = Math.max(z.staggerUntil, now + 120 + impulse * 60);
    if (attacker && !attacker.dead) z.target = attacker;
    const broke = 0;
    if (zone === 'head' && z.variant !== ZombieVariant.Brute) {
      z.health = 0;
    } else if (zone.startsWith('arm_') || zone.startsWith('leg_')) {
      // Limbs don't break (no crippling): they just take a bit less damage than the body.
      z.health -= damage * 0.8;
    } else {
      z.health -= damage;
    }
    if (z.health <= 0) {
      this.navigation.clear(z.navigation);
      z.dead = true;
      z.biteAt = 0;
      z.biteTarget = null;
      z.deadAt = now;
      z.health = 0;
      return { killed: true, broke };
    }
    return { killed: false, broke };
  }

  /** Gunfire is loud: zombies within earshot come to investigate. */
  alert(x: number, z: number, radius: number, now: number): void {
    for (const zb of this.zombies.values()) {
      if (zb.dead) continue;
      const dx = zb.state.x - x;
      const dz = zb.state.z - z;
      if (dx * dx + dz * dz > radius * radius) continue;
      zb.alertX = x;
      zb.alertZ = z;
      zb.alertUntil = now + 12_000;
    }
  }

  near(x: number, z: number, radius: number): Zombie[] {
    const out: Zombie[] = [];
    for (const zb of this.zombies.values()) {
      const dx = zb.state.x - x;
      const dz = zb.state.z - z;
      if (dx * dx + dz * dz <= radius * radius) out.push(zb);
    }
    return out;
  }

  /** Snapshot entries for zombies a player can see. */
  entitiesFor(p: Player, now: number, out: EntityState[]): void {
    const r = ENTITY_INTEREST_RADIUS_CHUNKS * CHUNK_SIZE;
    for (const z of this.zombies.values()) {
      if (dist2(z.state, p.state) > r * r) continue;
      let flags = 0;
      if (z.state.grounded) flags |= EntityFlags.Grounded;
      if (z.state.swimming) flags |= EntityFlags.Swimming;
      if (z.dead) flags |= EntityFlags.Dead;
      if (z.target && !z.dead) flags |= EntityFlags.Sprinting;
      if (now < z.attackingUntil) flags |= EntityFlags.Attacking;
      out.push({ id: z.id, kind: EntityKind.Zombie, x: z.state.x, y: z.state.y, z: z.state.z, yaw: z.yaw, pitch: 0, flags, health: Math.max(0, Math.round(z.health / z.maxHealth * 100)), weapon: z.limbs | (z.variant << 4) });
    }
  }
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Below 30% health a zombie goes berserk. */
function enraged(z: Zombie): boolean {
  return z.health < z.maxHealth * 0.3;
}

function dist2(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
