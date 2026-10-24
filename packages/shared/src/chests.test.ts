import { describe, expect, it } from 'vitest';
import { ARMOR_BY_ITEM } from './armor';
import { ITEMS } from './items';
import { Rng } from './random';
import { CHEST_CAPACITY, chestKey, generateChestLoot, rollChestItem } from './chests';

describe('chest loot', () => {
  it('uses seeded sampling to keep weapons/armor rare and elite loot extremely rare', () => {
    const rng = new Rng(123); let weapons = 0, armor = 0, elite = 0;
    for (let i = 0; i < 100_000; i++) {
      const id = rollChestItem(() => rng.next()); const item = ITEMS[id]!;
      expect(item).toBeDefined();
      if (['rifle', 'pistol', 'smg', 'shotgun', 'heavy'].includes(item.category)) weapons++;
      if (ARMOR_BY_ITEM.has(id)) armor++;
      if (['awm', 'm4a1', 'aug', 'svd', 'saiga12', 'grenade_launcher', 'rocket_launcher'].includes(id) || ['rare', 'epic', 'legendary'].includes(ARMOR_BY_ITEM.get(id)?.rarity ?? '')) elite++;
    }
    expect(weapons / 100_000).toBeLessThan(.04);
    expect(armor / 100_000).toBeLessThan(.03);
    expect(elite / 100_000).toBeGreaterThan(.001);
    expect(elite / 100_000).toBeLessThan(.003);
  });
  it('preserves stored items, respects capacity and creates usable ammo', () => {
    const existing = generateChestLoot([], () => 0);
    expect(existing).toHaveLength(3);
    expect(existing[0]).toMatchObject({ itemId: 'ammo_9mm', count: 30 });
    const full = Array.from({ length: CHEST_CAPACITY - 1 }, (_, i) => ({ ...existing[0]!, uid: i + 1 }));
    const result = generateChestLoot(full, () => .99);
    expect(result).toHaveLength(CHEST_CAPACITY);
    expect(result.slice(0, -1)).toEqual(full);
    expect(new Set(result.map((i) => i.uid)).size).toBe(result.length);
  });
  it('identifies a prop consistently across chunk decoding', () => {
    expect(chestKey(2002, 10.1234001, 20, -30)).toBe(chestKey(2002, 10.1234, 20, -30));
  });
});
