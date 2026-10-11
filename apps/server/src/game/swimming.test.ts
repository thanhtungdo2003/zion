import { describe, expect, it, vi } from 'vitest';
import { CharacterController, CollisionWorld, DEFAULT_CHARACTER, Heightfield } from '@zion/physics';
import { Buttons, DEFAULT_BASE_LIFE, TICK_DT, type InputMessage } from '@zion/shared';
import { GameServer } from './game-server';
import { Player } from './player';
import { BaseLife } from './base-life';
import type { ClientSession } from './session';
import { LocalPlayer } from '../../../web/src/game/prediction';

function waterWorld() {
  const collision = new CollisionWorld({ worldSize: 96, seaLevel: 3 });
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) {
    collision.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089), new Float32Array(1089).fill(NaN)), []);
  }
  return collision;
}
function setup() {
  const world = waterWorld();
  const life = new BaseLife(DEFAULT_BASE_LIFE);
  const p = new Player(1, 'a', 'A', { sendJson: vi.fn() } as unknown as ClientSession, 48, 1.65, 48);
  p.life = life.initial();
  const attack = vi.fn();
  const server = Object.assign(Object.create(GameServer.prototype), {
    epoch: 0, life, controller: new CharacterController(world), activeScratch: [p],
    stepInfo: { frozen: false, hitWall: false, jumped: false, steppedUp: false, reverted: false },
    flag: vi.fn(), tryShoot: attack, tryLaunch: attack, tryFlame: attack, tryThrow: attack, tryAttack: attack,
    resolveStrike: attack,
  }) as { applyInput(p: Player, input: InputMessage, now: number): void; stepStrikes(now: number): void };
  return { world, p, server, attack };
}

describe('swimming combat', () => {
  it.each(['ak47', 'rocket_launcher', 'grenade_launcher', 'flamethrower', 'grenade', 'katana', 'shovel', null])('blocks %s attacks on the first tick entering water', item => {
    const { p, server, attack } = setup();
    if (item) p.inv.equip(p.inv.add(item)!.uid);
    expect(p.state.swimming).toBe(false);
    server.applyInput(p, { t: 'in', s: 1, mx: 0, mz: 0, yaw: 0, pitch: 0, b: Buttons.Attack }, 100);
    expect(p.state.swimming).toBe(true);
    expect(p.lastButtons & Buttons.Attack).toBe(0);
    expect(attack).not.toHaveBeenCalled();
  });

  it('cancels a melee strike that was started before entering the water', () => {
    const { p, server, attack } = setup();
    p.state.swimming = true;
    p.strike = { at: 100, blade: undefined, rewind: undefined };
    server.stepStrikes(100);
    expect(p.strike).toBeNull();
    expect(attack).not.toHaveBeenCalled();
  });
});

describe('swimming pace', () => {
  it('matches server and client prediction when switching between slow and fast swimming', () => {
    const { world, p, server } = setup();
    const local = new LocalPlayer(world, 48, 1.65, 48);
    for (const fast of [false, true, false]) {
      for (let i = 0; i < 30; i++) {
        const msg = local.step(0, 1, 0, 0, fast ? Buttons.Sprint : 0, undefined);
        server.applyInput(p, msg, msg.s * TICK_DT * 1000);
        expect(p.state.z).toBeCloseTo(local.state.z, 8);
        expect(p.state.y).toBeCloseTo(local.state.y, 8);
      }
      expect(Math.hypot(p.state.vx, p.state.vz)).toBeCloseTo(fast ? DEFAULT_CHARACTER.swimSprintSpeed : DEFAULT_CHARACTER.swimSpeed, 6);
      expect(p.state.swimming).toBe(true);
    }
  });
});
