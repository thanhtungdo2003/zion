/**
 * Weapon rules shared by client (prediction/effects) and server (authority). The client sends
 * only which weapon is in hand; damage, spread, fire rate and projectile flight are decided here.
 */
export const WeaponId = {
  None: 0,
  AK47: 1,
  Shotgun: 2,
  GL18: 3,
  Grenade: 4,
  AWM: 5,
  M4A1: 6,
  MP5: 7,
  Revolver: 8,
  SVD: 9,
  AUG: 10,
  Saiga12: 11,
  DoubleBarrel: 12,
  GrenadeLauncher: 13,
  RocketLauncher: 14,
  Crossbow: 15,
  Flamethrower: 16,
  Katana: 17,
  Quam: 18,
} as const;
export type WeaponId = (typeof WeaponId)[keyof typeof WeaponId];
export const MAX_WEAPON_ID = 18;

/** What a gun's trigger produces. */
export type FireMode = 'hitscan' | 'projectile' | 'flame';
/** Flying rounds simulated by the server: 40 mm grenades, rockets and crossbow bolts. */
export type ProjectileKind = 'grenade40' | 'rocket' | 'bolt';

export interface ProjectileSpec {
  kind: ProjectileKind;
  /** Launch speed (m/s) for straight shots; lobbed rounds solve their speed from the aim distance. */
  speed: number;
  gravity: number;
  /** Lobbed (grenade launcher): fired at this elevation so it lands at the cursor. */
  lob?: { elevation: number; maxRange: number };
  /** Explosive rounds: blast radius (m) and damage at the centre (linear falloff). */
  blast?: { radius: number; damage: number };
  /** Seconds before an un-impacted round is removed (or detonates if explosive). */
  maxFlightSec: number;
}

export interface GunSpec {
  kind: 'gun';
  fire?: FireMode;
  /** Minimum time between shots (flame: between fuel ticks). */
  fireMs: number;
  /** Damage per pellet / bolt / flame tick before hit-zone multiplier. */
  damage: number;
  pellets: number;
  /** Cone half-angle (radians): random spread, or the flame cone. */
  spread: number;
  range: number;
  magazine: number;
  reloadMs: number;
  /** Holding the trigger keeps firing. */
  auto: boolean;
  /** Optical magnification while aiming through the scope (right mouse button). */
  scope?: number;
  projectile?: ProjectileSpec;
  /** Flame: seconds a target keeps burning and the burn damage per second. */
  burn?: { seconds: number; dps: number };
}

export interface ThrowSpec {
  kind: 'throw';
  cooldownMs: number;
  /** Launch speed (m/s, used when no target distance is given) and elevation (radians). */
  speed: number;
  elevation: number;
  /** Farthest landing distance (m) a throw can be aimed at. */
  maxRange: number;
  /** Landing scatter: radius (m) = base + per metre of distance. */
  scatterBase: number;
  scatterPerM: number;
  fuseMs: number;
  radius: number;
  /** Damage at the centre, falling off linearly to 0 at `radius`. */
  damage: number;
}

export interface MeleeSpec {
  kind: 'melee';
  damage: number;
  range: number;
  cooldownMs: number;
  /** Visual "attacking" flag duration. */
  swingMs: number;
}

export type WeaponSpec = GunSpec | ThrowSpec | MeleeSpec;

export const GRENADE_GRAVITY = 20;

export const WEAPON_SPECS: Record<Exclude<WeaponId, 0>, WeaponSpec> = {
  [WeaponId.AK47]: { kind: 'gun', fireMs: 100, damage: 14, pellets: 1, spread: 0.025, range: 70, magazine: 30, reloadMs: 2300, auto: true },
  [WeaponId.Shotgun]: { kind: 'gun', fireMs: 850, damage: 10, pellets: 8, spread: 0.1, range: 24, magazine: 6, reloadMs: 2600, auto: false },
  [WeaponId.GL18]: { kind: 'gun', fireMs: 140, damage: 11, pellets: 1, spread: 0.035, range: 45, magazine: 17, reloadMs: 1500, auto: false },
  [WeaponId.AWM]: { kind: 'gun', fireMs: 1400, damage: 95, pellets: 1, spread: 0.004, range: 130, magazine: 5, reloadMs: 3200, auto: false, scope: 8 },
  [WeaponId.M4A1]: { kind: 'gun', fireMs: 85, damage: 13, pellets: 1, spread: 0.02, range: 75, magazine: 30, reloadMs: 2200, auto: true },
  [WeaponId.MP5]: { kind: 'gun', fireMs: 70, damage: 9, pellets: 1, spread: 0.04, range: 40, magazine: 30, reloadMs: 1900, auto: true },
  [WeaponId.Revolver]: { kind: 'gun', fireMs: 420, damage: 34, pellets: 1, spread: 0.02, range: 50, magazine: 6, reloadMs: 2800, auto: false },
  [WeaponId.SVD]: { kind: 'gun', fireMs: 450, damage: 62, pellets: 1, spread: 0.008, range: 110, magazine: 10, reloadMs: 2800, auto: false, scope: 4 },
  [WeaponId.AUG]: { kind: 'gun', fireMs: 90, damage: 13, pellets: 1, spread: 0.018, range: 75, magazine: 30, reloadMs: 2400, auto: true, scope: 2 },
  [WeaponId.Saiga12]: { kind: 'gun', fireMs: 260, damage: 9, pellets: 8, spread: 0.1, range: 24, magazine: 8, reloadMs: 2900, auto: false },
  [WeaponId.DoubleBarrel]: { kind: 'gun', fireMs: 300, damage: 12, pellets: 9, spread: 0.12, range: 22, magazine: 2, reloadMs: 2200, auto: false },
  [WeaponId.GrenadeLauncher]: {
    kind: 'gun', fire: 'projectile', fireMs: 900, damage: 0, pellets: 1, spread: 0, range: 45, magazine: 6, reloadMs: 3400, auto: false,
    projectile: { kind: 'grenade40', speed: 24, gravity: GRENADE_GRAVITY, lob: { elevation: 0.85, maxRange: 45 }, blast: { radius: 5.5, damage: 110 }, maxFlightSec: 6 },
  },
  [WeaponId.RocketLauncher]: {
    kind: 'gun', fire: 'projectile', fireMs: 600, damage: 0, pellets: 1, spread: 0.01, range: 90, magazine: 1, reloadMs: 3000, auto: false,
    projectile: { kind: 'rocket', speed: 34, gravity: 0.6, blast: { radius: 7, damage: 180 }, maxFlightSec: 3 },
  },
  [WeaponId.Crossbow]: {
    kind: 'gun', fire: 'projectile', fireMs: 400, damage: 72, pellets: 1, spread: 0.004, range: 90, magazine: 1, reloadMs: 850, auto: false, scope: 4,
    projectile: { kind: 'bolt', speed: 60, gravity: 4, maxFlightSec: 2.5 },
  },
  [WeaponId.Flamethrower]: {
    kind: 'gun', fire: 'flame', fireMs: 100, damage: 5, pellets: 1, spread: 0.3, range: 8, magazine: 100, reloadMs: 3000, auto: true,
    burn: { seconds: 4, dps: 7 },
  },
  [WeaponId.Grenade]: { kind: 'throw', cooldownMs: 1100, speed: 14, elevation: 0.62, maxRange: 22, scatterBase: 1.2, scatterPerM: 0.08, fuseMs: 2600, radius: 7, damage: 120 },
  [WeaponId.Katana]: { kind: 'melee', damage: 38, range: 2.6, cooldownMs: 520, swingMs: 320 },
  [WeaponId.Quam]: { kind: 'melee', damage: 50, range: 3.2, cooldownMs: 850, swingMs: 420 },
};

/** Inventory item id → weapon id. */
export const WEAPON_BY_ITEM: Readonly<Record<string, WeaponId>> = {
  ak47: WeaponId.AK47,
  shotgun: WeaponId.Shotgun,
  gl18: WeaponId.GL18,
  grenade: WeaponId.Grenade,
  awm: WeaponId.AWM,
  m4a1: WeaponId.M4A1,
  mp5: WeaponId.MP5,
  revolver: WeaponId.Revolver,
  svd: WeaponId.SVD,
  aug: WeaponId.AUG,
  saiga12: WeaponId.Saiga12,
  double_barrel: WeaponId.DoubleBarrel,
  grenade_launcher: WeaponId.GrenadeLauncher,
  rocket_launcher: WeaponId.RocketLauncher,
  crossbow: WeaponId.Crossbow,
  flamethrower: WeaponId.Flamethrower,
  katana: WeaponId.Katana,
  quam: WeaponId.Quam,
};

export const ITEM_BY_WEAPON: Readonly<Record<number, string>> = Object.fromEntries(Object.entries(WEAPON_BY_ITEM).map(([k, v]) => [v, k]));

export function weaponSpec(weapon: number): WeaponSpec | undefined {
  return weapon ? WEAPON_SPECS[weapon as Exclude<WeaponId, 0>] : undefined;
}

/** Shots leave from chest/shoulder height so a level top-down aim hits torsos, not only heads. */
export const MUZZLE_HEIGHT = 1.35;
/** Server accepts a shot up to this much early (input timing jitter between ticks). */
export const FIRE_TOLERANCE_MS = 45;

/** Landing scatter radius (m) for a throw aimed `dist` metres away. */
export function throwScatter(spec: ThrowSpec, dist: number): number {
  return spec.scatterBase + spec.scatterPerM * Math.min(dist, spec.maxRange);
}

/**
 * Launch speed that lands a lobbed round at horizontal distance `dist`, `dy` metres above the
 * launch point, at the given elevation. Clamped so it can't exceed `maxRange` on flat ground.
 */
export function lobSpeed(elevation: number, maxRange: number, dist: number, dy: number, gravity = GRENADE_GRAVITY): number {
  const c = Math.cos(elevation);
  const x = Math.max(0.5, Math.min(dist, maxRange));
  const vMax = Math.sqrt((gravity * maxRange) / Math.sin(2 * elevation));
  const den = 2 * c * c * (x * Math.tan(elevation) - dy);
  if (den <= 0) return vMax;
  return Math.min(vMax, Math.sqrt((gravity * x * x) / den));
}

/** Hand-grenade version of `lobSpeed`. */
export function throwSpeed(spec: ThrowSpec, dist: number, dy: number): number {
  return lobSpeed(spec.elevation, spec.maxRange, dist, dy);
}
/** Shooting keeps movement at walking speed, including the interval between rounds. */
export function gunBlocksSprint(weapon: number, trigger: boolean, now: number, fireReadyAt: number): boolean {
  return WEAPON_SPECS[weapon as Exclude<WeaponId, 0>]?.kind === 'gun' && (trigger || now < fireReadyAt);
}
