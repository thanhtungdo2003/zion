import { BLADE_COMBO_WEAPONS, WEAPON_SPECS, WeaponId, bladeStepTiming, gunBlocksSprint, meleeSwing, nextBladeStep, type GunSpec } from '@zion/shared';

export type WeaponAction = 'none' | 'shot' | 'throw' | 'melee' | 'detonate';

export interface AmmoView {
  mag: number;
  max: number;
  /** Rounds left in the ammo boxes carried for this gun. */
  reserve: number;
  /** 0…1 while reloading, otherwise null. */
  reload: number | null;
}

/** Where reloads draw rounds from (the ammo boxes in the inventory). */
export interface AmmoSource {
  available(weapon: number): number;
  take(weapon: number, rounds: number): number;
}

/**
 * Client-side trigger logic: fire rate, magazines and reloads, mirrored from the shared weapon
 * table so shots feel instant. The server re-checks the fire rate and resolves every hit.
 */
export class WeaponController {
  private readonly mags = new Map<number, number>();
  private nextFire = 0;
  private nextThrow = 0;
  private prevTrigger = false;
  private prevSecondary = false;
  private reloadWeapon = 0;
  private reloadStart = 0;
  private reloadEnd = 0;
  /** Reload durations overridden by the length of each gun's reload sound. */
  private readonly reloadMs = new Map<number, number>();
  /** Called when a reload starts (manual or automatic), with its duration. */
  onReload: ((weapon: number, ms: number) => void) | null = null;
  /** Called when the trigger is pulled on an empty gun with no ammo boxes left. */
  onEmpty: ((weapon: number) => void) | null = null;

  constructor(private readonly ammo: AmmoSource) {}

  /** The server's magazine count for a gun (ignored mid-reload, when our own timer is running). */
  syncMag(weapon: number, rounds: number): void {
    if (this.reloadWeapon === weapon) {
      // Mid-reload: the server may already have finished it (and used up the last box), so keep
      // its count for when our timer ends instead of re-drawing from boxes that are gone.
      this.serverDuringReload = rounds;
      return;
    }
    this.mags.set(weapon, rounds);
  }

  private serverDuringReload: number | null = null;

  setReloadMs(weapon: number, ms: number): void {
    if (ms > 0) this.reloadMs.set(weapon, ms);
  }

  private gun(weapon: number): GunSpec | null {
    const spec = weapon ? WEAPON_SPECS[weapon as Exclude<WeaponId, 0>] : undefined;
    return spec?.kind === 'gun' ? spec : null;
  }

  private mag(weapon: number, spec: GunSpec): number {
    return this.mags.get(weapon) ?? spec.magazine;
  }

  /** One fixed tick. `trigger` = attack button held; returns what the press turned into. */
  tick(now: number, weapon: number, trigger: boolean, canAct: boolean, repeatTrigger = false, secondary = false): WeaponAction {
    const pressed = trigger && !this.prevTrigger;
    const secondaryPressed = secondary && !this.prevSecondary;
    this.prevTrigger = trigger;
    this.prevSecondary = secondary;
    if (this.reloadWeapon && now >= this.reloadEnd) {
      const w = this.reloadWeapon;
      const spec = this.gun(w);
      if (spec) {
        const mag = this.mag(w, spec);
        const rounds = this.serverDuringReload;
        this.mags.set(w, rounds !== null ? rounds : mag + this.ammo.take(w, spec.magazine - mag));
      }
      this.reloadWeapon = 0;
      this.serverDuringReload = null;
    }
    if (this.reloadWeapon && this.reloadWeapon !== weapon) { this.reloadWeapon = 0; this.serverDuringReload = null; } // swapping cancels
    if (weapon === WeaponId.C4) {
      if (!canAct) return 'none';
      const spec = WEAPON_SPECS[WeaponId.C4];
      if (secondaryPressed && now >= this.nextThrow && spec.kind === 'throw') {
        this.nextThrow = now + spec.cooldownMs;
        return 'throw';
      }
      return pressed ? 'detonate' : 'none';
    }
    if (!canAct || !trigger) return 'none';

    if (weapon === WeaponId.None) return 'melee';
    const spec = WEAPON_SPECS[weapon as Exclude<WeaponId, 0>];
    if (spec.kind === 'melee') {
      // Blades: one swing per click, paced by the weapon's cooldown.
      if (!pressed || now < this.nextThrow) return 'none';
      if (BLADE_COMBO_WEAPONS.has(weapon)) {
        // One-handed blades: the same combo count and step timing as the server.
        this.bladeStep = nextBladeStep(this.bladeStep, this.nextThrow, now);
        const timing = bladeStepTiming(spec, this.bladeStep);
        this.nextThrow = now + timing.cooldownMs;
        this.swingUntil = now + timing.durationMs;
        return 'melee';
      }
      this.bladeStep = -1;
      // Long or heavy weapons: the recorded swing's length, counted like the server.
      const swing = meleeSwing(weapon, spec, this.meleeSwings++);
      if (swing) {
        this.nextThrow = now + Math.max(spec.cooldownMs, swing.durationMs * .85);
        this.swingUntil = now + swing.durationMs;
        return 'melee';
      }
      this.nextThrow = now + spec.cooldownMs;
      this.swingUntil = now + (spec.animationMs ?? spec.swingMs);
      return 'melee';
    }
    if (spec.kind === 'throw') {
      if (!pressed || now < this.nextThrow) return 'none';
      this.nextThrow = now + spec.cooldownMs;
      return 'throw';
    }
    if (this.reloadWeapon || now < this.nextFire || (!spec.auto && !pressed && !repeatTrigger)) return 'none';
    const mag = this.mag(weapon, spec);
    if (mag <= 0) {
      this.reload(now, weapon);
      return 'none';
    }
    this.mags.set(weapon, mag - 1);
    this.nextFire = now + spec.fireMs;
    return 'shot';
  }

  /** Combo step of the last blade swing (−1: not a combo blade). */
  bladeStep = -1;
  /** Long or heavy swings so far (they alternate recorded swings, as on the server). */
  meleeSwings = 0;
  /** A melee swing is in progress until then (no sprinting through it). */
  swingUntil = 0;

  get reloading(): boolean {
    return this.reloadWeapon !== 0;
  }

  blocksSprint(now: number, weapon: number, trigger: boolean): boolean {
    return this.reloading || now < this.swingUntil || gunBlocksSprint(weapon, trigger, now, this.nextFire);
  }

  reload(now: number, weapon: number): void {
    const spec = this.gun(weapon);
    if (!spec || this.reloadWeapon || this.mag(weapon, spec) >= spec.magazine) return;
    // Only reload when an ammo box for this gun is carried.
    if (this.ammo.available(weapon) <= 0) {
      this.onEmpty?.(weapon);
      return;
    }
    this.reloadWeapon = weapon;
    this.serverDuringReload = null;
    this.reloadStart = now;
    const ms = this.reloadMs.get(weapon) ?? spec.reloadMs;
    this.reloadEnd = now + ms;
    this.onReload?.(weapon, ms);
  }

  view(now: number, weapon: number): AmmoView | null {
    const spec = this.gun(weapon);
    if (!spec) return null;
    const reload = this.reloadWeapon === weapon ? Math.min(1, (now - this.reloadStart) / (this.reloadEnd - this.reloadStart)) : null;
    return { mag: this.mag(weapon, spec), max: spec.magazine, reserve: this.ammo.available(weapon), reload };
  }
}
