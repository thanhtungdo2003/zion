import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { GRENADE_GRAVITY, lobSpeed } from '@zion/shared';
import { ThrowArc } from './throw-arc';

describe('throw arc', () => {
  it('comes down on the aimed point (same launch as the server)', () => {
    for (const dist of [5, 15, 30]) {
      const oy = 1.6, elevation = 0.6;
      const speed = lobSpeed(elevation, 40, dist - 0.4, 0 - oy);
      const land = ThrowArc.landing({ origin: new Vector3(0.4, oy, 0), dirX: 1, dirZ: 0, speed, elevation, gravity: GRENADE_GRAVITY, groundY: 0 }, new Vector3());
      expect(land.x).toBeCloseTo(dist, 1);
      expect(land.y).toBeCloseTo(0, 3);
    }
  });
});
