import { ARMOR_BY_ID, NO_ARMOR, ZOMBIE_BUCKET, ZOMBIE_BUCKET_DURABILITY, armorProtection, packArmor, type ArmorLoadout } from '@zion/shared';
import type { SuspendedZombie } from '@zion/shared';
import { zombieScale } from '@zion/shared';
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
  Layer,
  Mask,
  type Collider,
  zombieHitRig,
  createCharacterState,
  makeRayHit,
  type CharacterParams,
  type CharacterState,
  type CollisionWorld,
} from '@zion/physics';
import { PoseHistory, type Player } from './player';
import type { SpawnService } from './spawn';
import { NavigationState, ZombieNavigation } from './navigation';

const SPAWN_MIN_DIST = 56;
const SPAWN_MAX_DIST = 112;
const DESPAWN_DIST = 140;
/** Indoor lurkers: spawn in buildings this far from players (they are out of sight indoors). */
const INDOOR_MIN_DIST = 22;
const INDOOR_MAX_DIST = 90;
const INDOOR_COOLDOWN_MS = 90_000;
const MAX_ZOMBIES = 90;
/** Reinforcements appear this far (plus up to REINFORCE_SPREAD) from the hunted player. */
const REINFORCE_MIN_DIST = 40;
const REINFORCE_SPREAD = 24;
/** A committed hunter only gives up once its prey is at least this far away. */
const CHASE_GIVE_UP_DIST = 70;
const CORPSE_MS = 9000;
const ATTACK_RANGE = 1.5;
const ATTACK_MS = 1200;
/** Wind-up: the bite lands this long after the attack animation starts (if still in reach). */
const BITE_DELAY_MS = 700;

/** Climbable ladder asset (rusty iron wall ladder). */
const LADDER_TAG = 2022;

/** Ordinary zombies' walking pace (m/s) chasing and wandering: their recorded walk, played a little quicker. */
const ORDINARY_WALK = 1.0, ORDINARY_WANDER = .6;
/** Length of the recorded scream (ms). */
const SCREAM_MS = 2800;

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
  /** Committed prey: chased even out of sight, until it gets too far away. */
  target: Player | null = null;
  /** Point this zombie wanders around when it has no prey. */
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
  /** Only ambient scouts recruit, preventing exponential reinforcement chains. */
  recruitsLeft = 0;
  recruitAt = 0;
  jumpReadyAt = 0;
  jumpingUntil = 0;
  jumpWindupUntil = 0;
  leapYaw = 0;
  /** Badly hurt (below half health): stands and screams until `screamUntil`, then charges. */
  screamed = false;
  screamUntil = 0;
  /** An iron bucket over the head (no headshots while it holds): what it can still take. */
  bucket = 0;
  /** Armour off a dead survivor: worn pieces (wire ids) and what the set and the helmet can still take. */
  armor: ArmorLoadout = { ...NO_ARMOR };
  armorDurability = 0;
  helmetDurability = 0;
  /** Half of all zombies can climb ladders to reach prey up on a roof or a tower. */
  readonly climber = Math.random() < .5;
  /** Ladder this climber is heading for: where to stand at its foot and its centre. */
  ladder: { x: number; z: number; cx: number; cz: number; until: number } | null = null;

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
    return zombieHitRig(this.variant, this.limbs, this.state.grounded);
  }
}

function isNight(tod: number): boolean {
  return tod < 0.22 || tod > 0.8;
}

/**
 * Populates the shared loaded map with solitary scouts, runs AI on the shared character
 * controller, and resolves limb damage, knockback and death. Fully server-authoritative.
 */
export class ZombieDirector {
  /** Removes the encounter without kills/loot; its health and limbs survive reconnects. */
  suspend(player: Player, players: readonly Player[] = []): SuspendedZombie[] {
    const saved: SuspendedZombie[] = [];
    for (const [id, z] of this.zombies) {
      if (!z.dead && (z.target === player || z.biteTarget === player)) {
        if (players.some(p => p !== player && p.active && !p.dead && dist2(z.state, p.state) < DESPAWN_DIST ** 2)) {
          if (z.target === player) z.target = null;
          if (z.biteTarget === player) { z.biteTarget = null; z.biteAt = 0; }
          if (z.burnBy === player) z.burnBy = null;
          continue;
        }
        saved.push({ x: z.state.x, y: z.state.y, z: z.state.z, health: z.health, limbs: z.limbs, variant: z.variant });
        this.navigation.clear(z.navigation);
        z.biteTarget = z.target = z.burnBy = null;
        this.zombies.delete(id);
      } else if (z.burnBy === player) z.burnBy = null;
    }
    return saved;
  }

  /** Retry unloaded collision areas; never discard a suspended encounter on a failed spawn. */
  restore(player: Player): void {
    player.suspendedZombies = player.suspendedZombies.filter((s) => {
      if (this.zombies.size >= MAX_ZOMBIES) return true;
      let x = s.x, zpos = s.z;
      if (player.state && Math.hypot(x - player.state.x, zpos - player.state.z) > DESPAWN_DIST * .7) {
        if (this.spawns.inSafeZone(player.state.x, player.state.z)) return true;
        const angle = Math.random() * Math.PI * 2;
        x = player.state.x + Math.cos(angle) * 16;
        zpos = player.state.z + Math.sin(angle) * 16;
      }
      const pos = this.spawns.validateAt(x, zpos);
      if (!pos) return true;
      const z = new Zombie(this.nextId++, pos.x, pos.y, pos.z, s.variant);
      z.health = Math.max(1, Math.min(z.maxHealth, s.health));
      z.limbs = s.limbs;
      z.target = player;
      this.zombies.set(z.id, z);
      return false;
    });
  }
  readonly zombies = new Map<number, Zombie>();
  private nextId = ZOMBIE_ID_BASE;
  private nextSpawnCheck = 0;
  private readonly chunkSpawnAt = new Map<string, number>();
  private readonly controllers = new Map<number, CharacterController>();
  private readonly navigation: ZombieNavigation;
  private readonly attackHit = makeRayHit();

  constructor(
    private readonly collision: CollisionWorld,
    private readonly spawns: SpawnService,
    private readonly hooks: ZombieHooks,
  ) { this.navigation = new ZombieNavigation(collision); }

  /** Controller for a given ground speed (crawlers move slower depending on limbs left). */
  private controller(speed: number, scale = 1, crawling = false, climber = false): CharacterController {
    const key = ((Math.round(speed * 10) * 10 + Math.round(scale * 2)) * 2 + Number(crawling)) * 2 + Number(climber);
    let c = this.controllers.get(key);
    if (!c) {
      // Only climbers grip ladders; the rest just bump against them.
      c = new CharacterController(this.collision, { ...ZOMBIE_PARAMS, radius: ZOMBIE_PARAMS.radius * scale, height: crawling ? .85 : ZOMBIE_PARAMS.height * scale, walkSpeed: speed, sprintSpeed: speed, ladderTags: climber && !crawling ? ZOMBIE_PARAMS.ladderTags : [] });
      this.controllers.set(key, c);
    }
    return c;
  }

  step(players: readonly Player[], now: number, tod: number): void {
    const night = isNight(tod);
    if (now >= this.nextSpawnCheck) {
      this.nextSpawnCheck = now + 2000;
      this.despawn(players, now);
      this.spawnMap(players, now, night);
      this.spawnIndoors(players, now, night);
    }
    this.separate(players);
    this.navigation.beginTick();
    for (const z of [...this.zombies.values()]) {
      if (!z.dead) this.think(z, players, now, night);
      else this.stepPhysics(z, 0, 0);
      z.history.push(now, z.state.x, z.state.y, z.state.z, z.yaw);
    }
  }

  private spawnMap(players: readonly Player[], now: number, night: boolean): void {
    const chunks = this.spawns.loadedZombieChunks();
    const loaded = new Set(chunks.map(([x, z]) => `${x},${z}`));
    for (const key of this.chunkSpawnAt.keys()) if (!loaded.has(key)) this.chunkSpawnAt.delete(key);
    // Shuffle once: a fixed global budget, independent of player count or iteration order.
    for (let i = chunks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chunks[i], chunks[j]] = [chunks[j]!, chunks[i]!];
    }
    let budget = 6;
    let attempts = 32;
    for (const [cx, cz] of chunks) {
      if (this.zombies.size >= MAX_ZOMBIES || budget <= 0 || attempts <= 0) break;
      const key = `${cx},${cz}`;
      if (now < (this.chunkSpawnAt.get(key) ?? 0)) continue;
      attempts--;
      const pos = this.spawns.validateAt((cx + Math.random()) * CHUNK_SIZE, (cz + Math.random()) * CHUNK_SIZE);
      if (!pos || !this.spawnClear(pos, players, SPAWN_MIN_DIST)) continue;
      const dark = this.spawns.zombieDarkness(pos.x, pos.y, pos.z, night);
      const nearby = this.near(pos.x, pos.z, CHUNK_SIZE).filter(z => !z.dead);
      if (nearby.length >= (dark > .5 ? 3 : 1) || Math.random() > .36 * dark) continue;
      const z = this.addZombie(pos);
      z.recruitsLeft = 2;
      this.chunkSpawnAt.set(key, now + 12_000);
      budget--;
    }
  }

  /** Zombies lurking inside the abandoned buildings around players, upper floors included. */
  private readonly spotSpawnAt = new Map<string, number>();
  private spawnIndoors(players: readonly Player[], now: number, night: boolean): void {
    const active = players.filter(p => p.active && !p.dead && p.state);
    for (let i = active.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [active[i], active[j]] = [active[j]!, active[i]!]; }
    let budget = 2;
    for (const p of active) {
      if (this.zombies.size >= MAX_ZOMBIES || budget <= 0) break;
      const spots = this.spawns.indoorSpots(p.state.x, p.state.z, INDOOR_MAX_DIST);
      for (let tries = 0; tries < 4 && spots.length; tries++) {
        const spot = spots.splice(Math.floor(Math.random() * spots.length), 1)[0]!;
        const key = `${Math.round(spot.x)},${Math.round(spot.y)},${Math.round(spot.z)}`;
        if (now < (this.spotSpawnAt.get(key) ?? 0)) continue;
        this.spotSpawnAt.set(key, now + INDOOR_COOLDOWN_MS);
        if (!this.spawns.allowsZombieSpawn(spot.x, spot.z) || Math.random() > (night ? .55 : .4)) continue;
        if (active.some(q => Math.hypot(spot.x - q.state.x, spot.y - q.state.y, spot.z - q.state.z) < INDOOR_MIN_DIST)) continue;
        if (this.near(spot.x, spot.z, 6).some(z => !z.dead && Math.abs(z.state.y - spot.y) < 2.5)) continue;
        const pos = this.spawns.validateIndoor(spot.x, spot.y, spot.z);
        if (!pos) continue;
        this.addZombie(pos).recruitsLeft = 1;
        budget--;
        break;
      }
    }
    if (this.spotSpawnAt.size > 4096) for (const [key, at] of this.spotSpawnAt) if (at <= now) this.spotSpawnAt.delete(key);
  }

  private spawnClear(pos: { x: number; z: number }, players: readonly Player[], minimum: number): boolean {
    if (!this.spawns.allowsZombieSpawn(pos.x, pos.z)) return false;
    const active = players.filter(p => p.active && !p.dead);
    if (!active.some(p => dist2(pos, p.state) <= SPAWN_MAX_DIST ** 2)) return false;
    if (active.some(p => dist2(pos, p.state) < minimum ** 2)) return false;
    return !this.near(pos.x, pos.z, 10).some(z => !z.dead);
  }

  private addZombie(pos: { x: number; y: number; z: number }): Zombie {
    const roll = Math.random();
    const variant = roll < .03 ? ZombieVariant.Brute : roll < .23 ? ZombieVariant.Crimson : roll < .58 ? ZombieVariant.Gaunt : ZombieVariant.Rotting;
    const z = new Zombie(this.nextId++, pos.x, pos.y, pos.z, variant);
    // Some wear a bucket over the head. (Worn survivor armour is not fitted to the zombie bodies
    // yet: armour they cannot be seen wearing would only confuse, so none for now.)
    if (variant !== ZombieVariant.Brute && variant !== ZombieVariant.Crimson && Math.random() < .14) z.bucket = ZOMBIE_BUCKET_DURABILITY;
    this.zombies.set(z.id, z);
    return z;
  }

  private reinforce(z: Zombie, players: readonly Player[], now: number): void {
    if (!z.target || z.recruitsLeft <= 0 || now < z.recruitAt || this.zombies.size >= MAX_ZOMBIES) return;
    z.recruitAt = now + 4000;
    const target = z.target.state;
    if (this.near(target.x, target.z, 64).filter(z => !z.dead).length >= 14) return;
    for (let attempt = 0; attempt < 6; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = REINFORCE_MIN_DIST + Math.random() * REINFORCE_SPREAD;
      const pos = this.spawns.validateAt(target.x + Math.cos(angle) * radius, target.z + Math.sin(angle) * radius);
      if (!pos || !this.spawnClear(pos, players, REINFORCE_MIN_DIST - 2)) continue;
      const recruit = this.addZombie(pos);
      recruit.alertX = target.x; recruit.alertZ = target.z; recruit.alertUntil = now + 12_000;
      z.recruitsLeft--;
      break;
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

  private speedFor(z: Zombie, night: boolean, chasing: boolean, now = 0): number {
    if (now < z.screamUntil) return 0;
    if (isCrawling(z.limbs)) {
      const left = limbsLeft(z.limbs);
      const base = left >= 3 ? 1.1 : left === 2 ? 0.8 : left === 1 ? 0.45 : 0;
      return enraged(z) ? base * 1.4 : base;
    }
    if (z.variant === ZombieVariant.Brute) return chasing ? (enraged(z) ? 2.8 : 1.25) : 0.75;
    if (z.variant === ZombieVariant.Crimson) return chasing ? (night || enraged(z) ? 5.6 : 2.55) : 1.4;
    // Ordinary zombies shamble at the pace of their recorded walk (wandering slower), and run at
    // night or once they have screamed (badly hurt), day or night.
    if (night || enraged(z)) return chasing ? ZOMBIE_PARAMS.sprintSpeed : 1.2;
    return chasing ? ORDINARY_WALK : ORDINARY_WANDER;
  }

  /**
   * Bodies don't overlap: overlapping zombies (and zombies pressed against players) push each
   * other apart through their velocities, so the controller still resolves walls normally.
   */
  private separate(players: readonly Player[]): void {
    const list = [...this.zombies.values()].filter((z) => !z.dead);
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!.state;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!.state;
        const R = 0.375 * (zombieScale(list[i]!.variant) + zombieScale(list[j]!.variant));
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
      const R = 0.375 * (zombieScale(list[i]!.variant) + 1);
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
    // A committed hunter chases through walls and only gives up when its prey gets far away.
    const giveUp = Math.max(CHASE_GIVE_UP_DIST, sense * 1.6);
    if (z.target && (z.target.dead || !z.target.active || dist2(s, z.target.state) > giveUp ** 2)) z.target = null;
    if (!z.target) this.detect(z, players, sense);
    this.reinforce(z, players, now);
    if (z.target && z.variant === ZombieVariant.Crimson && z.jumpReadyAt === 0) z.jumpReadyAt = now + 4000;
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
      // Wander around the original map spawn.
      const ax = z.anchorX - s.x;
      const az = z.anchorZ - s.z;
      const far = ax * ax + az * az > 64;
      goalX = s.x + (far ? ax : -Math.sin(z.wanderYaw) * 4);
      goalZ = s.z + (far ? az : -Math.cos(z.wanderYaw) * 4);
    }
    const dist = Math.hypot(goalX - s.x, goalZ - s.z);
    const goal = { x: goalX, y: z.target?.state.y ?? this.collision.terrainHeight(goalX, goalZ), z: goalZ };
    // Prey up high (roof, tower): climbers make for the nearest ladder and go up it.
    const high = !!z.target && z.target.state.y - s.y > 2.2 && dist < 30;
    if (high && z.climber && !isCrawling(z.limbs)) {
      if (!z.ladder || now > z.ladder.until) z.ladder = this.findLadder(z.target!.state.x, z.target!.state.y, z.target!.state.z, s, now);
    } else if (!high) z.ladder = null;
    const ladder = z.ladder;
    let waypoint = ladder
      ? (Math.hypot(ladder.x - s.x, ladder.z - s.z) < .9 || !s.grounded ? { x: ladder.cx, y: s.y, z: ladder.cz } : this.navigation.steer(z.navigation, s, { x: ladder.x, y: this.collision.terrainHeight(ladder.x, ladder.z), z: ladder.z }, now) ?? { x: ladder.x, y: s.y, z: ladder.z })
      : chasing
      ? this.navigation.steer(z.navigation, s, goal, now)
      : this.navigation.map.trace(s, goalX, goalZ);
    // Out of reach (up high, no way found): keep pressing towards the prey instead of standing still.
    if (!waypoint && chasing) waypoint = { x: goalX, y: s.y, z: goalZ };
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
    const inReach = !s.swimming && t && dist < ATTACK_RANGE * zombieScale(z.variant) && Math.abs(s.y - t.state.y) < 1.2 &&
      this.collision.lineOfSight(s.x, s.y + 0.9, s.z, t.state.x, t.state.y + (t.state.prone ? .4 : .9), t.state.z,
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
    if (z.variant === ZombieVariant.Crimson && z.target && !isCrawling(z.limbs) && !staggered && s.grounded && !s.swimming && now >= z.jumpReadyAt && dist > 3 && dist < 14 &&
      this.collision.lineOfSight(s.x, s.y + .9, s.z, z.target.state.x, z.target.state.y + .9, z.target.state.z, Mask.LineOfSight, this.attackHit)) {
      // Match crouch_spring: crouch for 0.6 seconds, then launch as the authored legs extend.
      z.jumpWindupUntil = now + 600;
      z.jumpingUntil = now + 1600;
      z.jumpReadyAt = now + 6500 + Math.random() * 2000;
    }
    if (z.jumpWindupUntil) {
      if (staggered || !z.target) {
        z.jumpWindupUntil = z.jumpingUntil = 0;
      } else if (now < z.jumpWindupUntil) {
        this.stepPhysics(z, 0, .3);
        return;
      } else {
        z.jumpWindupUntil = 0;
        s.vy = 9.5;
        s.grounded = false;
        z.leapYaw = Math.atan2(s.x - goalX, s.z - goalZ);
        s.vx = -Math.sin(z.leapYaw) * 7;
        s.vz = -Math.cos(z.leapYaw) * 7;
      }
    }
    if (z.variant === ZombieVariant.Crimson && !s.grounded && now < z.jumpingUntil) {
      this.stepPhysics(z, staggered ? 0 : 1, 8, z.leapYaw);
      return;
    }
    const speed = this.speedFor(z, night, chasing, now);
    const move = !!waypoint && !staggered && speed > 0 &&
      !(inReach && dist <= ATTACK_RANGE * zombieScale(z.variant) * 0.7) && waypointDist > (chasing ? 0.1 : 0.5);
    const idleRandom = !chasing && Math.random() < 0.3; // wanderers shuffle in fits and starts
    // Brake before corners; steer along the checked corridor while the visual facing turns smoothly.
    const approachSpeed = Math.min(speed, Math.sqrt(2 * ZOMBIE_PARAMS.groundAccel * waypointDist) * 0.65);
    this.stepPhysics(z, move && !idleRandom ? 1 : 0, approachSpeed, want);
  }

  /**
   * The ladder (asset 2022) nearest to a high spot, and where a zombie stands to climb it: in
   * front of its thin face, on the side the zombie can reach.
   */
  private findLadder(x: number, y: number, z: number, from: { x: number; y: number; z: number }, now: number): Zombie['ladder'] {
    const found: Collider[] = [];
    const n = this.collision.queryAABB({ minX: x - 22, minY: Math.min(y, from.y) - 2, minZ: z - 22, maxX: x + 22, maxY: y + 2, maxZ: z + 22 }, Layer.Static, found);
    let best: Zombie['ladder'] = null, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const c = found[i]!;
      if (c.tag !== LADDER_TAG || c.aabb.minY > from.y + 1.5) continue;
      const cx = (c.aabb.minX + c.aabb.maxX) / 2, cz = (c.aabb.minZ + c.aabb.maxZ) / 2;
      const hx = (c.aabb.maxX - c.aabb.minX) / 2, hz = (c.aabb.maxZ - c.aabb.minZ) / 2;
      // Stand off the thin side, on whichever side is nearer the zombie.
      const alongX = hx < hz, side = alongX ? Math.sign(from.x - cx) || 1 : Math.sign(from.z - cz) || 1;
      const sx = alongX ? cx + side * (hx + .55) : cx, sz = alongX ? cz : cz + side * (hz + .55);
      const d = Math.hypot(sx - from.x, sz - from.z) + Math.hypot(cx - x, cz - z);
      if (d < bestD) { bestD = d; best = { x: sx, z: sz, cx, cz, until: now + 3000 }; }
    }
    return best;
  }

  /** Acquire visible players immediately; prone players have 35% of the normal detection range. */
  private detect(z: Zombie, players: readonly Player[], sense: number): void {
    const s = z.state;
    let seen: Player | null = null;
    let best = sense * sense;
    for (const p of players) {
      if (!p.active || p.dead) continue;
      const d = dist2(s, p.state);
      const range = p.state.prone ? sense * .35 : sense;
      // Seen at body or head height: a player up on a roof or a ledge often shows only the head.
      const sees = (h: number) => this.collision.lineOfSight(s.x, s.y + 1.5, s.z, p.state.x, p.state.y + h, p.state.z, Mask.LineOfSight, this.attackHit);
      if (d < best && d < range * range && (sees(p.state.prone ? .4 : .9) || sees(p.state.prone ? .5 : 1.6))) {
        best = d;
        seen = p;
      }
    }
    if (seen) z.target = seen;
  }

  private stepPhysics(z: Zombie, mz: number, speed: number, yaw = z.yaw): void {
    this.controller(Math.max(speed, 0.3), zombieScale(z.variant), z.variant === ZombieVariant.Crimson && z.state.grounded && !z.jumpWindupUntil, z.climber && !isCrawling(z.limbs)).step(z.state, { mx: 0, mz, yaw, jump: false, sprint: false }, TICK_DT);
  }

  /** Applies a hit. Returns what happened so the caller can broadcast it. */
  /** Victim within biting range (distance, height and line of sight). */
  private canBite(z: Zombie, v: Player): boolean {
    const s = z.state;
    return !s.swimming && Math.hypot(v.state.x - s.x, v.state.z - s.z) < ATTACK_RANGE * zombieScale(z.variant) + 0.2 && Math.abs(s.y - v.state.y) < 1.2 &&
      this.collision.lineOfSight(s.x, s.y + 0.9, s.z, v.state.x, v.state.y + (v.state.prone ? .4 : .9), v.state.z, Mask.LineOfSight, this.attackHit);
  }

  /** A heavy blow interrupts the bite and spring wind-up as well as stopping locomotion. */
  stun(z: Zombie, durationMs: number, now: number): void {
    if (z.dead) return;
    z.staggerUntil = Math.max(z.staggerUntil, now + durationMs);
    z.biteAt = 0;
    z.biteTarget = null;
    z.attackingUntil = 0;
    z.jumpWindupUntil = 0;
    z.jumpReadyAt = Math.max(z.jumpReadyAt, z.staggerUntil);
    z.attackReadyAt = Math.max(z.attackReadyAt, z.staggerUntil);
  }

  hit(z: Zombie, zone: string, damage: number, dirX: number, dirZ: number, impulse: number, now: number, attacker: Player | null): { killed: boolean; broke: number; shield?: 'bucket' | 'bucketBroke' | 'helmet' | 'armor' } {
    if (z.dead) return { killed: false, broke: 0 };
    const head = zone === 'head' || zone === 'decapitation';
    let shield: 'bucket' | 'bucketBroke' | 'helmet' | 'armor' | undefined;
    // The bucket takes the head hit (no damage gets through) until it breaks.
    if (head && z.bucket > 0) {
      z.bucket = Math.max(0, z.bucket - damage);
      if (attacker && !attacker.dead) z.target = attacker;
      z.staggerUntil = Math.max(z.staggerUntil, now + 200);
      return { killed: false, broke: 0, shield: z.bucket > 0 ? 'bucket' : 'bucketBroke' };
    }
    // A helmet stops the instant kill: part of the hit gets through, the helmet wears down.
    if (head && z.armor.head && zone !== 'decapitation') {
      const p = ARMOR_BY_ID.get(z.armor.head)?.protection ?? .1;
      z.helmetDurability -= damage;
      if (z.helmetDurability <= 0) z.armor = { ...z.armor, head: 0 };
      zone = 'torso'; damage = damage * (1 - p) * 1.5; shield = 'helmet';
    } else if (!head && z.armorDurability > 0) {
      // Body armour soaks a share of every body / limb hit while it lasts.
      const p = armorProtection({ ...z.armor, head: 0 }), absorbed = damage * p;
      z.armorDurability -= absorbed; damage -= absorbed; shield = 'armor';
      if (z.armorDurability <= 0) z.armor = { ...z.armor, chest: 0, face: 0, ears: 0 };
    }
    // Knockback: shove along the shot direction and briefly stagger.
    if (z.variant !== ZombieVariant.Brute) {
      const s = z.state;
      const len = Math.hypot(dirX, dirZ) || 1;
      s.vx += (dirX / len) * impulse;
      s.vz += (dirZ / len) * impulse;
      z.staggerUntil = Math.max(z.staggerUntil, now + 120 + impulse * 60);
    }
    if (attacker && !attacker.dead) z.target = attacker;
    const broke = 0;
    if (zone === 'decapitation' && z.variant !== ZombieVariant.Brute) {
      z.limbs |= Limb.Head;
      z.health = 0;
    } else if (zone === 'head' && z.variant !== ZombieVariant.Brute) {
      z.health = 0;
    } else if (zone.startsWith('arm_') || zone.startsWith('leg_')) {
      // Limbs don't break (no crippling): they just take a bit less damage than the body.
      z.health -= damage * 0.8;
    } else {
      z.health -= damage;
    }
    // An ordinary zombie dropping below half health stops and screams, then runs.
    if (z.health > 0 && !z.screamed && z.variant !== ZombieVariant.Brute && z.variant !== ZombieVariant.Crimson && !isCrawling(z.limbs) && z.health < z.maxHealth * .5) {
      z.screamed = true;
      z.screamUntil = now + SCREAM_MS;
    }
    if (z.health <= 0) {
      this.navigation.clear(z.navigation);
      z.dead = true;
      z.biteAt = 0;
      z.biteTarget = null;
      z.deadAt = now;
      z.health = 0;
      return { killed: true, broke, shield };
    }
    return { killed: false, broke, shield };
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
      if (!z.dead && now < z.screamUntil) flags |= EntityFlags.Screaming;
      if (!z.dead && (z.jumpWindupUntil > now || !z.state.grounded) && now < z.jumpingUntil) flags |= EntityFlags.Leaping;
      // Head pitch: looking up at prey on a roof or down at someone below.
      const t = z.target && !z.dead ? z.target.state : null;
      const pitch = t ? Math.max(-1, Math.min(1, Math.atan2(t.y + 1.5 - (z.state.y + 1.55 * zombieScale(z.variant)), Math.hypot(t.x - z.state.x, t.z - z.state.z) || .01))) : 0;
      out.push({ id: z.id, kind: EntityKind.Zombie, x: z.state.x, y: z.state.y, z: z.state.z, yaw: z.yaw, pitch, flags, health: Math.max(0, Math.round(z.health / z.maxHealth * 100)), weapon: z.limbs | (z.variant << 4), armor: packArmor({ ...z.armor, head: z.bucket > 0 ? ZOMBIE_BUCKET : z.armor.head }) });
    }
  }
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Brutes enrage below half health; ordinary zombies once they have screamed (below half); the rest below 30%. */
function enraged(z: Zombie): boolean {
  if (z.variant !== ZombieVariant.Brute && z.variant !== ZombieVariant.Crimson) return z.screamed;
  return z.health < z.maxHealth * (z.variant === ZombieVariant.Brute ? 0.5 : 0.3);
}

function dist2(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
