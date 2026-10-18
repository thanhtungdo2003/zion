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
  Shovel: 19,
  Sledgehammer: 20,
  C4: 21,
  PKM: 22,
  Barrett: 23,
  FireAxe: 24,
  Deagle: 25,
  Uzi: 26,
  ScarH: 27,
  Kar98k: 28,
  Mini14: 29,
  Machete: 30,
  BaseballBat: 31,
  Crowbar: 32,
  Vector: 33,
  P90: 34,
  ScarL: 35,
  Flashbang: 36,
  SmokeGrenade: 37,
  Pickaxe: 38,
} as const;
export type WeaponId = (typeof WeaponId)[keyof typeof WeaponId];
export const MAX_WEAPON_ID = 38;

/** What a gun's trigger produces. */
export type FireMode = 'ballistic' | 'projectile' | 'flame';
/** Flying rounds simulated by the server: 40 mm grenades, rockets and crossbow bolts. */
export type ProjectileKind = 'grenade40' | 'rocket' | 'bolt' | 'bullet';

export interface ProjectileSpec {
  kind: ProjectileKind;
  /** Launch speed (m/s) for straight shots; lobbed rounds solve their speed from the aim distance. */
  speed: number;
  gravity: number;
  /** Linear air resistance (1/s). */
  drag?: number;
  maxRange?: number;
  /** Lobbed (grenade launcher): fired at this elevation so it lands at the cursor. */
  lob?: { elevation: number; maxRange: number };
  /** Explosive rounds: blast radius (m) and damage at the centre (linear falloff). */
  blast?: { radius: number; damage: number };
  /** Seconds before an un-impacted round is removed (or detonates if explosive). */
  maxFlightSec: number;
}

export interface GunSpec {
  weight: number;
  /** Multiplier for the physical hit impulse. */
  knockback?: number;
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
  /** Studio weapons: first-person kick per shot (degrees) and shot sound name. */
  recoil?: number;
  sound?: string;
}

export interface ThrowSpec {
  weight: number;
  kind: 'throw';
  remote?: boolean;
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
  /** What it does when it goes off: blast (default), blinding flash or a smoke screen. */
  effect?: ThrowEffect;
  /** Flash: longest blindness/deafness (ms). Smoke: how long the cloud lasts (ms). */
  effectMs?: number;
}
export type ThrowEffect = 'frag' | 'flash' | 'smoke';

export interface MeleeSpec {
  weight: number;
  /** Chance per confirmed zombie hit; never applies to players or animals. */
  decapitationChance?: number;
  kind: 'melee';
  damage: number;
  range: number;
  cooldownMs: number;
  /** Visual "attacking" flag duration. */
  swingMs: number;
  hitDelayMs?: number;
  animationMs?: number;
  halfAngle?: number;
  cleaveMultiplier?: number;
  stunMs?: number;
}

export type WeaponSpec = GunSpec | ThrowSpec | MeleeSpec;

export const GRENADE_GRAVITY = 20;

export const WEAPON_SPECS: Record<Exclude<WeaponId, 0>, WeaponSpec> = {
  [WeaponId.AK47]: { kind: 'gun', weight: 3.8, fireMs: 100, damage: 14, pellets: 1, spread: 0.025, range: 70, magazine: 30, reloadMs: 2300, auto: true },
  [WeaponId.PKM]: { kind: 'gun', weight: 15, fireMs: 100, damage: 22, pellets: 1, spread: .04, range: 85, magazine: 100, reloadMs: 4000, auto: true },
  [WeaponId.Barrett]: { kind: 'gun', weight: 14, fireMs: 1700, damage: 145, pellets: 1, spread: .003, range: 180, magazine: 10, reloadMs: 4200, auto: false, knockback: 1.8 },
  [WeaponId.Shotgun]: { kind: 'gun', weight: 3.6, fireMs: 850, damage: 10, pellets: 8, spread: 0.1, range: 24, magazine: 6, reloadMs: 2600, auto: false },
  [WeaponId.GL18]: { kind: 'gun', weight: 0.9, fireMs: 140, damage: 11, pellets: 1, spread: 0.035, range: 45, magazine: 17, reloadMs: 1500, auto: false },
  [WeaponId.AWM]: { kind: 'gun', weight: 6.5, fireMs: 1800, damage: 95, pellets: 1, spread: 0.004, range: 130, magazine: 5, reloadMs: 3200, auto: false },
  [WeaponId.M4A1]: { kind: 'gun', weight: 3.1, fireMs: 85, damage: 13, pellets: 1, spread: 0.02, range: 75, magazine: 30, reloadMs: 2200, auto: true },
  [WeaponId.MP5]: { kind: 'gun', weight: 2.5, fireMs: 70, damage: 9, pellets: 1, spread: 0.04, range: 40, magazine: 30, reloadMs: 1900, auto: true },
  [WeaponId.Revolver]: { kind: 'gun', weight: 1.2, fireMs: 420, damage: 34, pellets: 1, spread: 0.02, range: 50, magazine: 6, reloadMs: 2800, auto: false },
  [WeaponId.SVD]: { kind: 'gun', weight: 4.3, fireMs: 450, damage: 62, pellets: 1, spread: 0.008, range: 110, magazine: 10, reloadMs: 2800, auto: false },
  [WeaponId.AUG]: { kind: 'gun', weight: 3.6, fireMs: 90, damage: 13, pellets: 1, spread: 0.018, range: 75, magazine: 30, reloadMs: 2400, auto: true },
  [WeaponId.Saiga12]: { kind: 'gun', weight: 3.8, fireMs: 260, damage: 9, pellets: 8, spread: 0.1, range: 24, magazine: 8, reloadMs: 2900, auto: false },
  [WeaponId.DoubleBarrel]: { kind: 'gun', weight: 3.4, fireMs: 300, damage: 12, pellets: 9, spread: 0.12, range: 22, magazine: 2, reloadMs: 2200, auto: false },
  // Added set: one per role, reloads kept within 2.2-2.6 s like the rest of the armoury.
  [WeaponId.Deagle]: { kind: 'gun', weight: 1.9, fireMs: 400, damage: 38, pellets: 1, spread: 0.022, range: 55, magazine: 7, reloadMs: 2200, auto: false, knockback: 1.2 },
  [WeaponId.Uzi]: { kind: 'gun', weight: 2.2, fireMs: 60, damage: 8, pellets: 1, spread: 0.05, range: 35, magazine: 32, reloadMs: 2200, auto: true },
  [WeaponId.ScarH]: { kind: 'gun', weight: 3.9, fireMs: 125, damage: 19, pellets: 1, spread: 0.02, range: 85, magazine: 20, reloadMs: 2400, auto: true },
  [WeaponId.Kar98k]: { kind: 'gun', weight: 4, fireMs: 1750, damage: 88, pellets: 1, spread: 0.005, range: 125, magazine: 5, reloadMs: 2600, auto: false },
  [WeaponId.Mini14]: { kind: 'gun', weight: 3.2, fireMs: 240, damage: 30, pellets: 1, spread: 0.01, range: 95, magazine: 20, reloadMs: 2400, auto: false },
  [WeaponId.Vector]: { kind: 'gun', weight: 2.7, fireMs: 50, damage: 8, pellets: 1, spread: 0.04, range: 40, magazine: 25, reloadMs: 2300, auto: true },
  [WeaponId.P90]: { kind: 'gun', weight: 2.6, fireMs: 67, damage: 9, pellets: 1, spread: 0.035, range: 50, magazine: 50, reloadMs: 2600, auto: true },
  [WeaponId.ScarL]: { kind: 'gun', weight: 3.5, fireMs: 95, damage: 14, pellets: 1, spread: 0.019, range: 78, magazine: 30, reloadMs: 2300, auto: true },
  [WeaponId.GrenadeLauncher]: {
    kind: 'gun', weight: 7, fire: 'projectile', fireMs: 900, damage: 0, pellets: 1, spread: 0, range: 45, magazine: 6, reloadMs: 3400, auto: false,
    projectile: { kind: 'grenade40', speed: 24, gravity: GRENADE_GRAVITY, lob: { elevation: 0.85, maxRange: 45 }, blast: { radius: 5.5, damage: 110 }, maxFlightSec: 6 },
  },
  [WeaponId.RocketLauncher]: {
    kind: 'gun', weight: 9, fire: 'projectile', fireMs: 600, damage: 0, pellets: 1, spread: 0.01, range: 90, magazine: 1, reloadMs: 3000, auto: false,
    projectile: { kind: 'rocket', speed: 34, gravity: 0.6, blast: { radius: 7, damage: 180 }, maxFlightSec: 3 },
  },
  [WeaponId.Crossbow]: {
    kind: 'gun', weight: 3.2, fire: 'projectile', fireMs: 400, damage: 72, pellets: 1, spread: 0.004, range: 90, magazine: 1, reloadMs: 850, auto: false, scope: 4,
    projectile: { kind: 'bolt', speed: 60, gravity: 4, maxFlightSec: 2.5 },
  },
  [WeaponId.Flamethrower]: {
    kind: 'gun', weight: 16, fire: 'flame', fireMs: 100, damage: 5, pellets: 1, spread: 0.3, range: 8, magazine: 100, reloadMs: 3000, auto: true,
    burn: { seconds: 4, dps: 7 },
  },
  [WeaponId.Grenade]: { kind: 'throw', weight: 0.4, cooldownMs: 1100, speed: 14, elevation: 0.62, maxRange: 22, scatterBase: 1.2, scatterPerM: 0.08, fuseMs: 2600, radius: 7, damage: 120 },
  // Stun grenade: no damage, blinds and deafens whoever sees / hears it go off.
  [WeaponId.Flashbang]: { kind: 'throw', weight: 0.35, cooldownMs: 1100, speed: 14, elevation: 0.62, maxRange: 24, scatterBase: 1, scatterPerM: 0.07, fuseMs: 1800, radius: 16, damage: 0, effect: 'flash', effectMs: 3000 },
  // Smoke grenade: a thick cloud that blocks sight for a while.
  [WeaponId.SmokeGrenade]: { kind: 'throw', weight: 0.45, cooldownMs: 1100, speed: 14, elevation: 0.62, maxRange: 24, scatterBase: 1, scatterPerM: 0.07, fuseMs: 1500, radius: 7, damage: 0, effect: 'smoke', effectMs: 22000 },
  [WeaponId.C4]: { kind: 'throw', weight: 0.8, remote: true, cooldownMs: 1100, speed: 8, elevation: 0.62, maxRange: 8, scatterBase: .35, scatterPerM: .04, fuseMs: 0, radius: 8, damage: 220 },
  [WeaponId.Katana]: { kind: 'melee', weight: 1.4, decapitationChance: .12, damage: 38, range: 2.6, cooldownMs: 520, swingMs: 320 },
  [WeaponId.Quam]: { kind: 'melee', weight: 2.2, decapitationChance: .16, damage: 50, range: 3.2, cooldownMs: 850, swingMs: 420 },
  [WeaponId.Shovel]: { kind: 'melee', weight: 2.5, damage: 30, range: 2.7, cooldownMs: 750, swingMs: 400 },
  [WeaponId.Sledgehammer]: { kind: 'melee', weight: 8, damage: 90, range: 3.4, cooldownMs: 1800, swingMs: 1200, hitDelayMs: 450, animationMs: 1200, halfAngle: 1.4, cleaveMultiplier: .75, stunMs: 1300 },
  // Added melee: a quick blade, a stunning bat and a heavy, armour-cracking crowbar.
  [WeaponId.Machete]: { kind: 'melee', weight: 1.1, decapitationChance: .1, damage: 33, range: 2.4, cooldownMs: 460, swingMs: 300 },
  [WeaponId.BaseballBat]: { kind: 'melee', weight: 1.6, damage: 40, range: 2.6, cooldownMs: 680, swingMs: 380, stunMs: 500 },
  [WeaponId.Crowbar]: { kind: 'melee', weight: 2.4, damage: 47, range: 2.5, cooldownMs: 780, swingMs: 420, halfAngle: .9 },
  [WeaponId.Pickaxe]: { kind: 'melee', weight: 3, damage: 36, range: 2.6, cooldownMs: 900, swingMs: 520, hitDelayMs: 240, animationMs: 560, halfAngle: .9 },
  [WeaponId.FireAxe]: { kind: 'melee', weight: 3.5, damage: 65, range: 2.8, cooldownMs: 1050, swingMs: 650, hitDelayMs: 260, animationMs: 650, halfAngle: 1.1, cleaveMultiplier: .55, decapitationChance: .18 },
};

/** Inventory item id → weapon id. */
export const WEAPON_BY_ITEM: Readonly<Record<string, WeaponId>> = {
  ak47: WeaponId.AK47,
  pkm: WeaponId.PKM,
  barrett: WeaponId.Barrett,
  fire_axe: WeaponId.FireAxe,
  pickaxe: WeaponId.Pickaxe,
  shotgun: WeaponId.Shotgun,
  gl18: WeaponId.GL18,
  grenade: WeaponId.Grenade,
  flashbang: WeaponId.Flashbang,
  smoke_grenade: WeaponId.SmokeGrenade,
  c4_detonator: WeaponId.C4,
  c4: WeaponId.C4,
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
  shovel: WeaponId.Shovel,
  long_sledgehammer: WeaponId.Sledgehammer,
  deagle: WeaponId.Deagle,
  uzi: WeaponId.Uzi,
  scar_h: WeaponId.ScarH,
  kar98k: WeaponId.Kar98k,
  mini14: WeaponId.Mini14,
  machete: WeaponId.Machete,
  baseball_bat: WeaponId.BaseballBat,
  crowbar: WeaponId.Crowbar,
  vector: WeaponId.Vector,
  p90: WeaponId.P90,
  scar_l: WeaponId.ScarL,
};

export const ITEM_BY_WEAPON: Readonly<Record<number, string>> = Object.fromEntries(Object.entries(WEAPON_BY_ITEM).map(([k, v]) => [v, k]));

export function weaponSpec(weapon: number): WeaponSpec | undefined {
  return weapon ? WEAPON_SPECS[weapon as Exclude<WeaponId, 0>] : undefined;
}

/** Shots leave from chest/shoulder height so a level top-down aim hits torsos, not only heads. */
export const MUZZLE_HEIGHT = 1.35;
/** Muzzle height of a crouched shooter. */
export const CROUCH_MUZZLE_HEIGHT = .95;
export function muzzleHeight(prone = false, crouched = false): number { return prone ? .4 : crouched ? CROUCH_MUZZLE_HEIGHT : MUZZLE_HEIGHT; }
/** How far the head and gun move sideways when leaning out (m). */
export const LEAN_DISTANCE = .42;
/** −1 leaning left, 1 right, 0 upright, from the held buttons (both = upright). */
export function leanOf(buttons: number): -1 | 0 | 1 {
  const l = (buttons & (1 << 8)) !== 0, r = (buttons & (1 << 9)) !== 0;
  return l === r ? 0 : l ? -1 : 1;
}
/** World offset (x, z) of a lean towards the shooter's right (lean > 0) for a view yaw. */
export function leanOffset(yaw: number, lean: number): [number, number] {
  return [Math.cos(yaw) * LEAN_DISTANCE * lean, -Math.sin(yaw) * LEAN_DISTANCE * lean];
}
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

/** Only the weapon in hand burdens movement; backpack and slung weapons do not. */
export function weaponSpeedFactor(weapon: number): number {
  return Math.max(.6, 1 - (weaponSpec(weapon)?.weight ?? 0) * .018);
}

/** Extra effort from wielding a weapon, applied to running, dodging and attacks. */
export function weaponStaminaFactor(weapon: number): number {
  return 1 + (weaponSpec(weapon)?.weight ?? 0) * .055;
}

/** Guns spend effort per second of fire; melee and throws spend it per action. */
export function weaponAttackStaminaCost(weapon: number, baseCost: number, armorFactor = 1): number {
  const spec = weaponSpec(weapon);
  const interval = spec?.kind === 'gun' ? Math.min(1, spec.fireMs / 1000) : 1;
  return baseCost * armorFactor * weaponStaminaFactor(weapon) * interval;
}

export function rollsDecapitation(blade: MeleeSpec | undefined, random = Math.random): boolean {
  return !!blade?.decapitationChance && random() < blade.decapitationChance;
}
