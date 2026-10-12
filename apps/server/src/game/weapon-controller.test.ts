import { describe, expect, it, vi } from 'vitest';
import { WeaponId, WEAPON_SPECS, InventoryModel, CONTAINERS, accepts, ITEMS, gunBlocksSprint } from '@zion/shared';
import { WeaponController } from '../../../web/src/game/weapon-controller';

describe('reload magazine reconciliation', () => {
  it('fires 100 PKM rounds, reloads from its belt box and leaves other ammunition intact', () => {
    const inventory = new InventoryModel();
    const gun = inventory.add('pkm')!;
    inventory.add('ammo_pkm');
    inventory.add('ammo_762x54');
    expect(gun.container).toBe('heavy');
    expect(accepts(CONTAINERS.primary, ITEMS.pkm!)).toBe(false);
    const c = new WeaponController({ available: () => inventory.ammoFor('pkm'), take: (_weapon, n) => inventory.takeAmmo('pkm', n) });
    c.syncMag(WeaponId.PKM, 100);
    for (let i = 0; i < 100; i++) expect(c.tick(1000 + i * 100, WeaponId.PKM, true, true)).toBe('shot');
    expect(c.tick(11000, WeaponId.PKM, true, true)).toBe('none');
    c.reload(11000, WeaponId.PKM);
    expect(c.tick(14999, WeaponId.PKM, true, true)).toBe('none');
    c.tick(15000, WeaponId.PKM, false, true);
    expect(c.view(15000, WeaponId.PKM)?.mag).toBe(100);
    expect(inventory.ammoFor('pkm')).toBe(0);
    expect(inventory.ammoFor('svd')).toBe(20);
    expect(c.tick(15001, WeaponId.PKM, true, true)).toBe('shot');
  });
  it('throws C4 on a secondary press and detonates on a primary press without repeating held clicks', () => {
    const c = new WeaponController({ available: () => 0, take: () => 0 });
    expect(c.tick(100, WeaponId.C4, false, true, false, true)).toBe('throw');
    expect(c.tick(2000, WeaponId.C4, false, true, false, true)).toBe('none');
    expect(c.tick(2001, WeaponId.C4, true, true, false, false)).toBe('detonate');
    expect(c.tick(2002, WeaponId.C4, true, true, false, false)).toBe('none');
    c.tick(2100, WeaponId.C4, false, false, false, false);
    expect(c.tick(2200, WeaponId.C4, false, false, false, true)).toBe('none');
  });
  it('repeats semi-automatic shots for the mobile fire stick at the normal fire rate', () => {
    const controller = new WeaponController({ available: () => 0, take: () => 0 });
    const spec = WEAPON_SPECS[WeaponId.GL18];
    if (spec.kind !== 'gun') throw new Error('Expected gun');
    expect(controller.tick(1000, WeaponId.GL18, true, true, true)).toBe('shot');
    expect(controller.tick(1001, WeaponId.GL18, true, true, true)).toBe('none');
    expect(controller.tick(1000 + spec.fireMs, WeaponId.GL18, true, true, true)).toBe('shot');
    expect(controller.tick(1000 + spec.fireMs * 2, WeaponId.GL18, false, true, true)).toBe('none');
  });
  it('blocks sprint from the trigger press through the firing interval, then permits running again', () => {
    const controller = new WeaponController({ available: () => 0, take: () => 0 });
    controller.syncMag(WeaponId.GL18, 17);
    expect(controller.blocksSprint(1000, WeaponId.GL18, true)).toBe(true);
    expect(controller.tick(1000, WeaponId.GL18, true, true)).toBe('shot');
    const spec = WEAPON_SPECS[WeaponId.GL18];
    const readyAt = 1000 + (spec.kind === 'gun' ? spec.fireMs : 0);
    expect(controller.blocksSprint(readyAt - 1, WeaponId.GL18, false)).toBe(true);
    expect(gunBlocksSprint(WeaponId.GL18, false, readyAt - 1, readyAt)).toBe(true);
    expect(controller.blocksSprint(readyAt, WeaponId.GL18, false)).toBe(false);
    expect(controller.blocksSprint(readyAt, WeaponId.GL18, true)).toBe(true);
    expect(controller.blocksSprint(1001, WeaponId.Katana, true)).toBe(false);
  });
  it('keeps the loaded magazine when the server consumes the last ammo box before the sound ends', () => {
    let reserve = 17;
    const take = vi.fn(() => 0);
    const controller = new WeaponController({ available: () => reserve, take });
    controller.syncMag(WeaponId.GL18, 0);
    controller.reload(0, WeaponId.GL18);
    reserve = 0;
    controller.syncMag(WeaponId.GL18, 17);
    controller.tick(2000, WeaponId.GL18, false, true);
    expect(controller.view(2000, WeaponId.GL18)).toEqual({ mag: 17, max: 17, reserve: 0, reload: null });
    expect(take).not.toHaveBeenCalled();
    expect(controller.tick(2001, WeaponId.GL18, true, true)).toBe('shot');
    expect(controller.view(2001, WeaponId.GL18)?.mag).toBe(16);
  });

  it('does not consume another box when the server has already completed a partial reload', () => {
    const take = vi.fn(() => 17);
    const controller = new WeaponController({ available: () => 30, take });
    controller.syncMag(WeaponId.GL18, 3);
    controller.reload(0, WeaponId.GL18);
    controller.syncMag(WeaponId.GL18, 17);
    controller.tick(2000, WeaponId.GL18, false, true);
    expect(controller.view(2000, WeaponId.GL18)?.mag).toBe(17);
    expect(take).not.toHaveBeenCalled();
  });
});
