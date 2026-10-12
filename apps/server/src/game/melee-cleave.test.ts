import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollisionWorld, Heightfield, Layer, makeBox } from '@zion/physics';
import { WEAPON_SPECS, WeaponId, rollsDecapitation, type MeleeSpec } from '@zion/shared';
import { GameServer } from './game-server';
import { Player } from './player';
import { Zombie, ZombieDirector } from './zombies';
import type { SpawnService } from './spawn';
import type { ClientSession } from './session';
afterEach(() => vi.restoreAllMocks());

describe('melee cleave', () => {
  it('does not roll an instant kill against another player even with a sharp axe', () => {
    const collision = new CollisionWorld({ worldSize: 64, seaLevel: -20 });
    const attacker = new Player(1, 'a', 'A', {} as ClientSession, 16, 0, 16);
    const target = new Player(2, 'b', 'B', {} as ClientSession, 16, 0, 15);
    target.active = true; target.history.push(100, 16, 0, 15, 0);
    const hitTarget = vi.fn(), random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const server = Object.assign(Object.create(GameServer.prototype), {
      deps: {}, collision, zombies: { near: () => [] }, grid: { query: () => [target] }, animals: new Map(), scratch: [], peacefulNpcs: () => [], hitTarget,
    }) as { resolveStrike(p: Player, now: number, rt: undefined, blade: MeleeSpec): void };
    server.resolveStrike(attacker, 100, undefined, WEAPON_SPECS[WeaponId.FireAxe] as MeleeSpec);
    expect(hitTarget).toHaveBeenCalledOnce();
    expect(hitTarget.mock.calls[0]![2]).toBe(65);
    expect(hitTarget.mock.calls[0]![3]).toBe('slash');
    expect(random).not.toHaveBeenCalled();
  });
  it('rolls decapitation only for sharp weapons and respects each probability boundary', () => {
    for (const id of [WeaponId.Katana, WeaponId.Quam, WeaponId.FireAxe]) {
      const spec = WEAPON_SPECS[id] as MeleeSpec;
      expect(rollsDecapitation(spec, () => 0)).toBe(true);
      expect(rollsDecapitation(spec, () => spec.decapitationChance!)).toBe(false);
    }
    const random = vi.fn(() => 0);
    expect(rollsDecapitation(WEAPON_SPECS[WeaponId.Sledgehammer] as MeleeSpec, random)).toBe(false);
    expect(rollsDecapitation(WEAPON_SPECS[WeaponId.Shovel] as MeleeSpec, random)).toBe(false);
    expect(rollsDecapitation(undefined, random)).toBe(false);
    expect(random).not.toHaveBeenCalled();
  });
  it.each([WeaponId.Katana, WeaponId.Quam, WeaponId.Shovel, WeaponId.Sledgehammer, WeaponId.FireAxe].flatMap(weapon => [{ weapon, roll: .99 }, { weapon, roll: 0 }]))('weapon $weapon rolls $roll only for confirmed primary/cleave hits within reach and without walls', ({ weapon, roll }) => {
    vi.spyOn(Math, 'random').mockReturnValue(roll);
    const collision = new CollisionWorld({ worldSize: 64, seaLevel: -20 });
    for (let x = 0; x < 2; x++) for (let z = 0; z < 2; z++) {
      collision.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089), new Float32Array(1089).fill(NaN)), []);
    }
    const p = new Player(1, 'a', 'A', {} as ClientSession, 16, 0, 16);
    const main = new Zombie(1_000_001, 16, 0, 15);
    const secondary = new Zombie(1_000_002, 17.2, 0, 14.5);
    const behind = new Zombie(1_000_003, 16, 0, 18);
    const blocked = new Zombie(1_000_004, 14.5, 0, 14.5);
    const far = new Zombie(1_000_005, 16, 0, 10);
    const wide = new Zombie(1_000_006, 18.8, 0, 15.35);
    const targets = [main, secondary, behind, blocked, far, wide];
    for (const z of targets) z.history.push(100, z.state.x, 0, z.state.z, 0);
    collision.setOwnerColliders(123, [{ shape: makeBox(15.2, 1, 15.2, .3, 2, .3), layer: Layer.Static }]);
    const hitTarget = vi.fn();
    const stun = vi.fn();
    const server = Object.assign(Object.create(GameServer.prototype), {
      collision, zombies: { near: () => targets, stun }, grid: { query: () => [] },
      animals: new Map(), scratch: [], peacefulNpcs: () => [], hitTarget,
    }) as { resolveStrike(p: Player, now: number, renderTime: number | undefined, blade: MeleeSpec): void };
    const blade = WEAPON_SPECS[weapon] as MeleeSpec;
    const sever = !!blade.decapitationChance && roll < blade.decapitationChance;
    server.resolveStrike(p, 100, undefined, blade);
    expect(hitTarget).toHaveBeenCalledTimes(weapon === WeaponId.Sledgehammer ? 3 : 2);
    expect(hitTarget.mock.calls[0]![1]).toBe(main);
    expect(hitTarget.mock.calls[0]![2]).toBe(sever ? main.health : blade.damage);
    expect(hitTarget.mock.calls[0]![3]).toBe(sever ? 'decapitation' : 'slash');
    expect(hitTarget.mock.calls[1]![1]).toBe(secondary);
    expect(hitTarget.mock.calls[1]![2]).toBe(sever ? secondary.health : Math.round(blade.damage * (blade.cleaveMultiplier ?? .5)));
    if (weapon === WeaponId.Sledgehammer) {
      expect(hitTarget.mock.calls[2]![1]).toBe(wide);
      expect(hitTarget.mock.calls[2]![2]).toBe(68);
      expect(stun.mock.calls).toEqual([[main, 1300, 100], [secondary, 1300, 100], [wide, 1300, 100]]);
    } else expect(stun).not.toHaveBeenCalled();
  });

  it('uses a longer wind-up and cooldown for the sledgehammer', () => {
    const server = Object.assign(Object.create(GameServer.prototype), {
      life: { spend: () => true, config: { stamina: { attack: 1 } } },
    }) as { tryAttack(p: Player, now: number, rt: number | undefined, blade: MeleeSpec): void };
    const p = new Player(1, 'a', 'A', {} as ClientSession, 16, 0, 16);
    const blade = WEAPON_SPECS[WeaponId.Sledgehammer] as MeleeSpec;
    server.tryAttack(p, 100, undefined, blade);
    expect(p.strike?.at).toBe(550);
    expect(p.attackReadyAt).toBe(1900);
    server.tryAttack(p, 1100, undefined, blade);
    expect(p.strike?.at).toBe(550);
    server.tryAttack(p, 1900, undefined, blade);
    expect(p.strike?.at).toBe(2350);
  });

  it('interrupts a pending bite and leap wind-up without shortening a longer stun', () => {
    const director = new ZombieDirector({} as CollisionWorld, {} as SpawnService, { attackPlayer: vi.fn() });
    const zombie = new Zombie(1_000_001, 16, 0, 15);
    zombie.biteAt = 200;
    zombie.biteTarget = {} as Player;
    zombie.attackingUntil = 500;
    zombie.jumpWindupUntil = 400;
    director.stun(zombie, 1300, 100);
    expect(zombie.staggerUntil).toBe(1400);
    expect(zombie.biteAt).toBe(0);
    expect(zombie.biteTarget).toBeNull();
    expect(zombie.attackingUntil).toBe(0);
    expect(zombie.jumpWindupUntil).toBe(0);
    expect(zombie.attackReadyAt).toBe(1400);
    expect(zombie.jumpReadyAt).toBe(1400);
    director.stun(zombie, 100, 200);
    expect(zombie.staggerUntil).toBe(1400);
  });
});
