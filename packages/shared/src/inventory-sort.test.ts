import { describe, expect, it } from 'vitest';
import { InventoryModel, canPlace, type PlacedItem } from './inventory';

describe('auto-sort', () => {
  it('packs a scattered bag tightly, biggest first, and keeps every item', () => {
    const inv = new InventoryModel();
    const scattered: Array<[string, number, number]> = [['medkit', 6, 4], ['ammo_762', 0, 4], ['grenade', 7, 0], ['ammo_762', 3, 2], ['potato', 5, 1], ['old_hard_hat', 2, 0]];
    inv.load({ items: scattered.map(([itemId, x, y], i): PlacedItem => ({ uid: i + 1, itemId, container: 'backpack', x, y, rotated: false })), equipped: null });
    const before = inv.items.length;
    expect(inv.sort('backpack')).toBe(true);
    expect(inv.items).toHaveLength(before);
    // No overlaps, and everything sits in the top rows from the left.
    for (const it of inv.items) expect(canPlace(inv.items, 'backpack', it.itemId, it.x, it.y, it.rotated, it.uid)).toBe(true);
    expect(Math.max(...inv.items.map((i) => i.y))).toBeLessThanOrEqual(1);
    const hat = inv.items.find((i) => i.itemId === 'old_hard_hat')!;
    expect([hat.x, hat.y]).toEqual([0, 0]);
  });
});
