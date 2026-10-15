import { describe, expect, it } from 'vitest';
import { buyPrice, SHOP_STOCK } from './shop';
import { ITEMS } from './items';
import { InventoryModel } from './inventory';
import { compatibleSlot } from './attachments';
import { ITEM_BY_WEAPON, WEAPON_BY_ITEM, weaponSpec } from './weapons';
import { customWeaponSchema, registerCustomWeapon, unregisterCustomWeapon, type CustomWeapon } from './custom-weapons';

const gun: CustomWeapon = customWeaponSchema.parse({
  id: 'cw_test_rifle', weaponId: 120, name: 'Thử nghiệm', info: '', kind: 'gun', format: 'glb',
  item: { category: 'rifle', w: 5, h: 2, color: '#444444' },
  model: { length: .9, barrel: [0, 0, -1], up: [0, 1, 0], grip: [0, 0, 0], muzzle: [0, .1, -1], rail: [0, .2, 0] },
  gun: { damage: 15, pellets: 1, fireMs: 90, spread: .02, range: 80, magazine: 25, reloadMs: 2300, auto: true, weight: 3.4, recoil: 1.1, ammo: 'ammo_556', sound: 'rifleShot', optics: ['red_dot'], muzzleDevices: [] },
  price: 650, lootable: true,
});

describe('Studio weapons', () => {
  it('registers into every shared table and can be bought, loaded and dressed', () => {
    registerCustomWeapon(gun);
    expect(WEAPON_BY_ITEM.cw_test_rifle).toBe(120);
    expect(ITEM_BY_WEAPON[120]).toBe('cw_test_rifle');
    expect(weaponSpec(120)).toMatchObject({ kind: 'gun', damage: 15, recoil: 1.1 });
    expect(ITEMS.cw_test_rifle).toMatchObject({ category: 'rifle', stance: 'rifle' });
    expect(ITEMS.ammo_556!.ammo!.guns).toContain('cw_test_rifle');
    expect(buyPrice('cw_test_rifle')).toBe(650);
    expect(SHOP_STOCK.filter((e) => e.item === 'cw_test_rifle')).toHaveLength(1);
    expect(compatibleSlot('cw_test_rifle', 'red_dot')).toBe('optic');
    const inv = new InventoryModel({ items: [], equipped: null });
    expect(inv.add('cw_test_rifle')?.mag).toBe(25);
    // Saving again replaces, never duplicates.
    registerCustomWeapon({ ...gun, price: 700 });
    expect(SHOP_STOCK.filter((e) => e.item === 'cw_test_rifle')).toHaveLength(1);
    expect(buyPrice('cw_test_rifle')).toBe(700);
  });

  it('unregisters cleanly', () => {
    unregisterCustomWeapon('cw_test_rifle');
    expect(WEAPON_BY_ITEM.cw_test_rifle).toBeUndefined();
    expect(weaponSpec(120)).toBeUndefined();
    expect(ITEMS.cw_test_rifle).toBeUndefined();
    expect(buyPrice('cw_test_rifle')).toBeNull();
    expect(ITEMS.ammo_556!.ammo!.guns).not.toContain('cw_test_rifle');
  });

  it('rejects incomplete or unsafe definitions', () => {
    expect(customWeaponSchema.safeParse({ ...gun, gun: undefined }).success).toBe(false);
    expect(customWeaponSchema.safeParse({ ...gun, model: { ...gun.model, muzzle: undefined } }).success).toBe(false);
    expect(customWeaponSchema.safeParse({ ...gun, id: 'ak47' }).success).toBe(false);
    expect(customWeaponSchema.safeParse({ ...gun, gun: { ...gun.gun!, ammo: 'medkit' } }).success).toBe(false);
    expect(customWeaponSchema.safeParse({ ...gun, weaponId: 20 }).success).toBe(false);
  });
});

describe('built-in weapons in the Studio', () => {
  const model = { length: .9, barrel: [0, 1, 0] as [number, number, number], up: [0, 0, 1] as [number, number, number], grip: [0, 0, 0] as [number, number, number], muzzle: [0, 30, 0] as [number, number, number], rail: [0, 10, 2] as [number, number, number] };
  it('every built-in gun / melee weapon becomes a valid editable definition', async () => {
    const { builtinWeaponIds, builtinWeaponDraft } = await import('./custom-weapons');
    expect(builtinWeaponIds()).toEqual(expect.arrayContaining(['ak47', 'awm', 'katana', 'gl18', 'rocket_launcher']));
    for (const id of builtinWeaponIds()) {
      const d = builtinWeaponDraft(id, model, 'bbmodel', 1)!;
      const r = customWeaponSchema.safeParse(d);
      expect(r.success, `${id}: ${r.success ? '' : r.error.issues.map((i) => i.message).join()}`).toBe(true);
    }
  });

  it('an override changes the stats but keeps what the Studio does not edit, and restores', async () => {
    const { builtinWeaponDraft } = await import('./custom-weapons');
    const before = structuredClone(weaponSpec(WEAPON_BY_ITEM.rocket_launcher!));
    const d = builtinWeaponDraft('rocket_launcher', model, 'bbmodel', 3)!;
    registerCustomWeapon({ ...d, gun: { ...d.gun!, reloadMs: 2000 }, price: 999 });
    expect(weaponSpec(WEAPON_BY_ITEM.rocket_launcher!)).toMatchObject({ reloadMs: 2000, fire: 'projectile', recoil: 3 });
    expect(buyPrice('rocket_launcher')).toBe(999);
    unregisterCustomWeapon('rocket_launcher');
    expect(weaponSpec(WEAPON_BY_ITEM.rocket_launcher!)).toEqual(before);
    expect(ITEMS.rocket_launcher).toBeTruthy();
    expect(buyPrice('rocket_launcher')).toBe(1800);
    expect(customWeaponSchema.safeParse({ ...d, weaponId: 120 }).success).toBe(false);
  });
});
