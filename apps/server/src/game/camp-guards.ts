import {
  CHUNK_SIZE, ENTITY_INTEREST_RADIUS_CHUNKS, EntityFlags, EntityKind, MUZZLE_HEIGHT,
  NPC_ID_BASE, TICK_DT, WeaponId, WEAPON_SPECS, advanceBallistic, bulletSpec,
  type BallisticState, type EntityState, type ShotEvent, type ProjectileEvent, type ProjectileEndEvent,
} from '@zion/shared';
import {
  CharacterController, HUMANOID_RIG, Mask, ZONE_DAMAGE_MULTIPLIER, createCharacterState, makeRayHit,
  type CharacterState, type CollisionWorld,
} from '@zion/physics';
import { CAMP_HALF_SIZE, DEFAULT_CAMP_NPCS, type CampSite } from '@zion/worldgen';
import { castCombatRay, spreadDirection, type Combatant } from './combat';
import { PoseHistory, type Player } from './player';
import { MobBrain } from './mob-ai';
import { Zombie } from './zombies';
import { ZombieNavigation } from './navigation';
import { CampPatrol } from './camp-patrol';

/** Flank the southern vehicle entrance, leaving its centre open. */
export const GUARD_POSTS = DEFAULT_CAMP_NPCS.guards;
const PATROL_STARTS = [-30, -10, 10, 25] as const;
const WATCH_RANGE = 32;
/** Guards stroll around the gate within this radius of their post. */
const PATROL_RADIUS = 4.5;
/** How far a guard may back away from its post when a zombie closes in. */
const RETREAT_LEASH = 12;
const AK = WEAPON_SPECS[WeaponId.AK47];
if (AK.kind !== 'gun') throw new Error('camp guards require an AK-47');

export class CampGuard {
  readonly history = new PoseHistory();
  readonly rig = HUMANOID_RIG;
  readonly dead = false;
  active = false;
  yaw = Math.PI;
  pitch = 0;
  fireAt = 0;
  rounds = 30;
  reloadUntil = 0;
  readonly state: CharacterState;
  readonly brain: MobBrain;
  constructor(readonly id: number, x: number, y: number, z: number, readonly patrol?: CampPatrol) {
    this.state = createCharacterState(x, y, z);
    this.brain = new MobBrain({ x, z, yaw: Math.PI, radius: PATROL_RADIUS, leash: RETREAT_LEASH });
  }
}

interface GuardHooks {
  shot(message: ShotEvent): void;
  projectile?(message: ProjectileEvent): void;
  projectileEnd?(message: ProjectileEndEvent): void;
  hit(guard: CampGuard, zombie: Zombie, damage: number, zone: string,
    x: number, y: number, z: number, dx: number, dz: number, now: number): void;
}

/** Gate sentries and four roaming camp guards only damage zombies. */
export class CampGuardDirector {
  private nextRoundId = 0x60000000;
  private readonly flying: Array<BallisticState & { id: number; guard: CampGuard; traveled: number }> = [];
  readonly guards: CampGuard[];
  private readonly controller: CharacterController;
  private readonly sight = makeRayHit();
  private readonly navigation: ZombieNavigation;

  constructor(private readonly camp: CampSite | null, private readonly collision: CollisionWorld, private readonly hooks: GuardHooks) {
    this.controller = new CharacterController(collision);
    this.navigation = new ZombieNavigation(collision);
    this.guards = camp ? GUARD_POSTS.map((post, i) => new CampGuard(NPC_ID_BASE + i,
      camp.x + post.x, camp.y + 0.02, camp.z + post.z)) : [];
    if (camp) PATROL_STARTS.forEach((z, i) => this.guards.push(new CampGuard(NPC_ID_BASE + GUARD_POSTS.length + i,
      camp.x, camp.y + .02, camp.z + z, new CampPatrol(camp))));
  }

  /** Moves the guard posts (Camp Studio): guards teleport to their new posts and guard them. */
  setPosts(posts: ReadonlyArray<{ x: number; z: number }>): void {
    const camp = this.camp;
    if (!camp) return;
    this.guards.forEach((g, i) => {
      if (g.patrol) return;
      const post = posts[i] ?? GUARD_POSTS[i]!;
      const x = camp.x + post.x;
      const z = camp.z + post.z;
      g.state.x = x;
      g.state.z = z;
      g.state.y = camp.y + 0.02;
      g.state.vx = g.state.vy = g.state.vz = 0;
      g.brain.home.x = x;
      g.brain.home.z = z;
    });
  }

  step(zombies: Iterable<Zombie>, players: readonly Player[], now: number): void {
    if (AK.kind !== 'gun') return;
    this.navigation.beginTick();
    const living = [...zombies].filter(z => !z.dead);
    for (const guard of this.guards) {
      const s = guard.state;
      guard.active = this.controller.canSimulateAt(s.x, s.z) && this.controller.isFree(s.x, s.y, s.z);
      guard.history.push(now, s.x, s.y, s.z, guard.yaw);
    }
    const candidates: Combatant[] = [...living, ...players, ...this.guards];
    for (const guard of this.guards) {
      if (!guard.active) continue;
      if (guard.reloadUntil && now >= guard.reloadUntil) {
        guard.rounds = AK.magazine;
        guard.reloadUntil = 0;
      }
      const s = guard.state;
      const oy = s.y + MUZZLE_HEIGHT;
      let target: Zombie | null = null;
      let best = WATCH_RANGE;
      for (const zombie of living) {
        if (zombie.dead) continue;
        const t = zombie.state;
        const d = Math.hypot(t.x - s.x, t.y - s.y, t.z - s.z);
        if (d >= best || !this.collision.isAreaLoaded(Math.min(s.x, t.x), Math.min(s.z, t.z),
          Math.max(s.x, t.x), Math.max(s.z, t.z))) continue;
        if (!this.collision.lineOfSight(s.x, oy, s.z, t.x, t.y + 1, t.z, Mask.LineOfSight, this.sight)) continue;
        target = zombie;
        best = d;
      }
      let threat: { x: number; z: number; distance: number } | null = null;
      for (const zombie of living) {
        const d = Math.hypot(zombie.state.x - s.x, zombie.state.z - s.z);
        if (!threat || d < threat.distance) threat = { x: zombie.state.x, z: zombie.state.z, distance: d };
      }
      const intent = guard.patrol && !target && (!threat || threat.distance >= 9)
        ? guard.patrol.think(s, guard.yaw, now, TICK_DT, this.navigation)
        : guard.brain.think({ x: s.x, z: s.z, target: target?.state ?? null, threat }, now, TICK_DT);
      guard.brain.yaw = intent.yaw;
      guard.yaw = intent.yaw;
      const oldX = s.x, oldZ = s.z;
      this.controller.step(s, { mx: intent.mx, mz: intent.mz, yaw: intent.yaw, jump: false, sprint: false }, TICK_DT);
      if (guard.patrol && this.camp && Math.max(Math.abs(s.x - this.camp.x), Math.abs(s.z - this.camp.z)) > CAMP_HALF_SIZE - 1) {
        s.x = oldX; s.z = oldZ; s.vx = s.vz = 0;
      }
      if (s.swimming) { guard.pitch = 0; continue; }
      if (!target) { guard.pitch = 0; continue; }
      const dx = target.state.x - s.x;
      const dy = target.state.y + 1 - oy;
      const dz = target.state.z - s.z;
      const length = Math.hypot(dx, dy, dz) || 1;
      guard.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      if (!intent.aimed) continue;
      if (now < guard.fireAt || guard.reloadUntil) continue;
      guard.fireAt = now + AK.fireMs;
      guard.rounds--;
      if (guard.rounds === 0) guard.reloadUntil = now + AK.reloadMs;
      const [ax, ay, az] = spreadDirection(dx / length, dy / length, dz / length, AK.spread, Math.random);
      const spec = bulletSpec(WeaponId.AK47, AK);
      const r = { id: this.nextRoundId++, guard, traveled: 0, x: s.x, y: oy, z: s.z, vx: ax * spec.speed, vy: ay * spec.speed, vz: az * spec.speed };
      this.flying.push(r);
      this.hooks.shot({ t: 'shot', shooterId: guard.id, w: WeaponId.AK47, ox: s.x, oy, oz: s.z, ends: [] });
      this.hooks.projectile?.({ t: 'proj', id: r.id, ownerId: guard.id, w: WeaponId.AK47, kind: 'bullet', x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, vz: r.vz, gravity: spec.gravity, drag: spec.drag, maxFlightSec: spec.maxFlightSec });
    }
    const spec = bulletSpec(WeaponId.AK47, AK);
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const r = this.flying[i]!;
      const ox = r.x, oy = r.y, oz = r.z;
      advanceBallistic(r, spec.gravity, spec.drag ?? 0, TICK_DT);
      const dx = r.x - ox, dy = r.y - oy, dz = r.z - oz;
      const distance = Math.hypot(dx, dy, dz) || 1e-6;
      const length = Math.min(distance, AK.range - r.traveled);
      const hit = castCombatRay(r.guard, candidates, this.collision, now, undefined, ox, oy, oz, dx / distance, dy / distance, dz / distance, length);
      r.x = ox + dx / distance * hit.t; r.y = oy + dy / distance * hit.t; r.z = oz + dz / distance * hit.t;
      r.traveled += hit.t;
      if (!hit.target && hit.t >= length - 1e-4 && r.traveled < AK.range - 1e-4) continue;
      this.flying.splice(i, 1);
      this.hooks.projectileEnd?.({ t: 'projEnd', id: r.id, x: r.x, y: r.y, z: r.z, hit: !!hit.target, impact: !!hit.target || hit.t < length - 1e-4, normal: hit.normal });
      if (hit.target instanceof Zombie && hit.zone) this.hooks.hit(r.guard, hit.target,
        Math.round(AK.damage * ZONE_DAMAGE_MULTIPLIER[hit.zone]), hit.zone, r.x, r.y, r.z, dx / distance, dz / distance, now);
    }
  }

  entitiesFor(player: Player, out: EntityState[]): void {
    const range = CHUNK_SIZE * ENTITY_INTEREST_RADIUS_CHUNKS;
    for (const guard of this.guards) {
      const s = guard.state;
      if (!guard.active || Math.hypot(s.x - player.state.x, s.z - player.state.z) > range) continue;
      out.push({ id: guard.id, kind: EntityKind.Guard, x: s.x, y: s.y, z: s.z, yaw: guard.yaw, pitch: guard.pitch,
        flags: (s.grounded ? EntityFlags.Grounded : 0) | (s.swimming ? EntityFlags.Swimming : 0), health: 100, weapon: WeaponId.AK47 });
    }
  }
}
