import type { Logger } from '../logger';
import type { GameServer } from './game-server';

/** How often idle matches are looked at, and how long an empty extra one may linger. */
const SWEEP_MS = 15_000;
const IDLE_MS = 60_000;

/**
 * Matchmaking for one match mode (battle royale, infection): many independent matches run side by
 * side, each its own GameServer over the shared world. "Play" puts the player in a match that is
 * still gathering players (its lobby or countdown); when every one has started or is full, a new
 * match opens. Empty spare matches are shut down, one stays warm.
 */
export class MatchPool {
  private readonly games: GameServer[] = [];
  private readonly idleSince = new Map<GameServer, number>();
  /** Squads (battle royale) are kept together: squad id → the match its first member joined. */
  private readonly squads = new Map<string, { game: GameServer; at: number }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly create: () => GameServer, private readonly log: Logger, private readonly max = 12) {}

  get matches(): readonly GameServer[] { return this.games; }

  start(): void {
    this.open();
    this.timer = setInterval(() => { void this.sweep(); }, SWEEP_MS);
    this.timer.unref();
  }

  /** A match for one more player (and their squad), or null when every match is full or running and no more may open. */
  pick(squad?: string): GameServer | null {
    const now = Date.now();
    for (const [id, s] of this.squads) if (now - s.at > 120_000 || !this.games.includes(s.game)) this.squads.delete(id);
    const kept = squad ? this.squads.get(squad)?.game : undefined;
    // The fullest gathering match first, so matches fill up and start instead of waiting side by side.
    const game = (kept?.canAdmit() ? kept : undefined)
      ?? this.games.filter((g) => g.canAdmit()).sort((a, b) => b.headcount - a.headcount)[0]
      ?? (this.games.length < this.max ? this.open() : null);
    if (game && squad) this.squads.set(squad, { game, at: now });
    return game;
  }

  private open(): GameServer {
    const game = this.create();
    game.start();
    this.games.push(game);
    this.log.info({ matches: this.games.length }, 'match opened');
    return game;
  }

  /** Shuts empty matches down, keeping one ready. */
  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const game of [...this.games]) {
      if (game.headcount > 0) { this.idleSince.delete(game); continue; }
      const since = this.idleSince.get(game) ?? now;
      this.idleSince.set(game, since);
      const spare = this.games.filter((g) => g.headcount === 0).length > 1;
      if (!spare || now - since < IDLE_MS) continue;
      this.games.splice(this.games.indexOf(game), 1);
      this.idleSince.delete(game);
      await game.stop().catch((err: unknown) => this.log.error({ err }, 'match stop failed'));
      this.log.info({ matches: this.games.length }, 'match closed');
    }
  }

  /** The map changed: empty matches (still on the old one) close, a fresh one opens. */
  async retireIdle(): Promise<void> {
    const idle = this.games.filter((g) => g.headcount === 0);
    for (const game of idle) { this.games.splice(this.games.indexOf(game), 1); this.idleSince.delete(game); }
    this.open();
    await Promise.all(idle.map((g) => g.stop().catch((err: unknown) => this.log.error({ err }, 'match stop failed'))));
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.all(this.games.map((g) => g.stop()));
  }
}
