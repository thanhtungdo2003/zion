import { hash2, hashToUnit, lerp } from '@zion/shared';

/** Smooth world-space patches, shared by neighbouring chunks. */
export function vegetationPatch(x: number, z: number, size: number, seed: number): number {
  const gx = Math.floor(x / size);
  const gz = Math.floor(z / size);
  const fx = x / size - gx;
  const fz = z / size - gz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const sample = (dx: number, dz: number) => hashToUnit(hash2(seed, gx + dx, gz + dz));
  return lerp(lerp(sample(0, 0), sample(1, 0), u), lerp(sample(0, 1), sample(1, 1), u), v);
}
