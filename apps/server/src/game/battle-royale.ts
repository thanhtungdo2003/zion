import { BATTLE_MAP, BATTLE_FLIGHT, BATTLE_COUNTDOWN_MS, BATTLE_INITIAL_RADIUS, BATTLE_LOBBY_WAIT_MS, BATTLE_STAGES, battlePlaneAt, Rng, clamp, type BattleCircle, type BattleState } from '@zion/shared';

export { BATTLE_LOBBY_WAIT_MS, BATTLE_STAGES } from '@zion/shared';

/** Match clock and elimination rules, independent of physics and persistent survival characters. */
export class BattleRoyaleMatch {
  phase: BattleState['phase'] = 'waiting';
  readonly entrants = new Map<number, string>();
  readonly eliminated = new Map<number, number>();
  /** Squad of each entrant who dropped in with a team (team id → name in `squadNames`). */
  readonly squads = new Map<number, string>();
  readonly squadNames = new Map<string, string>();
  /** Players per squad in this match: 1 solo, 2 or 3 once a squad of that size drops in. */
  squadSize = 1;
  circle: BattleCircle;
  nextCircle: BattleCircle;
  /** The ring everyone waits in before the drop (chosen by the server when the first player comes). */
  lobby: BattleCircle | null = null;
  private from: BattleCircle;
  private deadline = 0;
  private shrinkStartedAt = 0;
  private stage = 0;
  private shrinking = false;
  private winner: BattleState['winner'] = null;
  private readonly rng: Rng;
  private readonly initialRadius: number;
  startedAt: number | null = null;
  /** When the first player entered the lobby (null while it is empty). */
  private lobbySince: number | null = null;
  /** The countdown began on the lobby timeout, short of players. */
  private forced = false;

  /** `isLand`: dry-ground test; safe circles are drawn at random over land. */
  constructor(seed: number, private readonly size: number, private readonly isLand: (x: number, z: number) => boolean = () => true) {
    this.rng = new Rng(seed);
    this.initialRadius = size * BATTLE_INITIAL_RADIUS;
    this.circle = { x: size / 2, z: size / 2, radius: this.initialRadius };
    this.from = { ...this.circle }; this.nextCircle = { ...this.circle };
  }
  get accepting(): boolean { return (this.phase === 'waiting' || this.phase === 'countdown') && this.entrants.size < BATTLE_MAP.maxPlayers; }
  get alive(): number { return this.entrants.size - this.eliminated.size; }
  /** Sides still in the fight: each squad counts once, solo players on their own. */
  get aliveSides(): number {
    const sides = new Set<string | number>();
    for (const id of this.entrants.keys()) if (!this.eliminated.has(id)) sides.add(this.squads.get(id) ?? id);
    return sides.size;
  }
  allies(a: number, b: number): boolean { const s = this.squads.get(a); return a !== b && s !== undefined && s === this.squads.get(b); }
  join(id: number, name: string, squad?: { id: string; name: string; size?: number }): boolean {
    if (!this.accepting || this.entrants.has(id)) return false;
    this.entrants.set(id, name);
    if (squad) { this.squads.set(id, squad.id); this.squadNames.set(squad.id, squad.name); this.squadSize = Math.max(this.squadSize, Math.min(3, squad.size ?? 1)); }
    return true;
  }
  leave(id: number): void {
    if (this.phase === 'running') this.eliminate(id);
    else if (this.phase !== 'finished') { this.entrants.delete(id); this.squads.delete(id); }
  }
  eliminate(id: number): void {
    // Out before the drop (a bot killed in the lobby): no longer an entrant at all. Otherwise it
    // would stay "alive" in the count for the whole match and the match could never end.
    if (this.phase === 'waiting' || this.phase === 'countdown') { this.entrants.delete(id); this.squads.delete(id); return; }
    if (this.phase !== 'running' || !this.entrants.has(id) || this.eliminated.has(id)) return;
    // Placement counts sides: a squad member out while the squad still fights shares its fate.
    this.eliminated.set(id, this.aliveSides);
  }
  canFight(id: number): boolean { return this.phase === 'running' && this.entrants.has(id) && !this.eliminated.has(id); }
  private plan(now: number): void {
    const settings = BATTLE_STAGES[this.stage]!;
    const radius = this.initialRadius * settings.ratio;
    // Random spot inside the current circle; of a few candidates keep the one with the most land
    // (centre on land first), so the zone ends up anywhere on the island, never out at sea.
    const room = Math.max(0, this.circle.radius - radius);
    let best: BattleCircle | null = null, bestScore = -1;
    for (let i = 0; i < 24; i++) {
      const angle = this.rng.next() * Math.PI * 2, travel = room * Math.sqrt(this.rng.next());
      const edge = Math.min(radius, this.size * .45);
      const x = clamp(this.circle.x + Math.cos(angle) * travel, edge, this.size - edge), z = clamp(this.circle.z + Math.sin(angle) * travel, edge, this.size - edge);
      const score = this.landShare(x, z, radius) + (this.isLand(x, z) ? 1 : 0);
      if (score > bestScore) { best = { x, z, radius }; bestScore = score; }
      if (score >= 1.85) break;
    }
    this.nextCircle = best!;
    this.from = { ...this.circle }; this.shrinking = false; this.deadline = now + settings.wait;
  }
  /** Fraction of sample points within the circle that are on land. */
  private landShare(x: number, z: number, radius: number): number {
    let land = 0, total = 0;
    for (const r of [0, .35, .7]) for (let k = 0; k < (r ? 8 : 1); k++) {
      const a = k / 8 * Math.PI * 2; total++;
      if (this.isLand(x + Math.cos(a) * r * radius, z + Math.sin(a) * r * radius)) land++;
    }
    return land / total;
  }
  /**
   * `humans`: real players in the match (bots never count towards starting it). The countdown
   * starts once enough people are in, or after BATTLE_LOBBY_WAIT_MS with whoever came.
   */
  tick(now: number, humans = this.alive): void {
    if (this.phase === 'waiting') {
      if (!humans) this.lobbySince = null;
      else this.lobbySince ??= now;
      this.deadline = this.lobbySince === null ? 0 : this.lobbySince + BATTLE_LOBBY_WAIT_MS;
      if (humans >= BATTLE_MAP.minPlayers || (humans > 0 && now >= this.deadline)) { this.forced = humans < BATTLE_MAP.minPlayers; this.phase = 'countdown'; this.deadline = now + BATTLE_COUNTDOWN_MS; }
    }
    if (this.phase === 'countdown') {
      // Someone left before the drop: back to the lobby (a lobby that timed out keeps going while anyone is in).
      if (!humans || (humans < BATTLE_MAP.minPlayers && !this.forced)) { this.phase = 'waiting'; this.deadline = 0; if (!humans) this.lobbySince = null; }
      else if (now >= this.deadline) { this.phase = 'running'; this.startedAt = now; this.plan(now + BATTLE_FLIGHT.durationMs); }
    }
    if (this.phase !== 'running') return;
    if (this.aliveSides <= 1) {
      const survivor = [...this.entrants].find(([id]) => !this.eliminated.has(id));
      const squad = survivor ? this.squads.get(survivor[0]) : undefined;
      this.winner = survivor ? { id: survivor[0], name: squad ? this.squadNames.get(squad) ?? survivor[1] : survivor[1], ...(squad ? { squad } : {}) } : null;
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
  /** Every entrant's place so far: those out by the place they went out at, the winning side 1. */
  placements(): Record<number, number> {
    const out: Record<number, number> = {};
    for (const [id, place] of this.eliminated) out[id] = place;
    if (this.phase === 'finished') for (const id of this.entrants.keys()) {
      const squad = this.squads.get(id);
      if (!this.eliminated.has(id) || (squad !== undefined && squad === this.winner?.squad)) out[id] = 1;
    }
    return out;
  }
  /** Waiting or counting down: everyone is held in the lobby and nobody can be hurt. */
  get inLobby(): boolean { return this.phase === 'waiting' || this.phase === 'countdown'; }
  outside(x: number, z: number): boolean { return Math.hypot(x - this.circle.x, z - this.circle.z) >= this.circle.radius; }
  state(now: number, id?: number): BattleState {
    return { t: 'battle', phase: this.phase, map: BATTLE_MAP.name, alive: this.alive, total: this.entrants.size, stage: this.stage + 1, shrinking: this.shrinking, remainingMs: Math.max(0, this.deadline - now), circle: { ...this.circle }, nextCircle: { ...this.nextCircle }, damagePerSecond: BATTLE_STAGES[this.stage]!.damage, winner: this.winner, placement: id !== undefined && (id === this.winner?.id || (this.winner?.squad !== undefined && this.squads.get(id) === this.winner.squad)) ? 1 : id === undefined ? undefined : this.eliminated.get(id), plane: this.startedAt !== null && now - this.startedAt < BATTLE_FLIGHT.durationMs && this.phase === 'running' ? battlePlaneAt(this.size, now - this.startedAt) : undefined, ...(id !== undefined && (this.phase === 'finished' || this.eliminated.has(id)) ? { placements: this.placements() } : {}), ...(this.inLobby && this.lobby ? { lobby: { ...this.lobby }, lobbyNames: [...this.entrants.values()] } : {}) };
  }
}
