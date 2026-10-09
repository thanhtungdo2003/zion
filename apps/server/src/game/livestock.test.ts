import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE_LIFE } from '@zion/shared';
import { CollisionWorld } from '@zion/physics';
import type { CampSite } from '@zion/worldgen';
import type { Player } from './player';
import { Livestock } from './livestock';
const camp = { x: 0, y: 0, z: 0 } as CampSite;
function animal(index: number, random: () => number) {
  const def = DEFAULT_BASE_LIFE.animals![index]!;
  return new Livestock(index, def, camp, { x: 0, y: 0, z: 0, health: def.health, loot: 0 }, new CollisionWorld({ worldSize: 1000, seaLevel: -5 }), random);
}
describe('livestock', () => {
  it('boar retaliates for precisely the lower 80 percent of random outcomes', () => {
    let roll = 0;
    const boar = animal(1, () => roll / 100);
    let retaliations = 0;
    for (roll = 0; roll < 100; roll++) { boar.hit(0.001, {} as Player, 0); if (boar.retaliating) retaliations++; }
    expect(retaliations).toBe(80);
  });
  it('sheep do not retaliate; each death drops 3 to 5 items exactly once', () => {
    for (const index of [0, 1]) for (const random of [0, 0.9999]) {
      const a = animal(index, () => random);
      a.hit(1, {} as Player, 0);
      if (index === 0) expect(a.retaliating).toBe(false);
      expect(a.hit(100, {} as Player, 1)).toBe(true);
      const loot = a.record.loot;
      expect(loot).toBeGreaterThanOrEqual(3); expect(loot).toBeLessThanOrEqual(5);
      expect(a.hit(100, {} as Player, 2)).toBe(false);
      expect(a.record.loot).toBe(loot);
    }
  });
});
