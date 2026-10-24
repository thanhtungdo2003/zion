import { describe, expect, it, vi } from 'vitest';
import { CharacterController, CollisionWorld, Heightfield } from '@zion/physics';
import { BLADE_COMBO, Buttons, DEFAULT_BASE_LIFE, LONG_LUNGE_CLIP, TICK_DT, WEAPON_BY_ITEM, meleeSwing, weaponSpec, type InputMessage, type MeleeSpec } from '@zion/shared';
import { LocalPlayer } from '../../../web/src/game/prediction';
import { WeaponController } from '../../../web/src/game/weapon-controller';
import { BaseLife } from './base-life';
import { GameServer } from './game-server';
import { Player } from './player';
import type { ClientSession } from './session';

/** Clicks as fast as the weapon allows with the given item, the client deciding the lunge as the engine does. */
function play(item: string) {
  const world = new CollisionWorld({ worldSize: 32, seaLevel: -50 });
  world.addChunk(0, 0, new Heightfield(0, 0, 1, 33, new Float32Array(33 * 33), new Float32Array(33 * 33).fill(NaN)), []);
  const life = new BaseLife(DEFAULT_BASE_LIFE);
  const player = new Player(1, 'account', 'Survivor', { sendJson: vi.fn() } as unknown as ClientSession, 16, 0, 28);
  player.life = life.initial(); player.state.grounded = true;
  player.inv.equip(player.inv.add(item)!.uid);
  const local = new LocalPlayer(world, 16, 0, 28); local.state.grounded = true;
  const server = Object.create(GameServer.prototype) as { applyInput(p: Player, msg: InputMessage, now: number): void; syncLoadout(p: Player): void };
  Object.assign(server, {
    epoch: 0, life, controller: new CharacterController(world), activeScratch: [player], strikes: [],
    stepInfo: { frozen: false, hitWall: false, jumped: false, steppedUp: false, reverted: false },
    sendInv: vi.fn(), flag: vi.fn(), reply: vi.fn(), broadcastNear: vi.fn(),
  });
  server.syncLoadout(player);
  const weapon = WEAPON_BY_ITEM[item]!, spec = weaponSpec(weapon) as MeleeSpec;
  const ctl = new WeaponController({ available: () => 0, take: () => 0 });
  let now = 1000, lunged = false;
  const z0 = player.state.z;
  for (let tick = 0; tick < 150; tick++) {
    now += TICK_DT * 1000;
    const action = ctl.tick(now, weapon, tick % 2 === 0, true);
    let b = action !== 'none' ? Buttons.Attack : 0;
    if (action === 'melee' && ctl.bladeStep >= 0 && BLADE_COMBO[ctl.bladeStep]?.lunge) { b |= Buttons.Lunge; lunged = true; }
    else if (action === 'melee' && meleeSwing(weapon, spec, ctl.meleeSwings - 1)?.clip === LONG_LUNGE_CLIP) { b |= Buttons.Lunge | Buttons.LungeLong; lunged = true; }
    server.applyInput(player, local.step(0, 0, 0, 0, b, undefined, weapon), now);
    if (lunged && !player.state.lungeTicks && Math.abs(player.state.z - z0) > 1) break;
  }
  return { lunged, moved: z0 - player.state.z, z: player.state.z, localZ: local.state.z };
}

describe('melee lunges', () => {
  it('the blade finisher lunges the player forward on the server, as the client predicts', () => {
    const r = play('katana');
    expect(r.lunged).toBe(true);
    expect(r.moved).toBeGreaterThan(2);
    expect(r.z).toBeCloseTo(r.localZ, 3);
  });

  it("the quắm's second swing steps the player in", () => {
    const r = play('quam');
    expect(r.lunged).toBe(true);
    expect(r.moved).toBeGreaterThan(1.8);
    expect(r.z).toBeCloseTo(r.localZ, 3);
  });
});
