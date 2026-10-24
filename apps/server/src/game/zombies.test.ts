import { describe, expect, it } from 'vitest';
import { isCrawling, zombieScale, zombieVariant, Limb, ZombieVariant } from '@zion/shared';
import { ZOMBIE_RIG, CollisionWorld } from '@zion/physics';
import { castCombatRay } from './combat';
import type { SpawnService } from './spawn';
import { Zombie, ZombieDirector } from './zombies';
import type { Player } from './player';

const director = new ZombieDirector({} as CollisionWorld, {} as SpawnService, { attackPlayer: () => undefined });

describe('zombie damage', () => {
  it('a bucket over the head takes head hits until 50 damage breaks it; armour soaks body hits', () => {
    const z = new Zombie(1_000_031, 10, 0, 10, ZombieVariant.Rotting);
    z.bucket = 50;
    const attacker = { dead: false } as Player;
    expect(director.hit(z, 'head', 30, 0, 1, 0, 100, attacker)).toMatchObject({ killed: false, shield: 'bucket' });
    expect(z.health).toBe(70);
    expect(director.hit(z, 'head', 30, 0, 1, 0, 200, attacker)).toMatchObject({ killed: false, shield: 'bucketBroke' });
    expect(z.bucket).toBe(0);
    expect(director.hit(z, 'head', 10, 0, 1, 0, 300, attacker).killed).toBe(true);
    const armored = new Zombie(1_000_032, 10, 0, 10, ZombieVariant.Gaunt);
    armored.armor = { head: 32, face: 0, ears: 0, chest: 63 }; armored.armorDurability = 300; armored.helmetDurability = 160;
    director.hit(armored, 'torso', 40, 0, 1, 0, 100, attacker);
    expect(armored.health).toBeGreaterThan(70 - 40);
    expect(director.hit(armored, 'head', 20, 0, 1, 0, 200, attacker).killed).toBe(false);
  });
  it('keeps brute movement intact under hits and prevents decapitation without blocking damage', () => {
    const zombie = new Zombie(1_000_021, 10, 0, 10, ZombieVariant.Brute);
    const attacker = { dead: false } as Player;
    zombie.state.vx = 2;
    zombie.state.vz = -3;
    zombie.staggerUntil = 50;
    expect(director.hit(zombie, 'decapitation', 30, 1, 1, 20, 100, attacker).killed).toBe(false);
    expect(zombie.health).toBe(170);
    expect(zombie.limbs & Limb.Head).toBe(0);
    expect(zombie.state.vx).toBe(2);
    expect(zombie.state.vz).toBe(-3);
    expect(zombie.staggerUntil).toBe(50);
    expect(zombie.target).toBe(attacker);
    expect(director.hit(zombie, 'head', 250, 1, 0, 20, 200, attacker).killed).toBe(true);
    expect(zombie.limbs & Limb.Head).toBe(0);
    expect(zombie.state.vx).toBe(2);
  });
  it.each([0, 1, 3] as const)('decapitation kills variant %s at full health and preserves its snapshot variant', variant => {
    const zombie = new Zombie(1_000_020, 10, 0, 10, variant);
    const result = director.hit(zombie, 'decapitation', 1, 1, 0, 4, 100, null);
    expect(result.killed).toBe(true);
    expect(zombie.health).toBe(0);
    expect(zombie.dead).toBe(true);
    expect(zombie.limbs & Limb.Head).toBe(Limb.Head);
    expect(zombieVariant(zombie.limbs | (variant << 4))).toBe(variant);
    expect(director.hit(zombie, 'decapitation', 1, 1, 0, 4, 101, null).killed).toBe(false);
  });
  it('keeps shared zombies in the map when their target disconnects near another player', () => {
    const local = new ZombieDirector({} as CollisionWorld, {} as SpawnService, { attackPlayer: () => {} });
    const leaving = { active: true, dead: false, state: { x: 20, z: 20 } } as Player;
    const other = { active: true, dead: false, state: { x: 25, z: 20 } } as Player;
    const z = new Zombie(1_000_006, 22, 0, 20);
    z.target = z.biteTarget = leaving; z.biteAt = 100;
    local.zombies.set(z.id, z);
    expect(local.suspend(leaving, [leaving, other])).toEqual([]);
    expect(local.zombies.get(z.id)).toBe(z);
    expect(z.target).toBeNull(); expect(z.biteAt).toBe(0);
  });
  it('suspends only the disconnecting player\'s attackers and restores their original damage once', () => {
    let loaded = false;
    const local = new ZombieDirector({} as CollisionWorld, { validateAt: (x: number, z: number) => loaded ? { x, y: 1, z } : null } as unknown as SpawnService, { attackPlayer: () => { throw new Error('Suspension must not cause an attack'); } });
    const p = { suspendedZombies: [] } as unknown as Player, other = {} as Player;
    const a = new Zombie(100, 20, 1, 25), b = new Zombie(101, 22, 1, 25), c = new Zombie(102, 24, 1, 25);
    a.target = p; a.health = 37; a.limbs = 3;
    b.target = other; c.biteTarget = p;
    for (const z of [a, b, c]) local.zombies.set(z.id, z);
    p.suspendedZombies = local.suspend(p);
    expect(p.suspendedZombies).toHaveLength(2);
    expect([...local.zombies.values()]).toEqual([b]);
    expect(a.dead).toBe(false);
    expect(local.suspend(p)).toHaveLength(0);
    local.restore(p);
    expect(p.suspendedZombies).toHaveLength(2);
    loaded = true;
    local.restore(p);
    expect(p.suspendedZombies).toHaveLength(0);
    const restored = [...local.zombies.values()].find((z) => z.health === 37)!;
    expect(restored.limbs).toBe(3); expect(restored.target).toBe(p);
    expect(restored.id).not.toBe(a.id);
    local.restore(p);
    expect(local.zombies.size).toBe(3);
  });
  it('scales the brute model and all authoritative hit zones by 1.5', () => {
    const brute = new Zombie(1_000_003, 0, 0, 0, ZombieVariant.Brute);
    expect(zombieScale(brute.variant)).toBe(1.5);
    expect(zombieScale(ZombieVariant.Rotting)).toBe(1);
    for (const [i, part] of brute.rig.entries()) {
      expect(part.r).toBeCloseTo(ZOMBIE_RIG[i]!.r * 1.5);
      expect(part.a[1]).toBeCloseTo(ZOMBIE_RIG[i]!.a[1] * 1.5);
    }
    expect(brute.maxHealth).toBe(200);
  });
  it('accepts headshots at the scaled head height through combat broad phase', () => {
    const world = new CollisionWorld({ worldSize: 100, seaLevel: -10 });
    const brute = new Zombie(1_000_004, 20, 0, 20, ZombieVariant.Brute);
    const attacker = new Zombie(1_000_005, 20, 0, 5);
    brute.history.push(0, 20, 0, 20, 0);
    const hit = castCombatRay(attacker, [brute], world, 0, undefined, 20, 2.6, 5, 0, 0, 1, 30);
    expect(hit.target).toBe(brute);
    expect(hit.zone).toBe('head');
  });
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
