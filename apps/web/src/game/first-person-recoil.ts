import { weaponSpec, WeaponId } from '@zion/shared';

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

/** Independent camera axes: smooth random climb and lateral drift, preserving mouse input. */
export class GunRecoil {
  private readonly vertical = new RecoilSpring(15, Math.PI / 22);
  private readonly left = new RecoilSpring(13, Math.PI / 40);
  private readonly right = new RecoilSpring(13, Math.PI / 40);

  kick(strength: number, random = Math.random): void {
    this.vertical.kick(strength * (.8 + random() * .6));
    const horizontal = (random() * 2 - 1) * strength * .65;
    (horizontal < 0 ? this.left : this.right).kick(Math.abs(horizontal));
  }

  apply(yaw: number, pitch: number, dt: number): { yaw: number; pitch: number } {
    return {
      yaw: yaw + this.right.update(dt) - this.left.update(dt),
      pitch: this.vertical.apply(pitch, dt),
    };
  }

  reset(): void { this.vertical.reset(); this.left.reset(); this.right.reset(); }
}

/** Peak camera lift in degrees, tuned for each weapon's weight and firing cadence. */
const KICK: Partial<Record<WeaponId, number>> = {
  [WeaponId.PKM]: 1.1,
  [WeaponId.Barrett]: 3.4,
  [WeaponId.AK47]: 1.05,
  [WeaponId.M4A1]: .72,
  [WeaponId.AUG]: .62,
  [WeaponId.MP5]: .46,
  [WeaponId.Uzi]: .5,
  [WeaponId.Vector]: .42,
  [WeaponId.P90]: .45,
  [WeaponId.ScarL]: .8,
  [WeaponId.M16]: .7,
  [WeaponId.Beryl]: .85,
  [WeaponId.M762]: 1,
  [WeaponId.Deagle]: 2.4,
  [WeaponId.ScarH]: 1.2,
  [WeaponId.Kar98k]: 2.2,
  [WeaponId.Mini14]: 1.1,
  [WeaponId.GL18]: 1.05,
  [WeaponId.Revolver]: 2.1,
  [WeaponId.Shotgun]: 2.6,
  [WeaponId.Saiga12]: 2.2,
  [WeaponId.DoubleBarrel]: 3,
  [WeaponId.AWM]: 2.4,
  [WeaponId.SVD]: 1.6,
  [WeaponId.GrenadeLauncher]: 2.8,
  [WeaponId.M79]: 2.6,
  [WeaponId.Remington700]: 2.3,
  [WeaponId.RocketLauncher]: 3.3,
  [WeaponId.Crossbow]: .45,
  [WeaponId.Flamethrower]: .045,
};

/** The shipped first-person kick of a built-in weapon (degrees), for the Studio defaults. */
export function builtinRecoilDegrees(weapon: number): number {
  return KICK[weapon as WeaponId] ?? 1;
}

export function weaponRecoil(weapon: number, magnification = 1): number {
  // Braced aiming is steadier; high-power optics still visibly amplify the remaining movement.
  // A kick set in the Studio wins over the built-in table.
  return ((weaponSpec(weapon) as { recoil?: number } | undefined)?.recoil ?? KICK[weapon as WeaponId] ?? 0) * Math.PI / 180 / Math.sqrt(Math.max(1, magnification));
}
