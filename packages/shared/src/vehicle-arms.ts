import type { VehicleKind } from './vehicles';

/**
 * What each vehicle is for, who sits where and what each seat can fire. Positions are in the
 * vehicle's own metres (+X right, +Y up, −Z forward), like `VEHICLES` seats.
 *
 * Ammunition follows the real systems in spirit, scaled for play:
 * - tank guns load one round at a time (autoloader ~7 s, manual ~9 s) from a ready rack;
 * - machine guns fire belts (100–250) and reload a new belt in a few seconds;
 * - rocket pods fire salvoes of 70–80 mm unguided rockets and are rearmed slowly;
 * - anti-tank missiles fly to the vehicle locked at launch (or the point under the sights),
 *   lose the lock to flares (helicopters) or a smoke screen (armour).
 * Countermeasures (V): helicopters drop flares, armour fires a smoke screen; a few charges, then a
 * long recharge.
 */

export type VehicleClass = 'car' | 'tank' | 'apc' | 'heli';
export type VehicleWeaponKind = 'cannon' | 'mg' | 'autocannon' | 'rockets' | 'missile';
export type VehicleProjectile = 'shell' | 'bullet' | 'rocket' | 'missile';

export interface VehicleWeapon {
  id: string;
  name: string;
  /** Seat that fires it, and with which button (left = primary, right = secondary). */
  seat: number;
  trigger: 'primary' | 'secondary';
  kind: VehicleWeaponKind;
  projectile: VehicleProjectile;
  /** Muzzles (several: alternate, e.g. a pod on each side). */
  mounts: ReadonlyArray<readonly [number, number, number]>;
  /** Rounds per load, spare rounds carried, ms between shots, ms to reload. */
  magazine: number;
  reserve: number;
  fireMs: number;
  reloadMs: number;
  /** m/s and m/s² of drop. */
  speed: number;
  gravity: number;
  /** Radians of random spread. */
  spread: number;
  range: number;
  /** Damage to a person hit directly, and to a vehicle hit directly. */
  damage: number;
  vehicleDamage: number;
  blast?: { radius: number; damage: number; vehicleDamage: number };
  /** Guided: steers to its target this fast (rad/s). */
  turnRate?: number;
  /** How far the barrel turns from straight ahead (radians): left/right and down/up. */
  arc: { yaw: number; pitchDown: number; pitchUp: number };
}

export interface Countermeasure { kind: 'flares' | 'smoke'; name: string; charges: number; cooldownMs: number; durationMs: number }

export interface VehicleRole {
  cls: VehicleClass;
  /** Names of the seats, by index (0 drives / flies). */
  seats: readonly string[];
  weapons: readonly VehicleWeapon[];
  countermeasure?: Countermeasure;
  /** Troops ride in the back (the seats after the gunners). */
  transport: boolean;
  /** Seats inside the hull: their riders are out of sight (and out of reach of small arms). */
  inside?: readonly number[];
  /** Small-arms rounds below this do nothing to the hull (armour). */
  armor: number;
  /** Share of blast damage that gets through. */
  blastFactor: number;
}

const ARC_TURRET = { yaw: Math.PI, pitchDown: .14, pitchUp: .35 };
const ARC_MG = { yaw: Math.PI, pitchDown: .3, pitchUp: .8 };
const ARC_CHIN = { yaw: 1.6, pitchDown: 1.0, pitchUp: .25 };
const ARC_FIXED = { yaw: .12, pitchDown: .35, pitchUp: .12 };
const ARC_DOOR = { yaw: 1.3, pitchDown: 1.1, pitchUp: .4 };

const cannon = (id: string, name: string, muzzle: readonly [number, number, number], reloadMs: number, reserve: number, calibre: number): VehicleWeapon => ({
  id, name, seat: 0, trigger: 'primary', kind: 'cannon', projectile: 'shell', mounts: [muzzle], magazine: 1, reserve, fireMs: 400, reloadMs,
  speed: 260, gravity: 3.5, spread: .002, range: 900, damage: 200, vehicleDamage: 1000 + (calibre - 100) * 6,
  blast: { radius: 4.5, damage: 140, vehicleDamage: 160 }, arc: ARC_TURRET,
});
const coax = (muzzle: readonly [number, number, number]): VehicleWeapon => ({
  id: 'coax', name: 'Súng máy đồng trục PKT 7,62', seat: 0, trigger: 'secondary', kind: 'mg', projectile: 'bullet', mounts: [muzzle], magazine: 250, reserve: 1000, fireMs: 90, reloadMs: 4000,
  speed: 600, gravity: 9.8, spread: .012, range: 400, damage: 24, vehicleDamage: 8, arc: ARC_TURRET,
});
const hmg = (seat: number, name: string, muzzle: readonly [number, number, number], arc = ARC_MG): VehicleWeapon => ({
  id: `hmg${seat}`, name, seat, trigger: 'primary', kind: 'mg', projectile: 'bullet', mounts: [muzzle], magazine: 100, reserve: 500, fireMs: 110, reloadMs: 4500,
  speed: 700, gravity: 9.8, spread: .014, range: 500, damage: 40, vehicleDamage: 30, arc,
});
const pkm = (seat: number, muzzle: readonly [number, number, number]): VehicleWeapon => ({
  id: `door${seat}`, name: 'Súng máy cửa PKM 7,62', seat, trigger: 'primary', kind: 'mg', projectile: 'bullet', mounts: [muzzle], magazine: 200, reserve: 800, fireMs: 90, reloadMs: 4000,
  speed: 650, gravity: 9.8, spread: .016, range: 450, damage: 26, vehicleDamage: 10, arc: ARC_DOOR,
});
const rockets = (seat: number, trigger: 'primary' | 'secondary', name: string, pods: ReadonlyArray<readonly [number, number, number]>, magazine: number, reserve: number): VehicleWeapon => ({
  id: 'rockets', name, seat, trigger, kind: 'rockets', projectile: 'rocket', mounts: pods, magazine, reserve, fireMs: 140, reloadMs: 16_000,
  speed: 160, gravity: 2, spread: .02, range: 900, damage: 120, vehicleDamage: 380, blast: { radius: 5, damage: 110, vehicleDamage: 160 }, arc: ARC_FIXED,
});
const missile = (seat: number, trigger: 'primary' | 'secondary', name: string, rails: ReadonlyArray<readonly [number, number, number]>, magazine: number, reserve: number): VehicleWeapon => ({
  id: 'missile', name, seat, trigger, kind: 'missile', projectile: 'missile', mounts: rails, magazine, reserve, fireMs: 1200, reloadMs: 14_000,
  speed: 120, gravity: 0, spread: 0, range: 1400, damage: 250, vehicleDamage: 1500, blast: { radius: 4, damage: 150, vehicleDamage: 200 }, turnRate: 1.6, arc: { yaw: .5, pitchDown: .8, pitchUp: .3 },
});
const SMOKE: Countermeasure = { kind: 'smoke', name: 'Lựu đạn khói 902B', charges: 2, cooldownMs: 45_000, durationMs: 18_000 };
const FLARES: Countermeasure = { kind: 'flares', name: 'Mồi bẫy nhiệt', charges: 3, cooldownMs: 35_000, durationMs: 5000 };
const TANK_SEATS = ['Trưởng xe · lái & pháo chính (trong xe)', 'Súng máy trên tháp pháo'] as const;

export const VEHICLE_ROLES: Record<VehicleKind, VehicleRole> = {
  car: { cls: 'car', seats: ['Lái', 'Ghế phụ', 'Sau trái', 'Sau phải'], weapons: [], transport: true, armor: 0, blastFactor: 1 },
  jeep: { cls: 'car', seats: ['Lái', 'Ghế phụ', 'Sau trái', 'Sau phải'], weapons: [], transport: true, armor: 0, blastFactor: 1 },
  quad: { cls: 'car', seats: ['Lái', 'Sau'], weapons: [], transport: true, armor: 0, blastFactor: 1 },
  grizzly: { cls: 'car', seats: ['Lái', 'Sau'], weapons: [], transport: true, armor: 0, blastFactor: 1 },
  t80u: { cls: 'tank', seats: TANK_SEATS, inside: [0], weapons: [cannon('cannon', 'Pháo 125 mm 2A46M-1', [0, 1.6, -6.2], 7000, 36, 125), coax([.35, 1.62, -1.9]), hmg(1, 'Súng máy NSVT 12,7', [1.0, 2.5, -2.0])], countermeasure: SMOKE, transport: false, armor: 140, blastFactor: .35 },
  t90a: { cls: 'tank', seats: TANK_SEATS, inside: [0], weapons: [cannon('cannon', 'Pháo 125 mm 2A46M-5', [0, 1.75, -5.9], 7000, 40, 125), coax([.35, 1.75, -1.8]), hmg(1, 'Súng máy Kord 12,7', [.6, 2.5, -1.0])], countermeasure: SMOKE, transport: false, armor: 140, blastFactor: .35 },
  t62a: { cls: 'tank', seats: TANK_SEATS, inside: [0], weapons: [cannon('cannon', 'Pháo 115 mm U-5TS', [0, 1.8, -6.2], 9000, 40, 115), coax([.35, 1.8, -1.9]), hmg(1, 'Súng máy DShK 12,7', [.6, 2.75, -1.9])], countermeasure: SMOKE, transport: false, armor: 120, blastFactor: .4 },
  tank: { cls: 'tank', seats: TANK_SEATS, inside: [0], weapons: [cannon('cannon', 'Pháo 105 mm', [0, 1.9, -5.3], 8000, 44, 105), coax([.35, 1.9, -2.0]), hmg(1, 'Súng máy M2 12,7', [.55, 2.8, -.8])], countermeasure: SMOKE, transport: false, armor: 130, blastFactor: .38 },
  marauder: { cls: 'apc', seats: ['Lái', 'Súng máy trạm điều khiển', 'Lính 1', 'Lính 2', 'Lính 3', 'Lính 4', 'Lính 5', 'Lính 6', 'Lính 7', 'Lính 8'], weapons: [hmg(1, 'Súng máy 12,7 trên nóc', [0, 3.45, -.3])], countermeasure: SMOKE, transport: true, armor: 60, blastFactor: .55 },
  mi17: { cls: 'heli', seats: ['Phi công', 'Súng máy cửa trái', 'Súng máy cửa phải', 'Lính 1', 'Lính 2', 'Lính 3', 'Lính 4', 'Lính 5', 'Lính 6', 'Lính 7', 'Lính 8', 'Lính 9', 'Lính 10', 'Lính 11', 'Lính 12'],
    weapons: [rockets(0, 'primary', 'Rocket S-8 (B8V20)', [[-2.3, 1.25, -2.4], [2.3, 1.25, -2.4]], 20, 20), pkm(1, [-1.5, 2.0, -4.6]), pkm(2, [1.5, 2.0, -4.6])], countermeasure: FLARES, transport: true, armor: 0, blastFactor: 1 },
  z10: { cls: 'heli', seats: ['Phi công', 'Xạ thủ'],
    weapons: [rockets(0, 'primary', 'Rocket 90 mm', [[-1.65, 1.15, -.6], [1.65, 1.15, -.6]], 14, 14), missile(0, 'secondary', 'Tên lửa chống tăng HJ-10', [[-2.1, 1.1, -.4], [2.1, 1.1, -.4]], 4, 4),
      { id: 'gun', name: 'Pháo 23 mm', seat: 1, trigger: 'primary', kind: 'autocannon', projectile: 'shell', mounts: [[0, .45, -5.7]], magazine: 125, reserve: 250, fireMs: 120, reloadMs: 6000, speed: 500, gravity: 6, spread: .01, range: 700, damage: 70, vehicleDamage: 70, blast: { radius: 1.6, damage: 35, vehicleDamage: 20 }, arc: ARC_CHIN }],
    countermeasure: FLARES, transport: false, armor: 0, blastFactor: 1 },
  tiger: { cls: 'heli', seats: ['Phi công', 'Xạ thủ'],
    weapons: [missile(0, 'primary', 'Tên lửa chống tăng HOT 3', [[-1.75, 1.1, -.3], [1.75, 1.1, -.3]], 4, 4), rockets(0, 'secondary', 'Rocket 68 mm SNEB', [[-1.45, 1.05, -.5], [1.45, 1.05, -.5]], 12, 12),
      { id: 'gun', name: 'Súng máy treo 12,7', seat: 1, trigger: 'primary', kind: 'mg', projectile: 'bullet', mounts: [[-1.35, .95, -.9], [1.35, .95, -.9]], magazine: 200, reserve: 400, fireMs: 85, reloadMs: 5000, speed: 750, gravity: 9.8, spread: .012, range: 600, damage: 42, vehicleDamage: 32, arc: ARC_FIXED }],
    countermeasure: FLARES, transport: false, armor: 0, blastFactor: 1 },
};

export const isAircraft = (kind: VehicleKind): boolean => VEHICLE_ROLES[kind].cls === 'heli';
/** The weapon a seat fires with a trigger (undefined: that seat fires the rider's own gun, or nothing). */
export const seatWeapon = (kind: VehicleKind, seat: number, trigger: 'primary' | 'secondary'): VehicleWeapon | undefined =>
  VEHICLE_ROLES[kind].weapons.find((w) => w.seat === seat && w.trigger === trigger);
/** Seats with a vehicle weapon (their riders do not use their own guns). */
export const armedSeat = (kind: VehicleKind, seat: number): boolean => VEHICLE_ROLES[kind].weapons.some((w) => w.seat === seat);

/** Ammunition and countermeasures, as carried in the vehicle state. */
export interface VehicleArmsState {
  /** Per weapon id: rounds loaded, spare rounds, reloading until (server ms, 0 = not). */
  ammo: Record<string, { mag: number; reserve: number; reloadUntil: number }>;
  /** Countermeasure charges left, recharge done at, effect active until. */
  cm: { charges: number; readyAt: number; activeUntil: number };
}

export function freshArms(kind: VehicleKind): VehicleArmsState {
  const role = VEHICLE_ROLES[kind];
  const ammo: VehicleArmsState['ammo'] = {};
  for (const w of role.weapons) ammo[w.id] = { mag: w.magazine, reserve: w.reserve, reloadUntil: 0 };
  return { ammo, cm: { charges: role.countermeasure?.charges ?? 0, readyAt: 0, activeUntil: 0 } };
}

/**
 * One trigger pull at `now`: whether a round leaves (and the state after it). A load runs out →
 * the reload starts by itself; nothing fires while reloading or before `fireMs` has passed.
 */
export function useVehicleRound(w: VehicleWeapon, a: VehicleArmsState['ammo'][string], lastShot: number, now: number): boolean {
  if (a.reloadUntil) {
    if (now < a.reloadUntil) return false;
    const take = Math.min(w.magazine - a.mag, a.reserve);
    a.mag += take; a.reserve -= take; a.reloadUntil = 0;
  }
  if (a.mag <= 0 || now - lastShot < w.fireMs) return false;
  a.mag--;
  if (a.mag <= 0 && a.reserve > 0) a.reloadUntil = now + w.reloadMs;
  return true;
}

/** Countermeasure (V): uses a charge when one is left; all charges come back after the cooldown. */
export function triggerCountermeasure(role: VehicleRole, cm: VehicleArmsState['cm'], now: number): boolean {
  const c = role.countermeasure;
  if (!c) return false;
  if (cm.charges <= 0 && now >= cm.readyAt) cm.charges = c.charges;
  if (cm.charges <= 0 || now < cm.activeUntil) return false;
  cm.charges--;
  cm.activeUntil = now + c.durationMs;
  if (cm.charges <= 0) cm.readyAt = now + c.cooldownMs;
  return true;
}
