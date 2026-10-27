import { describe, expect, it } from 'vitest';
import { CAMP_ASSET, FURNITURE_ASSET, STREET_ASSET } from '@zion/assets';
import { Rng } from '@zion/shared';
import { masonryBuilding } from './masonry';
import type { CampPart } from './camp';

const CRATES = new Set<number>([CAMP_ASSET['military-wooden-crate'], CAMP_ASSET['old-wooden-crate']]);
const FURNITURE = new Set<number>(Object.values(FURNITURE_ASSET));

describe('lived-in battle royale buildings', () => {
  it('an L-shaped block leaves its corner open, furnishes rooms, keeps loot scarce and the stair wide', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const parts: CampPart[] = [];
      masonryBuilding(parts, [], 0, 0, 0, { material: 'concrete', w: 18, d: 12, floors: 4, shape: 'L', interior: true }, 1, new Rng(seed));
      // No floor or roof in the missing front-right corner (x > 3, z < 0).
      const slabs = parts.filter((p) => p.asset === STREET_ASSET.slab || p.asset === STREET_ASSET.roof);
      expect(slabs.some((p) => p.x > 3 && p.z < 0)).toBe(false);
      // One crate at most per floor, and not on every floor.
      const crates = parts.filter((p) => CRATES.has(p.asset));
      const perFloor = new Map<number, number>();
      for (const p of crates) perFloor.set(Math.round(p.y / 3.2), (perFloor.get(Math.round(p.y / 3.2)) ?? 0) + 1);
      for (const n of perFloor.values()) expect(n).toBe(1);
      expect(crates.length).toBeGreaterThan(0);
      expect(crates.length).toBeLessThanOrEqual(4);
      expect(parts.some((p) => FURNITURE.has(p.asset))).toBe(true);
      // Two step blocks side by side on every flight: 1.8 m of stair across the 2 m stairwell.
      const steps = parts.filter((p) => p.asset === STREET_ASSET.step);
      expect(steps).toHaveLength(4 * 16 * 2);
      expect(new Set(steps.map((p) => p.x.toFixed(2))).size).toBe(2);
    }
  });

  it('furniture stays inside its rooms, off the stair', () => {
    const parts: CampPart[] = [];
    masonryBuilding(parts, [], 0, 0, 0, { material: 'brick', w: 10, d: 10, floors: 2, shape: 'rect', interior: true }, 1, new Rng(4));
    for (const p of parts.filter((q) => FURNITURE.has(q.asset))) {
      expect(Math.abs(p.x)).toBeLessThan(5);
      expect(Math.abs(p.z)).toBeLessThan(5);
      expect(p.x).toBeGreaterThan(-5 + 2);
    }
  });

  it('plain blocks (survival towns) keep their original layout', () => {
    const a: CampPart[] = [], b: CampPart[] = [];
    masonryBuilding(a, [], 0, 0, 0, { material: 'brick', w: 10, d: 10, floors: 2 }, 1, new Rng(9));
    masonryBuilding(b, [], 0, 0, 0, { material: 'brick', w: 10, d: 10, floors: 2, shape: 'rect' }, 1, new Rng(9));
    expect(b).toEqual(a);
    expect(a.some((p) => FURNITURE.has(p.asset))).toBe(false);
  });
});
