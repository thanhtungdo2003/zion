import { WAVE_SHOP_MS, WAVE_COUNTDOWN_MS, pickWaveVariant, wavePlan, type WavePhase, type WavePlan, type ZombieVariant } from '@zion/shared';

/** How long a friends party may wait for its last members before the first wave starts anyway. */
export const WAVE_GATHER_MS = 25_000;

export interface WaveTickInput {
  /** Real players connected, and how many the party expects (1 in bot mode). */
  present: number;
  expected: number;
  /** Team members (players and bots) still standing. */
  alive: number;
  /** Team size the waves are scaled for (fixed when the first wave starts). */
  team: number;
  zombiesAlive: number;
  /** Between waves: every standing player has said ready in the shop (bots always are). */
  allReady?: boolean;
}

export interface WaveEvents {
  /** A wave began (its number). */
  started?: number;
  /** A wave was cleared (its number): the shop opens. */
  cleared?: number;
  /** Zombies to bring in this tick, by kind. */
  spawn: ZombieVariant[];
  /** The whole team is down: the match is over. */
  over?: boolean;
}

/**
 * The rules of one wave match, independent of the game server: lobby → countdown → (fighting →
 * break)* → over. The server feeds it who is present and alive and how many zombies live; it
 * answers when waves start and end and which zombies to bring in.
 */
export class WaveMatch {
  phase: WavePhase = 'lobby';
  wave = 0;
  cleared = 0;
  /** Server time the countdown or break ends. */
  endsAt = 0;
  startedAt = 0;
  /** Time from the start to the last cleared wave (the tie-break), and to the end. */
  clearMs = 0;
  endedAt = 0;
  team = 1;
  plan: WavePlan | null = null;
  /** Zombies brought in so far this wave. */
  spawned = 0;
  private nextSpawnAt = 0;
  private firstArrival = -1;

  constructor(private readonly random: () => number = Math.random) {}

  get survivedMs(): number { return this.startedAt ? (this.endedAt || this.lastNow) - this.startedAt : 0; }
  private lastNow = 0;

  /** Zombies still to come this wave (not yet spawned). */
  get pending(): number { return this.plan && this.phase === 'fighting' ? Math.max(0, this.plan.count - this.spawned) : 0; }

  tick(now: number, input: WaveTickInput): WaveEvents {
    this.lastNow = now;
    const ev: WaveEvents = { spawn: [] };
    if (this.phase === 'over') return ev;
    if (this.phase === 'lobby') {
      if (input.present < 1) return ev;
      if (this.firstArrival < 0) this.firstArrival = now;
      // Everyone the party expects is in, or the wait is up: count down.
      if (input.present >= input.expected || now - this.firstArrival >= WAVE_GATHER_MS) { this.phase = 'countdown'; this.endsAt = now + WAVE_COUNTDOWN_MS; }
      return ev;
    }
    if (this.phase === 'countdown') {
      if (now < this.endsAt) return ev;
      this.team = Math.max(1, input.team);
      this.startedAt = now;
      this.begin(now, ev);
      return ev;
    }
    // From the first wave on, the team being down ends it (a break included).
    if (input.alive <= 0) {
      this.phase = 'over'; this.endedAt = now; this.endsAt = 0; ev.over = true;
      return ev;
    }
    if (this.phase === 'break') {
      if (input.allReady || now >= this.endsAt) this.begin(now, ev);
      return ev;
    }
    const plan = this.plan!;
    if (this.spawned < plan.count && now >= this.nextSpawnAt) {
      const room = Math.max(0, plan.maxAlive - input.zombiesAlive), n = Math.min(plan.burst, plan.count - this.spawned, room);
      for (let i = 0; i < n; i++) ev.spawn.push(pickWaveVariant(plan.mix, this.random()));
      this.spawned += n;
      // Held back while the arena is full: the next try comes sooner.
      this.nextSpawnAt = now + (n ? plan.spawnEveryMs : 400);
    }
    if (this.spawned >= plan.count && input.zombiesAlive <= 0) {
      this.cleared = this.wave; this.clearMs = now - this.startedAt;
      this.phase = 'break'; this.endsAt = now + WAVE_SHOP_MS;
      ev.cleared = this.wave;
    }
    return ev;
  }

  private begin(now: number, ev: WaveEvents): void {
    this.wave++;
    this.plan = wavePlan(this.wave, this.team);
    this.spawned = 0; this.nextSpawnAt = now + 1500;
    this.phase = 'fighting'; this.endsAt = 0;
    ev.started = this.wave;
  }
}
