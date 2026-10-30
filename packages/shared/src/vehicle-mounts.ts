import { VEHICLES, vehiclePoint, type VehicleKind, type VehicleState } from './vehicles';
import { VEHICLE_ROLES, type VehicleWeapon } from './vehicle-arms';
import { mountRate } from './vehicle-parts';

/**
 * Turning weapon mounts: a tank's turret (its main gun pitching in it) and the machine guns on
 * roofs and turrets. Each mount follows its seat's aim at a limited traverse rate; the server keeps
 * the actual aim in `VehicleState.aim` (relative to the hull), fires along it from the muzzle where
 * the barrel really is, and every client draws the turret from it.
 *
 * Geometry is in the vehicle's own metres (+X right, +Y up, −Z forward; armour is prepared at
 * scale 1, so these are the prepared model's coordinates too). `part` says which of the model's
 * triangles turn with the mount: all three corners above `y0` and inside the ring (a circle round
 * the yaw axis, or a box). A model with no gun of its own there gets a generic one drawn
 * (`procedural`).
 */
export interface WeaponMount {
  seat: number;
  /** The vertical axis it traverses about (x, z), and the trunnion its barrel elevates about. */
  yawAt: readonly [number, number];
  pitchAt: readonly [number, number, number];
  /** Rides on another seat's mount (a roof gun on the turret): turns with it as well. */
  on?: number;
  /** Traverse and elevation rates, rad/s. */
  traverse: number;
  elevate: number;
  part?: { y0: number; r?: number; box?: readonly [number, number, number, number]; y1?: number };
  /** Barrel triangles (within `half` of its height and line, centred ahead of the trunnion) elevate; the rest only traverse. */
  barrel?: { half: number };
  procedural?: boolean;
}

const tank = (ring: readonly [number, number], part: WeaponMount['part'], trunnion: readonly [number, number, number], mg: Omit<WeaponMount, 'seat' | 'on' | 'traverse' | 'elevate'>): WeaponMount[] => [
  // Powered turrets traverse a full turn in ~9 s; the gun elevates slowly.
  { seat: 0, yawAt: ring, pitchAt: trunnion, traverse: .7, elevate: .35, part, barrel: { half: .35 } },
  { seat: 1, on: 0, traverse: 2.2, elevate: 1.6, ...mg },
];

export const VEHICLE_MOUNTS: Partial<Record<VehicleKind, readonly WeaponMount[]>> = {
  t80u: tank([0, -.3], { y0: 1.3, r: 2 }, [0, 1.6, -1.9], { yawAt: [.95, -.4], pitchAt: [.95, 2.45, -.4], part: { y0: 2.3, box: [.6, -2.1, 1.3, -.1] } }),
  t90a: tank([0, 0], { y0: 1.4, r: 2 }, [0, 1.75, -1.5], { yawAt: [.6, .1], pitchAt: [.6, 2.45, .1], procedural: true }),
  t62a: tank([0, -.2], { y0: 1.55, r: 1.6 }, [0, 1.8, -1.5], { yawAt: [.6, -.4], pitchAt: [.6, 2.7, -.4], part: { y0: 2.45, box: [.2, -2, 1, 0] } }),
  tank: tank([0, .4], { y0: 1.3, box: [-1.85, -2, 1.85, 2.75] }, [0, 1.95, -1.8], { yawAt: [.55, .3], pitchAt: [.55, 2.75, .3], procedural: true }),
  // The Marauder's remote weapon station on the roof hatch.
  marauder: [{ seat: 1, yawAt: [0, .8], pitchAt: [0, 3.4, .8], traverse: 2.2, elevate: 1.6, procedural: true }],
};

export const vehicleMounts = (kind: VehicleKind): readonly WeaponMount[] => VEHICLE_MOUNTS[kind] ?? [];
export const seatMount = (kind: VehicleKind, seat: number): WeaponMount | undefined => VEHICLE_MOUNTS[kind]?.find((m) => m.seat === seat);

/** A seat's aim relative to the hull: [yaw, pitch] (0, 0 = straight ahead, level). */
export function seatAim(v: VehicleState, seat: number): [number, number] {
  return [v.aim?.[seat * 2] ?? 0, v.aim?.[seat * 2 + 1] ?? 0];
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The weapon of a mount whose arc limits it (the seat's primary). */
function mountArc(kind: VehicleKind, seat: number): VehicleWeapon['arc'] | undefined {
  return VEHICLE_ROLES[kind].weapons.find((w) => w.seat === seat)?.arc;
}

/**
 * Turns a seat's mount towards a world aim (yaw, pitch) at its traverse and elevation rates,
 * within its arc. Returns how far it still is from the aim (radians, the larger of the two).
 */
export function slewMount(v: VehicleState, seat: number, yaw: number, pitch: number, dt: number): number {
  const m = seatMount(v.kind, seat), arc = mountArc(v.kind, seat);
  if (!m || !arc) return 0;
  const aim = v.aim ??= [];
  while (aim.length < seat * 2 + 2) aim.push(0);
  const wantYaw = Math.max(-arc.yaw, Math.min(arc.yaw, wrap(yaw - v.yaw))), wantPitch = Math.max(-arc.pitchDown, Math.min(arc.pitchUp, pitch));
  // Full-circle turrets take the short way round.
  const dy = arc.yaw >= Math.PI ? wrap(wantYaw - aim[seat * 2]!) : wantYaw - aim[seat * 2]!, dp = wantPitch - aim[seat * 2 + 1]!;
  // A damaged turret or weapon station traverses slower; jammed, not at all.
  const rate = mountRate(v, seat), tr = m.traverse * rate * dt, el = m.elevate * rate * dt;
  aim[seat * 2] = wrap(aim[seat * 2]! + Math.max(-tr, Math.min(tr, dy)));
  aim[seat * 2 + 1] = aim[seat * 2 + 1]! + Math.max(-el, Math.min(el, dp));
  return Math.max(Math.abs(wrap(wantYaw - aim[seat * 2]!)), Math.abs(wantPitch - aim[seat * 2 + 1]!));
}

/**
 * A point of a seat's mount (vehicle-local, at rest) where it is with the mounts turned:
 * elevated about the trunnion, traversed about the mount's axis, then carried round by the mount
 * it rides on. `elevates`: the point is on the barrel (false: the turret body, a seat on it).
 */
export function mountedPoint(v: VehicleState, seat: number, x: number, y: number, z: number, elevates = true): { x: number; y: number; z: number } {
  const m = seatMount(v.kind, seat);
  if (!m) return { x, y, z };
  const [yaw, pitch] = seatAim(v, seat), parent = m.on !== undefined ? seatMount(v.kind, m.on) : undefined;
  const parentYaw = parent ? seatAim(v, parent.seat)[0] : 0;
  if (elevates && pitch) {
    // Up is +pitch: a forward (−Z) barrel tips upwards.
    const [, py, pz] = m.pitchAt, dy = y - py, dz = z - pz, c = Math.cos(pitch), s = Math.sin(pitch);
    y = py + dy * c - dz * s; z = pz + dy * s + dz * c;
  }
  ({ x, z } = turn(x, z, m.yawAt, yaw - parentYaw));
  if (parent) ({ x, z } = turn(x, z, parent.yawAt, parentYaw));
  return { x, y, z };
}
/** Yaw (+ = to the left, as the vehicle's) about a vertical axis at (ax, az). */
function turn(x: number, z: number, at: readonly [number, number], yaw: number): { x: number; z: number } {
  if (!yaw) return { x, z };
  const dx = x - at[0], dz = z - at[1], c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: at[0] + dx * c + dz * s, z: at[1] - dx * s + dz * c };
}

/** World position of a weapon's muzzle `k`, the mount turned as it is now. */
export function weaponMuzzle(v: VehicleState, w: VehicleWeapon, k = 0): { x: number; y: number; z: number } {
  const [mx, my, mz] = w.mounts[k] ?? w.mounts[0]!;
  const p = mountedPoint(v, w.seat, mx, my, mz);
  return vehiclePoint(v, p.x, p.y, p.z);
}

/** World position of a seat, carried round by its mount (a gunner standing at a roof gun). */
export function mountedSeat(v: VehicleState, seat: number): { x: number; y: number; z: number } {
  const [x, y, z] = VEHICLES[v.kind].seats[seat] ?? VEHICLES[v.kind].seat;
  const p = mountedPoint(v, seat, x, y, z, false);
  return vehiclePoint(v, p.x, p.y, p.z);
}
