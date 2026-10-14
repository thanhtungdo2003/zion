import { BATTLE_MAP, BATTLE_FLIGHT, battlePlaneAt, Rng, clamp, type BattleCircle, type BattleState } from '@zion/shared';

// Long enough to land, loot a house or two and move before the first circle closes.
export const BATTLE_STAGES = [
  { ratio: .72, wait: 180_000, shrink: 120_000, damage: 1 },
  { ratio: .48, wait: 120_000, shrink: 90_000, damage: 2 },
  { ratio: .29, wait: 90_000, shrink: 75_000, damage: 4 },
  { ratio: .15, wait: 75_000, shrink: 60_000, damage: 7 },
  { ratio: .06, wait: 60_000, shrink: 50_000, damage: 12 },
  { ratio: 0, wait: 45_000, shrink: 40_000, damage: 20 },
] as const;

/** Match clock and elimination rules, independent of physics and persistent survival characters. */
export class BattleRoyaleMatch {
  phase: BattleState['phase'] = 'waiting';
  readonly entrants = new Map<number, string>();
  readonly eliminated = new Map<number, number>();
  circle: BattleCircle;
  nextCircle: BattleCircle;
  private from: BattleCircle;
  private deadline = 0;
  private shrinkStartedAt = 0;
  private stage = 0;
  private shrinking = false;
  private winner: BattleState['winner'] = null;
  private readonly rng: Rng;
  private readonly initialRadius: number;
  startedAt: number | null = null;

  constructor(seed: number, private readonly size: number) {
    this.rng = new Rng(seed);
    this.initialRadius = size * .68;
    this.circle = { x: size / 2, z: size / 2, radius: this.initialRadius };
    this.from = { ...this.circle }; this.nextCircle = { ...this.circle };
  }
  get accepting(): boolean { return (this.phase === 'waiting' || this.phase === 'countdown') && this.entrants.size < BATTLE_MAP.maxPlayers; }
  get alive(): number { return this.entrants.size - this.eliminated.size; }
  join(id: number, name: string): boolean {
    if (!this.accepting || this.entrants.has(id)) return false;
    this.entrants.set(id, name); return true;
  }
  leave(id: number): void {
    if (this.phase === 'running') this.eliminate(id);
    else if (this.phase !== 'finished') this.entrants.delete(id);
  }
  eliminate(id: number): void {
    if (this.phase !== 'running' || !this.entrants.has(id) || this.eliminated.has(id)) return;
    this.eliminated.set(id, this.alive);
  }
  canFight(id: number): boolean { return this.phase === 'running' && this.entrants.has(id) && !this.eliminated.has(id); }
  private plan(now: number): void {
    const settings = BATTLE_STAGES[this.stage]!;
    const radius = this.initialRadius * settings.ratio;
    const angle = this.rng.next() * Math.PI * 2;
    // All later safe circles stay on dry central land and inside their predecessor.
    const travel = Math.min(this.circle.radius - radius, this.initialRadius * .12) * Math.sqrt(this.rng.next());
    this.nextCircle = { x: clamp(this.circle.x + Math.cos(angle) * travel, this.size * .3, this.size * .7), z: clamp(this.circle.z + Math.sin(angle) * travel, this.size * .3, this.size * .7), radius };
    this.from = { ...this.circle }; this.shrinking = false; this.deadline = now + settings.wait;
  }
  tick(now: number): void {
    if (this.phase === 'waiting' && this.alive >= BATTLE_MAP.minPlayers) { this.phase = 'countdown'; this.deadline = now + 30_000; }
    if (this.phase === 'countdown') {
      if (this.alive < BATTLE_MAP.minPlayers) { this.phase = 'waiting'; this.deadline = 0; }
      else if (now >= this.deadline) { this.phase = 'running'; this.startedAt = now; this.plan(now + BATTLE_FLIGHT.durationMs); }
    }
    if (this.phase !== 'running') return;
    if (this.alive <= 1) {
      const survivor = [...this.entrants].find(([id]) => !this.eliminated.has(id));
      this.winner = survivor ? { id: survivor[0], name: survivor[1] } : null;
      this.phase = 'finished'; this.deadline = now + 30_000; return;
    }
    if (!this.shrinking && now >= this.deadline) {
      this.shrinking = true; this.shrinkStartedAt = now; this.deadline = now + BATTLE_STAGES[this.stage]!.shrink;
    }
    if (this.shrinking) {
      const fraction = Math.min(1, (now - this.shrinkStartedAt) / BATTLE_STAGES[this.stage]!.shrink);
      this.circle = { x: this.from.x + (this.nextCircle.x - this.from.x) * fraction, z: this.from.z + (this.nextCircle.z - this.from.z) * fraction, radius: this.from.radius + (this.nextCircle.radius - this.from.radius) * fraction };
      if (fraction === 1 && this.stage < BATTLE_STAGES.length - 1) { this.stage++; this.plan(now); }
    }
  }
  outside(x: number, z: number): boolean { return Math.hypot(x - this.circle.x, z - this.circle.z) >= this.circle.radius; }
  state(now: number, id?: number): BattleState {
    return { t: 'battle', phase: this.phase, map: BATTLE_MAP.name, alive: this.alive, total: this.entrants.size, stage: this.stage + 1, shrinking: this.shrinking, remainingMs: Math.max(0, this.deadline - now), circle: { ...this.circle }, nextCircle: { ...this.nextCircle }, damagePerSecond: BATTLE_STAGES[this.stage]!.damage, winner: this.winner, placement: id === this.winner?.id ? 1 : id === undefined ? undefined : this.eliminated.get(id), plane: this.startedAt !== null && now - this.startedAt < BATTLE_FLIGHT.durationMs && this.phase === 'running' ? battlePlaneAt(this.size, now - this.startedAt) : undefined };
  }
}
