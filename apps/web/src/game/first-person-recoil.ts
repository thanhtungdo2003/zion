import { WeaponId } from '@zion/shared';

/** Critically damped spring: fast lift, smooth recovery and no bounce below the starting aim. */
export class RecoilSpring {
  offset = 0;
  private velocity = 0;

  constructor(private readonly frequency = 18, private readonly limit = Math.PI / 30) {}

  /** Desired peak angle for an isolated shot, in radians. Kicks accumulate during bursts. */
  kick(angle: number): void {
    this.velocity = Math.min(this.velocity + angle * this.frequency * Math.E, this.limit * this.frequency * Math.E);
  }

  /** Returns only the angular change, preserving the player's simultaneous mouse compensation. */
  update(dt: number): number {
    const before = this.offset;
    const c = this.velocity + this.frequency * before;
    const decay = Math.exp(-this.frequency * dt);
    this.offset = Math.min(this.limit, Math.max(0, (before + c * dt) * decay));
    this.velocity = (this.velocity - this.frequency * c * dt) * decay;
    if (this.offset >= this.limit) this.velocity = Math.min(0, this.velocity);
    return this.offset - before;
  }

  apply(pitch: number, dt: number): number {
    const requested = pitch + this.update(dt);
    const result = Math.max(-1.4, Math.min(1.4, requested));
    // Do not recover an upward movement the player never saw at the look limit.
    if (result < requested) {
      this.offset = Math.max(0, this.offset + result - requested);
      this.velocity = Math.min(0, this.velocity);
    }
    return result;
  }

  reset(): void {
    this.offset = this.velocity = 0;
  }
}

/** Peak camera lift in degrees, tuned for each weapon's weight and firing cadence. */
const KICK: Partial<Record<WeaponId, number>> = {
  [WeaponId.AK47]: 1.05,
  [WeaponId.M4A1]: .72,
  [WeaponId.AUG]: .62,
  [WeaponId.MP5]: .46,
  [WeaponId.GL18]: 1.05,
  [WeaponId.Revolver]: 2.1,
  [WeaponId.Shotgun]: 2.6,
  [WeaponId.Saiga12]: 2.2,
  [WeaponId.DoubleBarrel]: 3,
  [WeaponId.AWM]: 2.4,
  [WeaponId.SVD]: 1.6,
  [WeaponId.GrenadeLauncher]: 2.8,
  [WeaponId.RocketLauncher]: 3.3,
  [WeaponId.Crossbow]: .45,
  [WeaponId.Flamethrower]: .045,
};

export function weaponRecoil(weapon: number, magnification = 1): number {
  // Braced aiming is steadier; high-power optics still visibly amplify the remaining movement.
  return (KICK[weapon as WeaponId] ?? 0) * Math.PI / 180 / Math.sqrt(Math.max(1, magnification));
}
