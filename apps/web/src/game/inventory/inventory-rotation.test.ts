import { describe, expect, it, vi } from 'vitest';
import { InventoryStore } from './inventory';

describe('melee inventory rotation', () => {
  it('rotates in place, sends the move to the server and preserves item data', () => {
    const store = new InventoryStore();
    store.send = vi.fn();
    store.applyServer([{ uid: 1, itemId: 'katana', container: 'backpack', x: 0, y: 0, rotated: false, issued: true }], 1);
    expect(store.rotateItem(1)).toBe(true);
    expect(store.get().items[0]).toMatchObject({ rotated: true, issued: true });
    expect(store.send).toHaveBeenLastCalledWith({ t: 'inv', op: 'move', uid: 1, c: 'backpack', x: 0, y: 0, r: true });
    expect(store.rotateItem(1)).toBe(true);
    expect(store.get().items[0]!.rotated).toBe(false);
    expect(store.get().equipped).toBe(1);
  });
  it('rejects overlap, out of bounds, non-melee items and rotations in fixed weapon racks', () => {
    const store = new InventoryStore();
    store.send = vi.fn();
    const katana = { uid: 1, itemId: 'katana', container: 'backpack', x: 0, y: 0, rotated: false } as const;
    store.applyServer([katana, { uid: 2, itemId: 'potato', container: 'backpack', x: 0, y: 2, rotated: false }], null);
    expect(store.rotateItem(1)).toBe(false);
    expect(store.rotateItem(2)).toBe(false);
    store.applyServer([{ ...katana, y: 4 }], null);
    expect(store.rotateItem(1)).toBe(false);
    store.applyServer([{ ...katana, container: 'heavy' }], null);
    expect(store.rotateItem(1)).toBe(false);
    expect(store.send).not.toHaveBeenCalled();
  });
  it('rotates a dragged melee item and restores its original placement on cancel', () => {
    const store = new InventoryStore();
    store.applyServer([{ uid: 1, itemId: 'fire_axe', container: 'backpack', x: 0, y: 0, rotated: false }], null);
    store.pickUp(1); store.rotateHeld();
    expect(store.get().held!.rotated).toBe(true);
    store.returnHeld();
    expect(store.get().items[0]!.rotated).toBe(false);
  });
});
