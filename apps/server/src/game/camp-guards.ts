import {
  CHUNK_SIZE, ENTITY_INTEREST_RADIUS_CHUNKS, EntityFlags, EntityKind, MUZZLE_HEIGHT,
  NPC_ID_BASE, TICK_DT, WeaponId, WEAPON_SPECS, type EntityState, type ShotEvent,
} from '@zion/shared';
import {
  CharacterController, HUMANOID_RIG, Mask, ZONE_DAMAGE_MULTIPLIER, createCharacterState, makeRayHit,
  type CharacterState, type CollisionWorld,
} from '@zion/physics';
import type { CampSite } from '@zion/worldgen';
import { castCombatRay, spreadDirection, type Combatant } from './combat';
import { PoseHistory, type Player } from './player';
import { MobBrain } from './mob-ai';
import { Zombie } from './zombies';

/** Flank the southern vehicle entrance, leaving its centre open. */
export const GUARD_POSTS = [{ x: -3, z: 47 }, { x: 3, z: 47 }, { x: -3, z: 43 }] as const;
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
  constructor(readonly id: number, x: number, y: number, z: number) {
    this.state = createCharacterState(x, y, z);
    this.brain = new MobBrain({ x, z, yaw: Math.PI, radius: PATROL_RADIUS, leash: RETREAT_LEASH });
  }
}

interface GuardHooks {
  shot(message: ShotEvent): void;
  hit(guard: CampGuard, zombie: Zombie, damage: number, zone: string,
    x: number, y: number, z: number, dx: number, dz: number, now: number): void;
}

/** Friendly sentries patrol the gate (driven by the mob AI) and only damage zombies. */
export class CampGuardDirector {
  readonly guards: CampGuard[];
  private readonly controller: CharacterController;
  private readonly sight = makeRayHit();

  constructor(private readonly camp: CampSite | null, private readonly collision: CollisionWorld, private readonly hooks: GuardHooks) {
    this.controller = new CharacterController(collision);
    this.guards = camp ? GUARD_POSTS.map((post, i) => new CampGuard(NPC_ID_BASE + i,
      camp.x + post.x, camp.y + 0.02, camp.z + post.z)) : [];
  }

  /** Moves the guard posts (Camp Studio): guards teleport to their new posts and guard them. */
  setPosts(posts: ReadonlyArray<{ x: number; z: number }>): void {
    const camp = this.camp;
    if (!camp) return;
    this.guards.forEach((g, i) => {
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
      const intent = guard.brain.think({ x: s.x, z: s.z, target: target?.state ?? null, threat }, now, TICK_DT);
      guard.yaw = intent.yaw;
      this.controller.step(s, { mx: intent.mx, mz: intent.mz, yaw: intent.yaw, jump: false, sprint: false }, TICK_DT);
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
      const hit = castCombatRay(guard, candidates, this.collision, now, undefined, s.x, oy, s.z, ax, ay, az, AK.range);
      const x = s.x + ax * hit.t, y = oy + ay * hit.t, z = s.z + az * hit.t;
      this.hooks.shot({ t: 'shot', shooterId: guard.id, w: WeaponId.AK47, ox: s.x, oy, oz: s.z, ends: [x, y, z] });
      if (hit.target instanceof Zombie && hit.zone) {
        this.hooks.hit(guard, hit.target, Math.round(AK.damage * ZONE_DAMAGE_MULTIPLIER[hit.zone]), hit.zone,
          x, y, z, ax, az, now);
      }
    }
  }

  entitiesFor(player: Player, out: EntityState[]): void {
    const range = CHUNK_SIZE * ENTITY_INTEREST_RADIUS_CHUNKS;
    for (const guard of this.guards) {
      const s = guard.state;
      if (!guard.active || Math.hypot(s.x - player.state.x, s.z - player.state.z) > range) continue;
      out.push({ id: guard.id, kind: EntityKind.Guard, x: s.x, y: s.y, z: s.z, yaw: guard.yaw, pitch: guard.pitch,
        flags: EntityFlags.Grounded, health: 100, weapon: WeaponId.AK47 });
    }
  }
}
