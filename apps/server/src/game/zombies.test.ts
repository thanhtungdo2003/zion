import { describe, expect, it } from 'vitest';
import { isCrawling } from '@zion/shared';
import { ZOMBIE_RIG, type CollisionWorld } from '@zion/physics';
import type { SpawnService } from './spawn';
import { Zombie, ZombieDirector } from './zombies';

const director = new ZombieDirector({} as CollisionWorld, {} as SpawnService, { attackPlayer: () => undefined });

describe('zombie damage', () => {
  it('dies instantly from a headshot', () => {
    const z = new Zombie(1_000_000, 0, 0, 0);
    expect(director.hit(z, 'head', 5, 0, -1, 1, 0, null).killed).toBe(true);
    expect(z.dead).toBe(true);
  });

  it('takes limb hits without being crippled', () => {
    const z = new Zombie(1_000_001, 0, 0, 0);
    director.hit(z, 'arm_l', 14, 0, -1, 1, 0, null);
    director.hit(z, 'leg_r', 14, 0, -1, 1, 0, null);
    expect(z.limbs).toBe(0);
    expect(isCrawling(z.limbs)).toBe(false);
    expect(z.rig).toBe(ZOMBIE_RIG);
    expect(z.health).toBeLessThan(100);
    expect(z.dead).toBe(false);
  });

  it('is knocked back along the shot', () => {
    const z = new Zombie(1_000_002, 0, 0, 0);
    director.hit(z, 'torso', 10, 1, 0, 2, 0, null);
    expect(z.state.vx).toBeGreaterThan(1.9);
    expect(z.staggerUntil).toBeGreaterThan(0);
  });
});
