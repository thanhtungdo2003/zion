import { TicketLedger, ZoneCapture, otherSide, type WarfareConfig, type WarfareLayout, type WarfarePhase, type WarfareSide, type ZoneState } from '@zion/shared';

export type WarfareEndReason = 'tickets' | 'time' | 'forfeit' | 'objectives';

export interface WarfareTickInput {
  /** Real players connected (either side). */
  humans: number;
  /** Alive combatants on the field, for zone capture. */
  units: Iterable<{ side: WarfareSide; x: number; z: number }>;
}

export interface WarfareEvents {
  /** The fighting began. */
  started?: boolean;
  /** Zones that changed owner this tick. */
  flips: { zone: ZoneState; from: WarfareSide | null; to: WarfareSide | null }[];
  /** The match just ended. */
  over?: { winner: WarfareSide; reason: WarfareEndReason };
  /** The result screen is done: the room should close. */
  close?: boolean;
}

/**
 * The rules of one Warfare match, independent of the game server:
 * lobby → countdown → fighting → over. The server feeds it who is present and where the living
 * units stand; it answers with zone flips, ticket bleed and the end of the match.
 */
export class WarfareMatch {
  phase: WarfarePhase = 'lobby';
  /** Server time the countdown / fight (time limit) / result screen ends (0 = none). */
  endsAt = 0;
  startedAt = 0;
  result: WarfareEvents['over'] | null = null;
  readonly ledger: TicketLedger;
  readonly capture: ZoneCapture;
  private lastTick = 0;
  private emptySince = -1;
  private sweepSide: WarfareSide | null = null;
  private sweepSince = 0;
  /** Zones taken by each side this match (for the result screen). */
  readonly captures: Record<WarfareSide, number> = { blue: 0, red: 0 };

  constructor(readonly cfg: WarfareConfig, readonly layout: WarfareLayout) {
    this.ledger = new TicketLedger(cfg.tickets);
    this.capture = new ZoneCapture(layout.zones);
  }

  get fighting(): boolean {
    return this.phase === 'fighting';
  }

  /** A combatant of `side` died; `key` identifies that one death (charged at most once). */
  death(side: WarfareSide, key: string): boolean {
    return this.ledger.death(side, key);
  }

  tick(now: number, input: WarfareTickInput): WarfareEvents {
    const ev: WarfareEvents = { flips: [] };
    const dt = this.lastTick ? Math.max(0, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    if (this.phase === 'over') {
      if (now >= this.endsAt) ev.close = true;
      return ev;
    }
    if (this.phase === 'lobby') {
      if (input.humans < 1) return ev;
      this.phase = 'countdown';
      this.endsAt = now + this.cfg.countdownSeconds * 1000;
    }
    if (this.phase === 'countdown') {
      if (now < this.endsAt) return ev;
      this.phase = 'fighting';
      this.startedAt = now;
      this.endsAt = this.cfg.timeLimitMinutes > 0 ? now + this.cfg.timeLimitMinutes * 60_000 : 0;
      this.ledger.running = true;
      ev.started = true;
      return ev;
    }
    // Fighting.
    ev.flips = this.capture.step(this.capture.presence(input.units), dt, this.cfg.captureSeconds, this.cfg.captureBonusPerUnit);
    if (now - this.startedAt >= this.cfg.bleedGraceSeconds * 1000) this.ledger.bleed(this.capture.held(), dt, this.cfg.bleedPerZone, this.cfg.bleedMaxPerSecond, this.cfg.bleedMinLead);
    for (const f of ev.flips) if (f.to) this.captures[f.to]++;

    const loser = this.ledger.loser();
    if (loser) return this.end(now, ev, otherSide(loser), 'tickets');
    // Optional objective win: one side holds every zone long enough.
    if (this.cfg.allZonesSeconds > 0 && this.capture.zones.length) {
      const all = this.capture.zones.every((z) => z.owner && z.owner === this.capture.zones[0]!.owner) ? this.capture.zones[0]!.owner : null;
      if (all !== this.sweepSide) { this.sweepSide = all; this.sweepSince = now; }
      if (all && now - this.sweepSince >= this.cfg.allZonesSeconds * 1000) return this.end(now, ev, all, 'objectives');
    }
    if (this.endsAt && now >= this.endsAt) {
      const t = this.ledger.tickets;
      const held = this.capture.held();
      // Tie on tickets → more zones → blue (defender advantage is arbitrary but deterministic).
      const winner: WarfareSide = t.blue !== t.red ? (t.blue > t.red ? 'blue' : 'red') : held.red > held.blue ? 'red' : 'blue';
      return this.end(now, ev, winner, 'time');
    }
    if (input.humans < 1) {
      if (this.emptySince < 0) this.emptySince = now;
      if (now - this.emptySince >= this.cfg.emptyGraceSeconds * 1000) {
        const t = this.ledger.tickets;
        return this.end(now, ev, t.red > t.blue ? 'red' : 'blue', 'forfeit');
      }
    } else this.emptySince = -1;
    return ev;
  }

  /** Time left in the current phase (ms, 0 when unbounded). */
  msLeft(now: number): number {
    return this.endsAt ? Math.max(0, this.endsAt - now) : 0;
  }

  private end(now: number, ev: WarfareEvents, winner: WarfareSide, reason: WarfareEndReason): WarfareEvents {
    this.phase = 'over';
    this.ledger.running = false;
    this.result = { winner, reason };
    this.endsAt = now + this.cfg.overSeconds * 1000;
    ev.over = this.result;
    return ev;
  }
}
