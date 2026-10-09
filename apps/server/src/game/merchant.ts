import { CHUNK_SIZE, ENTITY_INTEREST_RADIUS_CHUNKS, EntityFlags, type EntityKind, TICK_DT, WeaponId, wrapAngle, type EntityState } from '@zion/shared';
import { CharacterController, createCharacterState, type CharacterState, type CollisionWorld } from '@zion/physics';
import { MobBrain } from './mob-ai';
import type { CampSite } from '@zion/worldgen';
import type { Player } from './player';

const TURN_RATE = 3;
const GREET_RANGE = 7;

/**
 * A camp service NPC (weapon merchant, field medic): stands at a fixed stall, turns to face the
 * nearest player, and is where the matching trades are accepted (range checked by the server).
 */
export class CampNpc {
  x = 0;
  y = 0;
  z = 0;
  yaw = Math.PI;
  private placed = false;
  private readonly controller: CharacterController;

  constructor(
    readonly id: number,
    readonly kind: EntityKind,
    private readonly camp: CampSite | null,
    /** Camp-local stall position. */
    private stall: { x: number; z: number },
    collision: CollisionWorld,
    /** Weapon shown in hand, and a patrol radius (> 0: strolls around the post like the gate guards). */
    private readonly opts: { weapon?: number; patrol?: number } = {},
  ) {
    this.controller = new CharacterController(collision);
  }

  private walker: { state: CharacterState; brain: MobBrain } | null = null;
  /** Shot at by a player: draws a shotgun and fires back at them until `until`. */
  aggro: { target: Player; until: number; fired?: boolean } | null = null;
  fireAt = 0;
  sayAt = 0;

  get active(): boolean {
    return this.placed;
  }

  /** Places the NPC once the camp's physics is loaded (returns true that tick), then greets players. */
  step(players: readonly Player[], dt: number): boolean {
    const camp = this.camp;
    if (!camp) return false;
    if (!this.placed) {
      const sx = camp.x + this.stall.x;
      const sz = camp.z + this.stall.z;
      if (!this.controller.canSimulateAt(sx, sz)) return false;
      // The stall spot itself, or the nearest free spot around it.
      for (let r = 0; r <= 6 && !this.placed; r += 0.5) {
        const n = Math.max(1, Math.round(r * 8));
        for (let a = 0; a < n && !this.placed; a++) {
          const ang = (a / n) * Math.PI * 2;
          const x = sx + Math.cos(ang) * r;
          const z = sz + Math.sin(ang) * r;
          if (!this.controller.isFree(x, camp.y + 0.02, z)) continue;
          this.x = x;
          this.y = camp.y + 0.02;
          this.z = z;
          this.placed = true;
        }
      }
      if (this.placed && (this.opts.patrol ?? 0) > 0) {
        this.walker = { state: createCharacterState(this.x, this.y, this.z), brain: new MobBrain({ x: this.x, z: this.z, yaw: Math.PI, radius: this.opts.patrol!, leash: this.opts.patrol! * 2 }) };
      }
      return this.placed;
    }
    if (this.walker) {
      // Patrol: stroll around the post; stop and face anyone who comes to talk.
      const near = players.find((p) => !p.dead && Math.hypot(p.state.x - this.x, p.state.z - this.z) < 3.5);
      const s = this.walker.state;
      const intent = this.walker.brain.think({ x: s.x, z: s.z, target: near ? { x: near.state.x, z: near.state.z } : null, threat: null }, Date.now(), TICK_DT);
      this.controller.step(s, { mx: intent.mx, mz: intent.mz, yaw: intent.yaw, jump: false, sprint: false }, TICK_DT);
      this.x = s.x; this.y = s.y; this.z = s.z;
      this.yaw = intent.yaw;
      return false;
    }
    if (this.aggro) {
      // Fighting back: keep facing the attacker.
      const t = this.aggro.target;
      const want = Math.atan2(-(t.state.x - this.x), -(t.state.z - this.z));
      const d = wrapAngle(want - this.yaw);
      const m = TURN_RATE * 3 * dt;
      this.yaw = wrapAngle(this.yaw + Math.max(-m, Math.min(m, d)));
      return false;
    }
    let best: Player | null = null;
    let bd = GREET_RANGE;
    for (const p of players) {
      if (p.dead) continue;
      const d = Math.hypot(p.state.x - this.x, p.state.z - this.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    const want = best ? Math.atan2(-(best.state.x - this.x), -(best.state.z - this.z)) : Math.PI;
    const diff = wrapAngle(want - this.yaw);
    const max = TURN_RATE * dt;
    if (diff !== 0) this.yaw = wrapAngle(this.yaw + Math.max(-max, Math.min(max, diff)));
    return false;
  }

  /** Moves the stall (Camp Studio): the NPC is re-placed at the new spot on the next tick. */
  setStall(stall: { x: number; z: number }): void {
    this.stall = { ...stall };
    this.placed = false;
    this.walker = null;
  }

  inReach(p: Player, reach: number): boolean {
    return this.placed && Math.hypot(p.state.x - this.x, p.state.z - this.z) <= reach;
  }

  entitiesFor(player: Player, out: EntityState[]): void {
    if (!this.placed) return;
    const range = CHUNK_SIZE * ENTITY_INTEREST_RADIUS_CHUNKS;
    if (Math.hypot(this.x - player.state.x, this.z - player.state.z) > range) return;
    out.push({ id: this.id, kind: this.kind, x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: 0, flags: EntityFlags.Grounded, health: 100, weapon: this.aggro ? WeaponId.Shotgun : (this.opts.weapon ?? 0) });
  }
}

