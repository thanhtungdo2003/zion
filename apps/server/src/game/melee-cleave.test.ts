import { describe, expect, it, vi } from 'vitest';
import { CollisionWorld, Heightfield, Layer, makeBox } from '@zion/physics';
import { WEAPON_SPECS, WeaponId, type MeleeSpec } from '@zion/shared';
import { GameServer } from './game-server';
import { Player } from './player';
import { Zombie } from './zombies';
import type { ClientSession } from './session';

describe('melee cleave', () => {
  it.each([WeaponId.Katana, WeaponId.Quam, WeaponId.Shovel])('weapon %s hits the main target fully and nearby zombies at half damage', weapon => {
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
    const targets = [main, secondary, behind, blocked, far];
    for (const z of targets) z.history.push(100, z.state.x, 0, z.state.z, 0);
    collision.setOwnerColliders(123, [{ shape: makeBox(15.2, 1, 15.2, .3, 2, .3), layer: Layer.Static }]);
    const hitTarget = vi.fn();
    const server = Object.assign(Object.create(GameServer.prototype), {
      collision, zombies: { near: () => targets }, grid: { query: () => [] },
      animals: new Map(), scratch: [], peacefulNpcs: () => [], hitTarget,
    }) as { resolveStrike(p: Player, now: number, renderTime: number | undefined, blade: MeleeSpec): void };
    const blade = WEAPON_SPECS[weapon] as MeleeSpec;
    server.resolveStrike(p, 100, undefined, blade);
    expect(hitTarget).toHaveBeenCalledTimes(2);
    expect(hitTarget.mock.calls[0]![1]).toBe(main);
    expect(hitTarget.mock.calls[0]![2]).toBe(blade.damage);
    expect(hitTarget.mock.calls[1]![1]).toBe(secondary);
    expect(hitTarget.mock.calls[1]![2]).toBe(Math.round(blade.damage * .5));
  });
});
