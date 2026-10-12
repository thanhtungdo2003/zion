import { describe, expect, it, vi } from 'vitest';
import { CharacterController, CollisionWorld, Heightfield } from '@zion/physics';
import { armorSpeedFactor, armorStaminaFactor, Buttons, DEFAULT_BASE_LIFE, TICK_DT, weaponSpeedFactor, weaponStaminaFactor, WeaponId, WEAPON_SPECS, type GunSpec, type InputMessage } from '@zion/shared';
import { LocalPlayer } from '../../../web/src/game/prediction';
import { GameServer } from './game-server';
import { BaseLife } from './base-life';
import { Player } from './player';
import type { ClientSession } from './session';
import { Zombie } from './zombies';

function fixture() {
  const world = new CollisionWorld({ worldSize: 64, seaLevel: -50 });
  for (let x = 0; x < 2; x++) for (let z = 0; z < 2; z++) world.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089), new Float32Array(1089).fill(NaN)), []);
  const life = new BaseLife(DEFAULT_BASE_LIFE);
  const player = new Player(1, 'a', 'Alpha', {} as ClientSession, 16, 0, 16);
  player.life = life.initial(); player.state.grounded = true;
  const server = Object.assign(Object.create(GameServer.prototype), {
    life, controller: new CharacterController(world), stepInfo: {}, flag: vi.fn(),
  }) as { syncLoadout(p: Player): void; applyInput(p: Player, input: InputMessage, now: number): void; tryAttack(p: Player, now: number, rt?: number): void };
  const local = new LocalPlayer(world, 16, 0, 16); local.state.grounded = true;
  return { server, player, local, world };
}

describe('held weapon burden', () => {
  it('slows client and server equally, increases sprint effort and stops counting a weapon after putting it away', () => {
    const { server, player, local } = fixture();
    const pkm = player.inv.add('pkm')!;
    player.inv.equip(null);
    server.syncLoadout(player);
    expect(player.speedMul).toBe(1);
    player.inv.equip(pkm.uid); server.syncLoadout(player);
    local.speedMul = player.speedMul;
    const before = player.life.stamina;
    const msg = local.step(0, 1, 0, 0, Buttons.Sprint, undefined);
    server.applyInput(player, msg, 100);
    expect(player.speedMul).toBeCloseTo(.73);
    expect(player.state.z).toBeCloseTo(local.state.z, 8);
    expect(player.life.stamina).toBeCloseTo(before - DEFAULT_BASE_LIFE.stamina.sprintPerSecond * TICK_DT * weaponStaminaFactor(WeaponId.PKM), 8);
    player.inv.equip(null); server.syncLoadout(player);
    expect(player.speedMul).toBe(1);
    expect(player.inv.items.some(i => i.itemId === 'pkm')).toBe(true);
  });
  it('combines held weapon and worn armor burdens and spends the same extra effort on dodges', () => {
    const { server, player, local } = fixture();
    const gun = player.inv.add('barrett')!; player.inv.equip(gun.uid);
    const jacket = player.inv.add('worn_work_jacket')!;
    expect(player.inv.move(jacket.uid, 'armor_chest', 0, 0, false)).toBe(true);
    server.syncLoadout(player); local.speedMul = player.speedMul;
    expect(player.armor.chest).toBeGreaterThan(0);
    expect(player.speedMul).toBeCloseTo(armorSpeedFactor(player.armor) * weaponSpeedFactor(WeaponId.Barrett));
    const before = player.life.stamina;
    server.applyInput(player, local.step(0, 1, 0, 0, Buttons.Roll, undefined), 100);
    expect(player.life.stamina).toBeCloseTo(before - DEFAULT_BASE_LIFE.stamina.roll * armorStaminaFactor(player.armor) * weaponStaminaFactor(WeaponId.Barrett), 8);
  });
  it('balances the Barrett above AWM in power and weight, with 10x optics and stronger impulses', () => {
    const barrett = WEAPON_SPECS[WeaponId.Barrett] as GunSpec, awm = WEAPON_SPECS[WeaponId.AWM] as GunSpec;
    expect(barrett.damage).toBeGreaterThan(awm.damage);
    expect(barrett.weight).toBeGreaterThan(awm.weight);
    expect(barrett.damage * (barrett.knockback ?? 1)).toBeGreaterThan(awm.damage * (awm.knockback ?? 1));
    expect(barrett.scope).toBe(10);
    expect(barrett.magazine).toBe(10);
  });
  it('charges held weight on attacks and refuses the attack when stamina cannot cover it', () => {
    const { server, player } = fixture();
    const axe = player.inv.add('fire_axe')!; player.inv.equip(axe.uid);
    const cost = DEFAULT_BASE_LIFE.stamina.attack * weaponStaminaFactor(WeaponId.FireAxe);
    player.life.stamina = cost - .001;
    server.tryAttack(player, 100);
    expect(player.strike).toBeNull();
    player.life.stamina = cost + 5;
    server.tryAttack(player, 100);
    expect(player.strike).not.toBeNull();
    expect(player.life.stamina).toBeCloseTo(5);
  });
  it('uses Barrett ammunition and stronger knockback when resolving a real authoritative ray', () => {
    const { server, player, world } = fixture();
    const target = new Zombie(1_000_022, 16, 0, 10);
    target.history.push(1000, 16, 0, 10, 0);
    const hitTarget = vi.fn();
    Object.assign(server, { collision: world, grid: { query: () => [] }, zombies: { near: () => [target], alert: vi.fn() }, animals: new Map(), scratch: [], npcOnRay: () => null, broadcastNear: vi.fn(), hitTarget });
    const fire = server as unknown as { tryShoot(p: Player, now: number, rt?: number): void };
    for (const [id, weapon] of [['awm', WeaponId.AWM], ['barrett', WeaponId.Barrett]] as const) {
      const gun = player.inv.add(id)!; player.inv.equip(gun.uid); player.weapon = weapon; player.fireReadyAt = 0;
      const rounds = gun.mag!;
      fire.tryShoot(player, 1000);
      expect(gun.mag).toBe(rounds - 1);
      player.inv.remove(gun.uid);
    }
    expect(hitTarget).toHaveBeenCalledTimes(2);
    expect(hitTarget.mock.calls[1]![1]).toBe(target);
    expect(hitTarget.mock.calls[1]![2]).toBeGreaterThan(hitTarget.mock.calls[0]![2]);
    expect(hitTarget.mock.calls[1]![9]).toBeGreaterThan(hitTarget.mock.calls[0]![9]);
    expect(hitTarget.mock.calls[1]![11]).toBe(1.8);
  });
});
