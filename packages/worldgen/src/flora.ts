import { hash3 } from '@zion/shared';

/**
 * Shared flora catalogue and the "stand" field that makes vegetation grow the way it does in the
 * wild: neighbouring trees are mostly the same species (a stand of pines, a grove of broadleaves)
 * changing gradually over tens of metres, young growth mixed in, and boulders of one kind lying
 * together. Used by the survival scatter and the battle-royale island alike.
 */
export const FLORA_ASSET = {
  /** Low-poly forest pack: tall broadleaf crowns, oaks (trunk + branches), undergrowth, rocks. */
  forestTree: [2600, 2601, 2602, 2603, 2604, 2605, 2606, 2607],
  oakMature: [2608, 2610], oakYoung: [2609, 2611],
  shrub: [2612, 2613, 2614, 2615, 2616],
  rockSmall: [2617, 2620, 2624], rockMedium: [2619, 2621, 2623], rockBig: [2618, 2622],
  /** Stylized pine pack: mature pines, young pines, a sapling. */
  pine: [2626, 2627, 2628, 2629, 2630], pineYoung: [2631, 2632, 2633, 2634], sapling: 2635,
} as const;

const fract = (v: number) => v - Math.floor(v);
const cellValue = (seed: number, x: number, z: number, salt: number) => fract(hash3(seed, x, z, salt) / 4294967296);
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smooth 0…1 value noise with cells of `cell` metres: which stand (species group) is here. */
export function standValue(seed: number, x: number, z: number, cell = 46, salt = 0x57a2d): number {
  const gx = x / cell, gz = z / cell, ix = Math.floor(gx), iz = Math.floor(gz), tx = smooth(gx - ix), tz = smooth(gz - iz);
  const a = cellValue(seed, ix, iz, salt), b = cellValue(seed, ix + 1, iz, salt), c = cellValue(seed, ix, iz + 1, salt), d = cellValue(seed, ix + 1, iz + 1, salt);
  const top = a + (b - a) * tx, bottom = c + (d - c) * tx;
  return top + (bottom - top) * tz;
}

/** Picks from a list by the local stand (mostly) with a little individual variation. */
export function fromStand<T>(list: readonly T[], stand: number, own: number, spread = .22): T {
  const v = Math.min(.9999, Math.max(0, stand * (1 - spread) + own * spread));
  return list[Math.floor(v * list.length)]!;
}
