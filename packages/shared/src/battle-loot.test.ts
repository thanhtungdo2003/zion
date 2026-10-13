import { describe, expect, it } from 'vitest';
import { generateBattleLoot } from './chests';
import { ITEMS } from './items';
import { Rng } from './random';

describe('Battle Royale crates', () => {
  it('always supplies a loaded gun, matching ammo and armor, without survival supplies', () => {
    for (let seed = 0; seed < 500; seed++) {
      const rng = new Rng(seed), loot = generateBattleLoot([], () => rng.next());
      const gun = loot[0]!;
      expect(gun.mag).toBeGreaterThan(0);
      expect(ITEMS[loot[1]!.itemId]!.ammo?.guns).toContain(gun.itemId);
      expect(ITEMS[loot[2]!.itemId]!.category.startsWith('armor_')).toBe(true);
      expect(loot.length).toBeGreaterThanOrEqual(5);
      expect(new Set(loot.map(i => i.uid)).size).toBe(loot.length);
      for (const item of loot) {
        expect(ITEMS[item.itemId]).toBeDefined();
        expect(['food', 'resource', 'badge', 'tool']).not.toContain(ITEMS[item.itemId]!.category);
      }
    }
  });
  it('respects chest capacity and preserves existing items', () => {
    const full = Array.from({ length: 24 }, (_, i) => ({ uid: i + 1, itemId: 'medkit', container: 'backpack' as const, x: 0, y: 0, rotated: false }));
    expect(generateBattleLoot(full)).toEqual(full);
    expect(generateBattleLoot(full.slice(0, 23))).toHaveLength(24);
  });
});
