import { describe, expect, it, vi } from 'vitest';
import { WeaponId, WEAPON_SPECS, gunBlocksSprint } from '@zion/shared';
import { WeaponController } from '../../../web/src/game/weapon-controller';

describe('reload magazine reconciliation', () => {
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
