import { wrapAngle, CHUNK_SIZE, ENTITY_INTEREST_RADIUS_CHUNKS, EntityFlags, EntityKind, TICK_DT, type BaseLifeConfig, type EntityState } from '@zion/shared';
import { CharacterController, DEFAULT_CHARACTER, createCharacterState, type CollisionWorld, type RigPart } from '@zion/physics';
import type { CampSite } from '@zion/worldgen';
import { PoseHistory, type Player } from './player';
import type { AnimalRecord } from './base-life';
type AnimalDef = NonNullable<BaseLifeConfig['animals']>[number];
export class Livestock {
  readonly history = new PoseHistory();
  readonly rig: readonly RigPart[] = [{ zone: 'torso', a: [0, 0.5, -0.4], b: [0, 0.5, 0.4], r: 0.4 }, { zone: 'head', a: [0, 0.65, -0.65], b: [0, 0.65, -0.65], r: 0.25 }];
  readonly state;
  active = false;
  yaw = 0;
  private threat: Player | null = null;
  private retaliation = false;
  private alertUntil = 0;
  private attackAt = 0;
  private attackingUntil = 0;
  private controller: CharacterController;
  private goal: { x: number; z: number } | null = null;
  private goalAt = 0;
  private faceTo = 0;
  private running = false;
  private readonly home: { x: number; z: number };
  constructor(readonly id: number, readonly def: AnimalDef, private readonly camp: CampSite, readonly record: AnimalRecord, collision: CollisionWorld, private random = Math.random) {
    this.state = createCharacterState(record.x, record.y, record.z);
    this.home = { x: camp.x + def.x, z: camp.z + def.z };
    this.controller = new CharacterController(collision, { ...DEFAULT_CHARACTER, walkSpeed: def.speed, sprintSpeed: def.runSpeed });
  }
  get retaliating(): boolean { return !!this.threat && this.retaliation && !this.dead; }
  get dead(): boolean { return this.record.health <= 0; }
  hit(amount: number, attacker: Player, now: number): boolean {
    if (this.dead || amount <= 0) return false;
    this.record.health = Math.max(0, this.record.health - amount);
    this.threat = attacker;
    this.retaliation = this.random() < this.def.retaliation;
    this.alertUntil = now + 15_000;
    if (!this.dead) return false;
    this.record.diedAt = now;
    this.record.loot = this.def.lootMin + Math.floor(this.random() * (this.def.lootMax - this.def.lootMin + 1));
    return true;
  }
  /** Camp-local pen bounds in world space (defaults to a square of `wanderRadius` around home). */
  private bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    const pen = this.def.pen;
    if (pen) return { minX: this.camp.x + pen.minX, maxX: this.camp.x + pen.maxX, minZ: this.camp.z + pen.minZ, maxZ: this.camp.z + pen.maxZ };
    const r = this.def.wanderRadius;
    return { minX: this.home.x - r, maxX: this.home.x + r, minZ: this.home.z - r, maxZ: this.home.z + r };
  }

  /** A random spot inside the pen (keeps clear of the fence). */
  randomSpot(): { x: number; z: number } {
    const b = this.bounds();
    return { x: b.minX + 0.5 + this.random() * Math.max(0, b.maxX - b.minX - 1), z: b.minZ + 0.5 + this.random() * Math.max(0, b.maxZ - b.minZ - 1) };
  }

  /** Back to life at a random spot in the pen. */
  respawn(): void {
    const spot = this.randomSpot();
    this.record.health = this.def.health;
    this.record.loot = 0;
    delete this.record.diedAt;
    this.state.x = this.record.x = spot.x;
    this.state.z = this.record.z = spot.z;
    this.state.vx = this.state.vz = 0;
    this.threat = null;
    this.goal = null;
  }

  step(now: number, attack: (target: Player, amount: number) => void): void {
    this.active = this.controller.canSimulateAt(this.state.x, this.state.z);
    if (!this.active) return;
    const s = this.state;
    if (!this.dead) {
      let target = this.threat;
      if (target && (!target.active || !target.session.open || target.dead || now >= this.alertUntil || Math.hypot(s.x - target.state.x, s.z - target.state.z) > this.def.range)) target = this.threat = null;
      const b = this.bounds();
      let moveX = 0;
      let moveZ = 0;
      let run = false;
      if (target && this.retaliation) {
        // Charge the attacker (only as far as the pen lets it).
        const dx = target.state.x - s.x, dz = target.state.z - s.z;
        const distance = Math.hypot(dx, dz) || 1;
        this.faceTo = Math.atan2(-dx, -dz);
        if (distance > this.def.attackRange * 0.8) { moveX = dx / distance; moveZ = dz / distance; run = true; }
        if (distance <= this.def.attackRange && Math.abs(target.state.y - s.y) < 2 && now >= this.attackAt) {
          this.attackAt = now + this.def.attackMs;
          this.attackingUntil = now + 500;
          attack(target, this.def.damage);
        }
      } else if (target) {
        // Flee: run to the spot of the pen furthest from the attacker, re-picked as it moves.
        if (!this.goal || now >= this.goalAt) {
          let best = -1;
          for (let i = 0; i < 6; i++) {
            const c = this.randomSpot();
            const d = Math.hypot(c.x - target.state.x, c.z - target.state.z);
            if (d > best) { best = d; this.goal = c; }
          }
          this.goalAt = now + 900;
        }
        run = true;
      } else if (!this.goal && now >= this.goalAt) {
        // Graze: stroll to a random spot, then stand a while.
        this.goal = this.randomSpot();
      }
      if (this.goal && !(target && this.retaliation)) {
        const dx = this.goal.x - s.x, dz = this.goal.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.5) {
          this.goal = null;
          if (!target) this.goalAt = now + 2500 + this.random() * 5000;
        } else {
          moveX = dx / d; moveZ = dz / d;
          this.faceTo = Math.atan2(-dx, -dz);
        }
      }
      // Turn smoothly; walk forward along the facing once roughly lined up.
      const diff = wrapAngle(this.faceTo - this.yaw);
      const turn = (run ? 8 : 3.5) * TICK_DT;
      this.yaw = wrapAngle(this.yaw + Math.max(-turn, Math.min(turn, diff)));
      const moving = (moveX !== 0 || moveZ !== 0) && Math.abs(diff) < 1.2;
      this.controller.step(s, { mx: 0, mz: moving ? 1 : 0, yaw: this.yaw, jump: false, sprint: run }, TICK_DT);
      // The fence is the pen's edge: never leave it.
      s.x = Math.max(b.minX, Math.min(b.maxX, s.x));
      s.z = Math.max(b.minZ, Math.min(b.maxZ, s.z));
      this.running = run && moving;
      this.record.x = s.x; this.record.y = s.y; this.record.z = s.z;
    }
    this.history.push(now, s.x, s.y, s.z, this.yaw);
  }
  entity(now: number): EntityState {
    return { id: this.id, kind: EntityKind.Animal, x: this.state.x, y: this.state.y, z: this.state.z, yaw: this.yaw, pitch: 0, weapon: 0, health: this.record.health, flags: EntityFlags.Grounded | (this.dead ? EntityFlags.Dead : this.running ? EntityFlags.Sprinting : 0) | (now < this.attackingUntil ? EntityFlags.Attacking : 0) };
  }
  visible(p: Player): boolean { return this.active && Math.hypot(p.state.x - this.state.x, p.state.z - this.state.z) < CHUNK_SIZE * ENTITY_INTEREST_RADIUS_CHUNKS; }
}
