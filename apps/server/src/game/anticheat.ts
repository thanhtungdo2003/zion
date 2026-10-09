/**
 * Basic server-side anti-cheat. The protocol already makes most cheats inexpressible (clients
 * send intent, never positions or hit claims); this tracks *behavioural* anomalies that remain:
 * input flooding (speed hacks), sequence replay, malformed traffic, and simulation outliers.
 *
 * Each signal adds weighted suspicion that decays over time; crossing the threshold kicks the
 * player and writes a critical audit event.
 */
export type SuspicionKind =
  | 'input_overflow'
  | 'sequence_replay'
  | 'sequence_gap'
  | 'invalid_message'
  | 'rewind_out_of_window'
  | 'movement_anomaly'
  | 'chat_spam';

export const SUSPICION_WEIGHTS: Readonly<Record<SuspicionKind, number>> = {
  input_overflow: 0.5,
  sequence_replay: 6,
  sequence_gap: 1,
  invalid_message: 2,
  rewind_out_of_window: 1,
  movement_anomaly: 8,
  chat_spam: 1.5,
};

export interface SuspicionEvent {
  kind: SuspicionKind;
  at: number;
  detail?: Record<string, unknown>;
}

export class SuspicionTracker {
  private score = 0;
  private last: number;
  readonly recent: SuspicionEvent[] = [];

  constructor(
    private readonly threshold = 40,
    /** Points forgiven per second. */
    private readonly decayPerSec = 1.5,
    now = Date.now(),
  ) {
    this.last = now;
  }

  current(now = Date.now()): number {
    this.decay(now);
    return this.score;
  }

  private decay(now: number): void {
    const dt = (now - this.last) / 1000;
    this.last = now;
    this.score = Math.max(0, this.score - dt * this.decayPerSec);
  }

  /** Adds suspicion; returns true when the threshold is crossed. */
  add(kind: SuspicionKind, detail?: Record<string, unknown>, now = Date.now()): boolean {
    this.decay(now);
    this.score += SUSPICION_WEIGHTS[kind];
    this.recent.push({ kind, at: now, detail });
    if (this.recent.length > 20) this.recent.shift();
    return this.score >= this.threshold;
  }
}

/**
 * Per-player input budget: one simulation step is earned per server tick (capped), each input
 * consumes one. A client running its clock fast (speed hack) cannot get more steps than real time
 * allows; the excess is queued and eventually dropped.
 */
export class InputBudget {
  private budget: number;

  constructor(
    private readonly max = 8,
    initial = 2,
  ) {
    this.budget = initial;
  }

  earn(): void {
    this.budget = Math.min(this.max, this.budget + 1);
  }

  tryConsume(): boolean {
    if (this.budget < 1) return false;
    this.budget -= 1;
    return true;
  }

  get value(): number {
    return this.budget;
  }
}

/** Control, zero-width and bidi-override characters (spoofing / log injection vectors). */
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g;

/** Removes unsafe characters and collapses whitespace in chat text. */
export function sanitizeChat(text: string): string {
  return text.normalize('NFKC').replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim();
}
