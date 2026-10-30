import { VEHICLES, vehicleLocalPoint, type VehicleKind, type VehicleState } from './vehicles';
import { VEHICLE_ROLES, type VehicleClass } from './vehicle-arms';
import { seatAim, seatMount } from './vehicle-mounts';
import { HELI_FLIGHT } from './helicopter-flight';

/**
 * Vehicle components and their damage. The hull (fuselage) is the vehicle's own health; the other
 * parts each have a share of it and a health 0…1 in `VehicleState.parts`, and each one, damaged,
 * changes how the vehicle works:
 * - engine: less power (a tank or car crawls, a helicopter's rotor loses thrust); dead, no drive;
 * - tracks: a tank slows and turns sluggishly; broken, it cannot move;
 * - turret: traverses slower; jammed at zero;
 * - gun: reloads slower; wrecked, it cannot fire;
 * - main rotor: less lift and cyclic authority; destroyed, no lift at all;
 * - tail rotor: less yaw authority; failing, the main rotor's torque spins the airframe round;
 * - cockpit: damaged instruments and controls answer more slowly;
 * - weapon station (an APC's roof gun): as a gun.
 */
export type VehiclePart = 'hull' | 'engine' | 'tracks' | 'turret' | 'gun' | 'mainRotor' | 'tailRotor' | 'cockpit' | 'station';

export const VEHICLE_PARTS: Record<VehicleClass, readonly VehiclePart[]> = {
  tank: ['hull', 'engine', 'tracks', 'turret', 'gun'],
  heli: ['hull', 'mainRotor', 'tailRotor', 'engine', 'cockpit'],
  apc: ['hull', 'engine', 'station'],
  car: ['hull', 'engine'],
};

/** Part names for the HUD. */
export const PART_NAMES: Record<VehiclePart, string> = {
  hull: 'Thân xe', engine: 'Động cơ', tracks: 'Xích', turret: 'Tháp pháo', gun: 'Pháo chính',
  mainRotor: 'Cánh quạt chính', tailRotor: 'Cánh quạt đuôi', cockpit: 'Buồng lái', station: 'Trạm súng',
};

/** A part's hit points as a share of the vehicle's health (smaller: knocked out sooner). */
const PART_SHARE: Record<Exclude<VehiclePart, 'hull'>, number> = { engine: .3, tracks: .25, turret: .4, gun: .25, mainRotor: .3, tailRotor: .15, cockpit: .3, station: .2 };

export const vehicleParts = (kind: VehicleKind): readonly VehiclePart[] => VEHICLE_PARTS[VEHICLE_ROLES[kind].cls];
export const partName = (kind: VehicleKind, part: VehiclePart): string => part === 'hull' && VEHICLE_ROLES[kind].cls === 'heli' ? 'Thân máy bay' : PART_NAMES[part];

/** Health of a part, 0 (knocked out) … 1 (intact). The hull's is the vehicle's own health. */
export function partHealth(v: VehicleState, part: VehiclePart): number {
  if (part === 'hull') return Math.max(0, v.health / VEHICLES[v.kind].health);
  return v.parts?.[part] ?? 1;
}

/** Takes `amount` (vehicle health points) off a part; the hull takes it from the vehicle's health elsewhere. */
export function damagePart(v: VehicleState, part: VehiclePart, amount: number): void {
  if (part === 'hull' || !(amount > 0) || !vehicleParts(v.kind).includes(part)) return;
  const hp = VEHICLES[v.kind].health * PART_SHARE[part];
  (v.parts ??= {})[part] = Math.max(0, partHealth(v, part) - amount / hp);
}

/** The part a hit at world (x, y, z) lands on. */
export function partAt(v: VehicleState, x: number, y: number, z: number): VehiclePart {
  const p = vehicleLocalPoint(v, x, y, z), def = VEHICLES[v.kind], cls = VEHICLE_ROLES[v.kind].cls;
  if (cls === 'tank') {
    const m = seatMount(v.kind, 0);
    if (m) {
      // In the turret's own frame (it may be turned).
      const [yaw] = seatAim(v, 0), dx = p.x - m.yawAt[0], dz = p.z - m.yawAt[1], c = Math.cos(-yaw), s = Math.sin(-yaw);
      const tx = m.yawAt[0] + dx * c + dz * s, tz = m.yawAt[1] - dx * s + dz * c;
      const [gx, gy, gz] = m.pitchAt;
      if (tz < gz && Math.abs(tx - gx) < .45 && Math.abs(p.y - gy) < .6) return 'gun';
      const r = m.part;
      if (r && p.y >= r.y0 && (r.box ? tx >= r.box[0] && tz >= r.box[1] && tx <= r.box[2] && tz <= r.box[3] : Math.hypot(tx - m.yawAt[0], tz - m.yawAt[1]) <= r.r!)) return 'turret';
    }
    if (Math.abs(p.x) > def.halfX - .6 && p.y < 1.1) return 'tracks';
    if (p.z > def.halfZ * .35 && p.y < 1.7) return 'engine';
    return 'hull';
  }
  if (cls === 'heli') {
    const f = HELI_FLIGHT[v.kind];
    if (f) {
      if (p.z > f.tail[2] - 1.4) return 'tailRotor';
      if (p.y > f.hub[1] - .5 && Math.hypot(p.x - f.hub[0], p.z - f.hub[2]) < 1.2) return 'mainRotor';
      if (p.y > def.height * .55 && Math.abs(p.z - f.hub[2]) < 2.5) return 'engine';
    }
    if (p.z < -def.halfZ * .45) return 'cockpit';
    return 'hull';
  }
  if (cls === 'apc') {
    const gun = VEHICLE_ROLES[v.kind].weapons.find((w) => w.seat === 1)?.mounts[0];
    if (gun && Math.hypot(p.x - gun[0], p.y - gun[1], p.z - gun[2]) < 1.1) return 'station';
    if (p.z < -def.halfZ * .5) return 'engine';
    return 'hull';
  }
  return p.z < def.frontZ * .6 ? 'engine' : 'hull';
}

/* ---------------------------------------- effects ---------------------------------------- */

/** Engine power left (tanks and cars: drive; helicopters: rotor thrust). */
export function enginePower(v: VehicleState): number {
  const e = partHealth(v, 'engine');
  return e <= 0 ? 0 : .35 + .65 * e;
}
/** Drive left through a tank's tracks (1 for wheeled vehicles). */
export function trackDrive(v: VehicleState): number {
  if (!vehicleParts(v.kind).includes('tracks')) return 1;
  const t = partHealth(v, 'tracks');
  return t <= 0 ? 0 : .4 + .6 * t;
}
/** A mount's traverse and elevation rate left (turret, roof station). */
export function mountRate(v: VehicleState, seat: number): number {
  const part: VehiclePart | null = VEHICLE_ROLES[v.kind].cls === 'tank' ? seat === 0 ? 'turret' : null : seat === 1 && vehicleParts(v.kind).includes('station') ? 'station' : null;
  if (!part) return 1;
  const h = partHealth(v, part);
  return h <= 0 ? 0 : .25 + .75 * h;
}
/** Whether a seat's weapons can fire, and how much longer reloading takes. */
export function weaponState(v: VehicleState, seat: number): { fires: boolean; reload: number } {
  const part: VehiclePart | null = VEHICLE_ROLES[v.kind].cls === 'tank' && seat === 0 ? 'gun' : seat === 1 && vehicleParts(v.kind).includes('station') ? 'station' : null;
  if (!part) return { fires: true, reload: 1 };
  const h = partHealth(v, part);
  return { fires: h > 0, reload: 1 / (.4 + .6 * h) };
}
