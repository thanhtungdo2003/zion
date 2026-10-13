import { describe, expect, it } from 'vitest';
import { WeaponId } from '@zion/shared';
import { GunRecoil, RecoilSpring, weaponRecoil } from './first-person-recoil';

describe('first-person recoil', () => {
  it('smoothly adds unpredictable recoil on both axes without losing mouse compensation', () => {
    const a = new GunRecoil(), b = new GunRecoil();
    a.kick(.03, () => .9); b.kick(.03, () => .1);
    expect(a.apply(0, 0, 0)).toEqual({ yaw: 0, pitch: 0 });
    const right = a.apply(0, 0, .03), left = b.apply(0, 0, .03);
    expect(right.yaw).toBeGreaterThan(0); expect(left.yaw).toBeLessThan(0);
    expect(right.pitch).toBeGreaterThan(0); expect(left.pitch).toBeGreaterThan(0);
    let aim = { yaw: right.yaw - .1, pitch: right.pitch - .1 };
    for (let i = 0; i < 240; i++) aim = a.apply(aim.yaw, aim.pitch, 1 / 60);
    expect(aim.yaw).toBeCloseTo(-.1, 7); expect(aim.pitch).toBeCloseTo(-.1, 7);
    a.reset(); expect(a.apply(0, 0, .1)).toEqual({ yaw: 0, pitch: 0 });
  });
  it('lifts smoothly after the shot and settles without bouncing below the original aim', () => {
    const recoil = new RecoilSpring();
    const kick = weaponRecoil(WeaponId.AK47);
    recoil.kick(kick);
    expect(recoil.offset).toBe(0);
    recoil.update(.01);
    expect(recoil.offset).toBeGreaterThan(0);
    expect(recoil.offset).toBeLessThan(kick);
    recoil.update(1 / 18 - .01);
    expect(recoil.offset).toBeCloseTo(kick, 10);
    let last = recoil.offset;
    for (let i = 0; i < 120; i++) {
      recoil.update(1 / 60);
      expect(recoil.offset).toBeGreaterThanOrEqual(0);
      expect(recoil.offset).toBeLessThanOrEqual(last);
      last = recoil.offset;
    }
    expect(recoil.offset).toBeLessThan(1e-9);
  });

  it('has the same recovery at 30, 60 and 144 FPS', () => {
    const offsets = [30, 60, 144].map((fps) => {
      const recoil = new RecoilSpring();
      recoil.kick(weaponRecoil(WeaponId.AWM));
      for (let frame = 0; frame < fps / 2; frame++) recoil.update(1 / fps);
      return recoil.offset;
    });
    offsets.forEach((offset) => expect(offset).toBeCloseTo(offsets[0]!, 12));
  });

  it('accumulates during sustained fire, stays bounded and fully recovers afterwards', () => {
    const recoil = new RecoilSpring();
    const kick = weaponRecoil(WeaponId.AK47);
    let peak = 0;
    for (let frame = 0; frame < 60 * 45; frame++) {
      if (frame % 6 === 0) recoil.kick(kick);
      recoil.update(1 / 60);
      peak = Math.max(peak, recoil.offset);
      expect(recoil.offset).toBeLessThanOrEqual(Math.PI / 30);
    }
    expect(peak).toBeGreaterThan(kick);
    recoil.update(2);
    expect(recoil.offset).toBeLessThan(1e-9);
  });

  it('preserves mouse compensation while the actual aiming pitch rises and returns', () => {
    const recoil = new RecoilSpring();
    let pitch = .2;
    recoil.kick(weaponRecoil(WeaponId.AK47));
    pitch = recoil.apply(pitch, 1 / 60);
    expect(pitch).toBeGreaterThan(.2);
    pitch -= .1; // Player pulls the mouse down during recovery.
    for (let frame = 0; frame < 120; frame++) pitch = recoil.apply(pitch, 1 / 60);
    expect(pitch).toBeCloseTo(.1, 8);
  });

  it('does not pull the aim down after a kick blocked by the upper look limit', () => {
    const recoil = new RecoilSpring();
    recoil.kick(weaponRecoil(WeaponId.Shotgun));
    let pitch = 1.4;
    for (let frame = 0; frame < 120; frame++) pitch = recoil.apply(pitch, 1 / 60);
    expect(pitch).toBeCloseTo(1.4, 10);
  });

  it('clears residual movement on reset and keeps scoped and lighter weapons controllable', () => {
    const recoil = new RecoilSpring();
    recoil.kick(weaponRecoil(WeaponId.AK47)); recoil.update(.03);
    recoil.reset();
    expect(recoil.apply(.2, 1 / 60)).toBe(.2);
    expect(weaponRecoil(WeaponId.Shotgun)).toBeGreaterThan(weaponRecoil(WeaponId.MP5));
    expect(weaponRecoil(WeaponId.AWM, 8)).toBeLessThan(weaponRecoil(WeaponId.AWM));
    expect(weaponRecoil(WeaponId.Crossbow)).toBeLessThan(weaponRecoil(WeaponId.AUG));
    expect(weaponRecoil(WeaponId.Katana)).toBe(0);
  });

  it('settles when the player pulls down to the lower look limit during recovery', () => {
    const recoil = new RecoilSpring();
    recoil.kick(weaponRecoil(WeaponId.Shotgun));
    recoil.update(1 / 18);
    let pitch = -1.4;
    for (let frame = 0; frame < 120; frame++) {
      pitch = recoil.apply(pitch, 1 / 60);
      expect(pitch).toBe(-1.4);
    }
    expect(recoil.offset).toBeLessThan(1e-9);
    // Looking up afterwards must not release a delayed downward recovery.
    expect(recoil.apply(0, 1 / 60)).toBeCloseTo(0, 9);
  });
});
