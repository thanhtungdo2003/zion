import { describe, expect, it } from 'vitest';
import { WEAPON_BY_ITEM, builtinWeaponDraft, builtinWeaponIds, customWeaponSchema } from '@zion/shared';
import { builtinWeaponVisual } from './render/weapons';
import { builtinRecoilDegrees } from './first-person-recoil';

describe('weapon manager: built-in arsenal', () => {
  it.each(builtinWeaponIds())('%s opens in the manager with its real model points', (id) => {
    const v = builtinWeaponVisual(id)!;
    expect(v).toBeTruthy();
    const d = builtinWeaponDraft(id, { length: v.length, barrel: v.barrel, up: v.up, grip: v.grip, ...(v.muzzle ? { muzzle: v.muzzle } : {}), ...(v.sight ? { sight: v.sight } : {}), ...(v.rail ? { rail: v.rail } : {}) }, v.url.endsWith('.glb') ? 'glb' : 'bbmodel', builtinRecoilDegrees(WEAPON_BY_ITEM[id] ?? 0))!;
    const r = customWeaponSchema.safeParse(d);
    expect(r.success, r.success ? '' : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')).toBe(true);
  });
});
