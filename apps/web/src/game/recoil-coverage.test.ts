import { describe, expect, it } from 'vitest';
import { WEAPON_SPECS } from '@zion/shared';
import { weaponRecoil } from './first-person-recoil';

describe('recoil coverage', () => {
  it.each(Object.entries(WEAPON_SPECS).filter(([, s]) => s.kind === 'gun' && !s.burn).map(([id]) => Number(id)))('weapon %s kicks when fired', (id) => {
    expect(weaponRecoil(id)).toBeGreaterThan(0);
  });
});
