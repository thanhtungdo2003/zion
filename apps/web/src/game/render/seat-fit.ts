import { VEHICLES, VEHICLE_ROLES, armedSeat, type VehicleKind } from '@zion/shared';
import type { ModelPart } from './bbmodel-loader';

/**
 * Where riders really sit in a vehicle's model. A vertical ray through each seat finds the cushion
 * (the highest surface below head height) and one ahead of it the floor under the feet: the rider
 * sits on the cushion (never sunk into it) and the feet are kept off the floor. Gunners standing at
 * a gun, the crew inside a hull and aircraft keep their seats as given.
 */
export interface SeatFit {
  /** Rider's origin height (vehicle metres), or null to keep the seat's own. */
  y: number | null;
  /** Floor under the feet (vehicle metres), or null for none. */
  floor: number | null;
}

/** Seated, the rider's origin sits this far below the cushion's top (hips over the thighs; astride a quad, higher). */
export const SIT_HEIGHT = .5;
const ASTRIDE_HEIGHT = .6;
/** How far a measured seat may move from the one in the vehicle data (a stray hit is ignored). */
const MAX_SHIFT = .6;
const FEET_AHEAD = .5;

const fits = new WeakMap<readonly ModelPart[], SeatFit[]>();

export function fitSeats(kind: VehicleKind, parts: readonly ModelPart[]): SeatFit[] {
  const known = fits.get(parts);
  if (known) return known;
  const def = VEHICLES[kind], role = VEHICLE_ROLES[kind], scale = def.scale;
  const tris: number[] = [];
  for (const part of parts) {
    if (part.wheel !== undefined || part.rotor) continue;
    const pos = part.geometry.getAttribute('position'), index = part.geometry.index;
    const n = index ? index.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) for (let c = 0; c < 3; c++) {
      const k = index ? index.getX(i + c) : i + c;
      tris.push(pos.getX(k) * scale, pos.getY(k) * scale, pos.getZ(k) * scale);
    }
  }
  /** Heights where a vertical line at (x, z) crosses the model, highest first. */
  const crossings = (x: number, z: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < tris.length; i += 9) {
      const ax = tris[i]!, ay = tris[i + 1]!, az = tris[i + 2]!, bx = tris[i + 3]!, by = tris[i + 4]!, bz = tris[i + 5]!, cx = tris[i + 6]!, cy = tris[i + 7]!, cz = tris[i + 8]!;
      const d = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((x - ax) * (cz - az) - (cx - ax) * (z - az)) / d, w = ((bx - ax) * (z - az) - (x - ax) * (bz - az)) / d;
      if (u < 0 || w < 0 || u + w > 1) continue;
      out.push(ay + u * (by - ay) + w * (cy - ay));
    }
    return out.sort((a, b) => b - a);
  };
  const ground = role.cls === 'car' || role.cls === 'apc';
  const out = def.seats.map(([x, y, z], seat): SeatFit => {
    if (!ground || armedSeat(kind, seat) || role.inside?.includes(seat)) return { y: null, floor: null };
    // The cushion: the highest surface a sitting body's head clears (roofs, wheels and bars above it are not seats).
    const cushion = crossings(x, z).find((h) => h < y + 1.2), sit = def.quad ? ASTRIDE_HEIGHT : SIT_HEIGHT;
    if (cushion === undefined || Math.abs(cushion - sit - y) > MAX_SHIFT) return { y: null, floor: null };
    // Straddling a quad the feet hang either side on the footrests: no floor ahead to keep them off.
    const floor = def.quad ? undefined : crossings(x, z - FEET_AHEAD).find((h) => h < cushion - .25);
    return { y: cushion - sit, floor: floor ?? null };
  });
  fits.set(parts, out);
  return out;
}
