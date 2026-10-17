import { INFECTION, INFECTION_MAP, type InfectionState } from '@zion/shared';

/** What changed in one tick, for the game server to act on. */
export interface InfectionEvents {
  /** A new round begins (countdown): everyone back to human, back to a spawn point. */
  reset?: boolean;
  /** The round is live: these entrants were just turned (patient zero). */
  outbreak?: number[];
  /** The round was just decided. */
  finished?: 'humans' | 'zombies';
}

/**
 * Infection round rules, independent of physics: entrants, who is a zombie, the round clock and
 * the win conditions. Humans never hurt humans, zombies never hurt zombies.
 */
export class InfectionMatch {
  phase: InfectionState['phase'] = 'waiting';
  round = 0;
  readonly entrants = new Map<number, string>();
  readonly zombies = new Set<number>();
  /** Zombies waiting to rise again (id → server time). */
  readonly respawnAt = new Map<number, number>();
  private deadline = 0;
  private outbreakAt = 0;
  private outbroke = false;
  private winner: InfectionState['winner'] = null;

  constructor(private readonly random: () => number = Math.random) {}

  get accepting(): boolean { return this.entrants.size < INFECTION_MAP.maxPlayers; }
  get humans(): number { let n = 0; for (const id of this.entrants.keys()) if (!this.zombies.has(id)) n++; return n; }
  /** Someone joining now starts as a zombie (the outbreak already happened). */
  get joinsAsZombie(): boolean { return this.phase === 'running' && this.outbroke; }

  isZombie(id: number): boolean { return this.zombies.has(id); }
  allies(a: number, b: number): boolean { return a !== b && this.entrants.has(a) && this.entrants.has(b) && this.zombies.has(a) === this.zombies.has(b); }
  canFight(id: number): boolean { return this.phase === 'running' && this.entrants.has(id); }
  /** `a` may hurt `b`: one zombie and one human while the round is live. */
  canHarm(a: number, b: number): boolean { return a !== b && this.canFight(a) && this.canFight(b) && this.zombies.has(a) !== this.zombies.has(b); }

  join(id: number, name: string): boolean {
    if (!this.accepting || this.entrants.has(id)) return false;
    this.entrants.set(id, name);
    if (this.joinsAsZombie) this.zombies.add(id);
    return true;
  }
  leave(id: number): void { this.entrants.delete(id); this.zombies.delete(id); this.respawnAt.delete(id); }

  /** A human was turned. */
  infect(id: number): void { if (this.entrants.has(id)) this.zombies.add(id); }

  tick(now: number, humansPresent: number): InfectionEvents {
    const ev: InfectionEvents = {};
    if (this.phase === 'waiting') {
      if (humansPresent >= INFECTION.minPlayers) { this.begin(now); ev.reset = true; }
      return ev;
    }
    if (!humansPresent && this.phase !== 'finished') { this.phase = 'waiting'; this.zombies.clear(); this.respawnAt.clear(); return ev; }
    if (this.phase === 'countdown' && now >= this.deadline) {
      this.phase = 'running'; this.deadline = now + INFECTION.roundMs; this.outbreakAt = now + INFECTION.outbreakMs; this.outbroke = false;
    }
    if (this.phase === 'running') {
      if (!this.outbroke && now >= this.outbreakAt) ev.outbreak = this.outbreak();
      // Every zombie left: pick new ones rather than handing the humans a free win.
      else if (this.outbroke && !this.zombies.size && this.entrants.size > 1) ev.outbreak = this.outbreak();
      if (this.outbroke && this.humans === 0) this.finish(now, 'zombies', ev);
      else if (now >= this.deadline) this.finish(now, 'humans', ev);
    } else if (this.phase === 'finished' && now >= this.deadline) {
      this.begin(now); ev.reset = true;
    }
    return ev;
  }

  private begin(now: number): void {
    this.phase = 'countdown'; this.round++; this.deadline = now + INFECTION.countdownMs;
    this.zombies.clear(); this.respawnAt.clear(); this.winner = null; this.outbroke = false;
  }

  private outbreak(): number[] {
    this.outbroke = true;
    const pool = [...this.entrants.keys()].filter((id) => !this.zombies.has(id));
    const count = Math.min(pool.length - 1, Math.max(1, Math.ceil(this.entrants.size / INFECTION.perZombie)));
    const out: number[] = [];
    for (let i = 0; i < count && pool.length; i++) {
      const id = pool.splice(Math.floor(this.random() * pool.length), 1)[0]!;
      this.zombies.add(id); out.push(id);
    }
    return out;
  }

  private finish(now: number, side: 'humans' | 'zombies', ev: InfectionEvents): void {
    this.phase = 'finished'; this.winner = side; this.deadline = now + INFECTION.finishedMs; ev.finished = side;
  }

  state(now: number, id?: number): InfectionState {
    const respawn = id === undefined ? undefined : this.respawnAt.get(id);
    return {
      t: 'infection', phase: this.phase, map: INFECTION_MAP.name, round: this.round, remainingMs: Math.max(0, this.deadline - now),
      humans: this.humans, zombies: this.zombies.size, zombieIds: [...this.zombies], winner: this.winner,
      ...(id !== undefined ? { infected: this.zombies.has(id) } : {}),
      ...(respawn !== undefined ? { respawnMs: Math.max(0, respawn - now) } : {}),
    };
  }
}
