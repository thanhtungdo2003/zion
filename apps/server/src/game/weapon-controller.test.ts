import { describe, expect, it, vi } from 'vitest';
import { WeaponId } from '@zion/shared';
import { WeaponController } from '../../../web/src/game/weapon-controller';

describe('reload magazine reconciliation', () => {
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
