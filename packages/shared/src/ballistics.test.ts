import { describe, expect, it } from 'vitest';
import { advanceBallistic, bulletSpec, gunSpread } from './ballistics';
import { Buttons, inputMessageSchema } from './protocol/client';
import { WeaponId, weaponSpec } from './weapons';

describe('ballistic ammunition', () => {
  it('falls under gravity, loses velocity to drag, and agrees at 30/60/144 Hz', () => {
    const run = (fps: number) => {
      const s = { x: 0, y: 10, z: 0, vx: 620, vy: 0, vz: 0 };
      for (let i = 0; i < fps; i++) advanceBallistic(s, 9.81, .12, 1 / fps);
      return s;
    };
    const a = run(30);
    expect(a.vx).toBeLessThan(620);
    expect(a.y).toBeLessThan(10);
    expect(a.x).toBeLessThan(620);
    for (const fps of [60, 144]) for (const key of ['x', 'y', 'vx', 'vy'] as const) expect(run(fps)[key]).toBeCloseTo(a[key], 9);
    const vacuum = { x: 0, y: 10, z: 0, vx: 100, vy: 0, vz: 0 };
    advanceBallistic(vacuum, 10, 0, 1);
    expect(vacuum.x).toBe(100); expect(vacuum.y).toBe(5); expect(vacuum.vy).toBe(-10);
  });

  it('reduces spread with settled ADS but retains shotgun scatter and burst bloom', () => {
    for (const weapon of [WeaponId.AK47, WeaponId.Shotgun, WeaponId.GL18]) {
      const gun = weaponSpec(weapon);
      if (gun?.kind !== 'gun') throw new Error('expected gun');
      const aimed = gunSpread(gun, 1, 0, false);
      expect(aimed).toBeGreaterThan(0);
      expect(aimed).toBeLessThan(gunSpread(gun, 0, 0, false));
      expect(gunSpread(gun, 1, 4, false)).toBeGreaterThan(aimed);
      expect(gunSpread(gun, 1, 0, false, 1)).toBeGreaterThan(aimed);
      expect(gunSpread(gun, 1, 0, true)).toBeLessThan(aimed);
      expect(bulletSpec(weapon, gun).kind).toBe('bullet');
    }
  });

  it('accepts aim independently from the trigger and rejects unknown button bits', () => {
    const input = { t: 'in', s: 1, mx: 0, mz: 0, yaw: 0, pitch: 0, b: Buttons.Aim };
    expect(inputMessageSchema.safeParse(input).success).toBe(true);
    expect(inputMessageSchema.safeParse({ ...input, b: Buttons.Aim | Buttons.Attack }).success).toBe(true);
    expect(inputMessageSchema.safeParse({ ...input, b: 1 << 20 }).success).toBe(false);
  });
});
