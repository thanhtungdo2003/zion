import { describe, expect, it, vi } from 'vitest';
import { CharacterController, CollisionWorld, Heightfield } from '@zion/physics';
import { Buttons, DEFAULT_BASE_LIFE, TICK_DT, WEAPON_BY_ITEM, weaponStaminaFactor, type InputMessage, type InvMessage } from '@zion/shared';
import { LocalPlayer } from '../../../web/src/game/prediction';
import { BaseLife } from './base-life';
import { GameServer } from './game-server';
import { Player } from './player';
import type { ClientSession } from './session';

function setup() {
  const world = new CollisionWorld({ worldSize: 32, seaLevel: -50 });
  world.addChunk(0, 0, new Heightfield(0, 0, 1, 33, new Float32Array(33 * 33), new Float32Array(33 * 33).fill(NaN)), []);
  const life = new BaseLife(DEFAULT_BASE_LIFE);
  const player = new Player(1, 'account', 'Survivor', { sendJson: vi.fn() } as unknown as ClientSession, 16, 0, 16);
  player.life = life.initial(); player.state.grounded = true;
  const gun = player.inv.add('gl18')!;
  player.inv.equip(gun.uid); gun.mag = 0;
  player.inv.add('ammo_9mm');
  const local = new LocalPlayer(world, 16, 0, 16); local.state.grounded = true;
  const server = Object.create(GameServer.prototype) as {
    onReload(p: Player): void;
    stepReloads(now: number): void;
    syncLoadout(p: Player): void;
    onInventory(p: Player, msg: InvMessage): void;
    applyInput(p: Player, msg: InputMessage, now: number): void;
  };
  Object.assign(server, {
    epoch: 0, life, controller: new CharacterController(world), activeScratch: [player],
    stepInfo: { frozen: false, hitWall: false, jumped: false, steppedUp: false, reverted: false },
    sendInv: vi.fn(), flag: vi.fn(),
  });
  const sprint = () => {
    server.syncLoadout(player); local.speedMul = player.speedMul;
    const msg = local.step(0, 1, 0, 0, Buttons.Sprint, undefined);
    server.applyInput(player, msg, performance.now());
    expect(player.lastButtons & Buttons.Sprint).toBe(Buttons.Sprint);
    expect(player.state.z).toBeCloseTo(local.state.z, 8);
  };
  return { server, player, gun, local, life, sprint };
}

describe('running after reloading', () => {
  it('matches client sprint prediction and spends stamina after every completed reload', () => {
    const { server, player, gun, life, sprint } = setup();
    for (let cycle = 0; cycle < 10; cycle++) {
      gun.mag = 0;
      if (player.inv.ammoFor('gl18') < 17) player.inv.add('ammo_9mm');
      life.rest(player.life, 5);
      server.onReload(player);
      expect(player.reloadAt).toBeGreaterThan(0);
      server.stepReloads(player.reloadAt);
      expect(gun.mag).toBe(17);
      const stamina = player.life.stamina;
      for (let tick = 0; tick < 3; tick++) sprint();
      expect(player.life.stamina).toBeCloseTo(stamina - DEFAULT_BASE_LIFE.stamina.sprintPerSecond * TICK_DT * 3 * weaponStaminaFactor(WEAPON_BY_ITEM.gl18!), 8);
      expect(player.reloadAt).toBe(0);
      expect(player.reloadUid).toBe(0);
    }
  });

  it('still prevents sprint and stamina drain during an active reload', () => {
    const { server, player } = setup();
    server.onReload(player);
    const stamina = player.life.stamina;
    server.applyInput(player, { t: 'in', s: 1, mx: 0, mz: 1, yaw: 0, pitch: 0, b: Buttons.Sprint }, performance.now());
    expect(player.lastButtons & Buttons.Sprint).toBe(0);
    expect(player.life.stamina).toBe(stamina);
    expect(player.reloadUid).not.toBe(0);
  });

  it('allows sprint after cancelling a reload by putting the gun away, including after re-equipping it', () => {
    const { server, player, gun, sprint } = setup();
    server.onReload(player);
    server.onInventory(player, { t: 'inv', op: 'equip', uid: null });
    sprint();
    server.onInventory(player, { t: 'inv', op: 'equip', uid: gun.uid });
    sprint();
    expect(gun.mag).toBe(0);
    expect(player.reloadUid).toBe(0);
  });

  it('clears the reload when its target is no longer held at completion', () => {
    const { server, player, gun, sprint } = setup();
    server.onReload(player);
    const deadline = player.reloadAt;
    player.inv.equip(null);
    server.stepReloads(deadline);
    expect(gun.mag).toBe(0);
    sprint();
    expect(player.reloadUid).toBe(0);
  });

  it('cancels a reload immediately when an inventory change removes the held gun', () => {
    const { server, player, gun, sprint } = setup();
    server.onReload(player);
    player.inv.remove(gun.uid);
    server.syncLoadout(player);
    expect(player.reloadAt).toBe(0);
    expect(player.reloadUid).toBe(0);
    sprint();
  });
});
