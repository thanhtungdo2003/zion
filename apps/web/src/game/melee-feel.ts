/**
 * Melee "game feel", the client-side juice that makes a blow feel like it lands (the same toolkit
 * action games use: Dark Souls / Chivalry / Doom Eternal / Dying Light):
 *
 * - Anticipation and follow-through: the view sways with the swing (yaw sweep, roll, a dip on
 *   overheads) so the whole camera "throws" the blow, not only the weapon.
 * - Hit-stop: on contact the weapon and the body freeze for a few frames (longer for heavy weapons,
 *   head blows and kills), the single strongest cue that something solid was struck.
 * - Camera punch: a spring-driven kick against the swing direction plus roll, an FOV punch and a
 *   short shake; damped so it settles in a fraction of a second, never nauseating.
 * - Layered sound: a whoosh pitched by weight; on contact flesh + a low thump + a crack on head
 *   blows, combo hits rising in pitch; a heavy kill thud.
 * - Combo: hits chained within a short window count up (shown on the HUD) and hit harder.
 *
 * Purely cosmetic: the server alone decides hits and damage.
 */
export interface MeleeFeelFrame {
  /** Animation speed for the weapon in hand and the local body (0 during hit-stop). */
  timeScale: number;
  /** View offsets (radians) and FOV offset (degrees). */
  yaw: number; pitch: number; roll: number; fov: number;
  /** Shake amplitude (m) to add, and a push towards the target (0…1, TOP / shoulder cameras). */
  shake: number; push: number;
}

interface Spring { x: number; v: number }
const step = (s: Spring, k: number, damping: number, dt: number) => {
  // Semi-implicit damped spring towards 0.
  s.v += (-k * s.x - damping * s.v) * dt;
  s.x += s.v * dt;
};

export type MeleeSound = 'swordSlash' | 'airSwing' | 'hitFlesh' | 'arrowHitHard' | 'headshot' | 'killConfirm' | 'knockdown';

export class MeleeFeel {
  private swingStart = -Infinity;
  private swingMs = 400;
  private dir = 1;
  private overhead = false;
  private weight = 1;
  private stopUntil = 0;
  private readonly yaw: Spring = { x: 0, v: 0 };
  private readonly pitch: Spring = { x: 0, v: 0 };
  private readonly roll: Spring = { x: 0, v: 0 };
  private readonly fov: Spring = { x: 0, v: 0 };
  private readonly push: Spring = { x: 0, v: 0 };
  private shake = 0;
  /** The blade finisher's blow lands at this time (ms): a heavy shake and punch then. */
  private finisherAt = Infinity;
  combo = 0;
  private comboAt = -Infinity;
  /** Last swing time (ms): hits arriving within a moment of it are this swing's. */
  get lastSwing(): number { return this.swingStart; }

  constructor(private readonly play: (name: MeleeSound, volume: number, rate: number) => void) {}

  /** A swing starts: `variant` alternates the side (1 right-to-left, 2 left-to-right, 3 overhead). */
  swing(variant: number, swingMs: number, weightKg: number, now: number, edged = true): void {
    this.swingStart = now;
    this.swingMs = Math.max(220, swingMs);
    this.dir = variant % 2 === 0 ? -1 : 1;
    this.overhead = variant >= 3;
    this.weight = Math.max(.6, Math.min(3, weightKg / 2));
    // Wind-up: a small counter-move first (anticipation), the sweep follows in update().
    this.yaw.v += -this.dir * .5 * this.weight;
    if (this.overhead) this.pitch.v += .6;
    // A blade rings as it cuts the air; anything else whooshes (lower the heavier it is).
    if (edged) this.play('swordSlash', .65, 1.18 - this.weight * .12 + Math.random() * .08);
    else this.play('airSwing', .8, 1.15 - this.weight * .15 + Math.random() * .08);
  }

  /** The server confirmed one of our blows: freeze, punch, sound. */
  impact(now: number, opts: { head: boolean; damage: number; slash: boolean }): void {
    if (now - this.comboAt < 1300) this.combo++;
    else this.combo = 1;
    this.comboAt = now;
    const heavy = Math.min(1.6, .55 + opts.damage / 70) * this.weight ** .5;
    const stop = 55 + 45 * heavy + (opts.head ? 30 : 0);
    this.stopUntil = Math.max(this.stopUntil, now + stop);
    // Punch against the swing, a roll into it, the view dips and narrows for a beat.
    this.yaw.v += this.dir * 1.6 * heavy;
    this.roll.v += -this.dir * 2.4 * heavy;
    this.pitch.v += (this.overhead ? -1.8 : -.7) * heavy;
    this.fov.v += -38 * heavy;
    this.push.v += 6 * heavy;
    this.shake = Math.max(this.shake, .05 * heavy + Math.min(.04, this.combo * .008));
    const rise = Math.min(.25, (this.combo - 1) * .05);
    this.play(opts.slash ? 'hitFlesh' : 'arrowHitHard', .95, .92 + rise + Math.random() * .06);
    this.play('arrowHitHard', .55 * heavy, .62 + rise * .5);
    if (opts.head) this.play('headshot', .5, .9 + rise);
  }

  /** The combo's finisher (a lunge and a full cut): the screen shakes hard as the blow lands at `at` (ms). */
  finisher(at: number): void { this.finisherAt = at; }

  /** Our blow killed: a longer freeze and heavier camera movement. */
  kill(now: number): void {
    this.stopUntil = Math.max(this.stopUntil, now + 140);
    this.fov.v += -30;
    this.roll.v += -this.dir * 1.6;
    this.shake = Math.max(this.shake, .09);
  }

  update(dtSec: number, now: number): MeleeFeelFrame {
    if (now >= this.finisherAt) {
      this.finisherAt = Infinity;
      this.shake = Math.max(this.shake, .16);
      this.yaw.v += this.dir * 3.2; this.roll.v += -this.dir * 4.5; this.pitch.v += -1.6;
      this.fov.v += -70; this.push.v += 12;
    }
    const frozen = now < this.stopUntil;
    // The sweep of the swing itself (follow-through), eased in and out over its duration.
    const t = (now - this.swingStart) / this.swingMs;
    let sweepYaw = 0, sweepPitch = 0, sweepRoll = 0;
    if (t >= 0 && t < 1.4) {
      const k = Math.sin(Math.min(1, t) * Math.PI) * (t > 1 ? Math.max(0, 1 - (t - 1) / .4) : 1);
      sweepYaw = this.dir * .045 * this.weight * k;
      sweepRoll = this.dir * .03 * this.weight * k;
      sweepPitch = this.overhead ? -.05 * this.weight * k : -.01 * k;
    }
    // While frozen the springs hold their pose (the hit "sticks"), then release.
    if (!frozen) {
      const d = Math.min(dtSec, 1 / 30);
      step(this.yaw, 220, 22, d); step(this.pitch, 220, 22, d); step(this.roll, 180, 18, d);
      step(this.fov, 260, 24, d); step(this.push, 160, 20, d);
    }
    this.shake = Math.max(0, this.shake - dtSec * .35);
    return {
      timeScale: frozen ? 0 : 1,
      yaw: this.yaw.x * .02 + sweepYaw,
      pitch: this.pitch.x * .02 + sweepPitch,
      roll: this.roll.x * .02 + sweepRoll,
      fov: this.fov.x * .1,
      shake: this.shake,
      push: Math.max(0, this.push.x * .05),
    };
  }
}
