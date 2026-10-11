import { describe, expect, it, vi } from 'vitest';
import { CharacterController, CollisionWorld, DEFAULT_CHARACTER, Heightfield } from '@zion/physics';
import { DEFAULT_BASE_LIFE, TICK_DT, inputMessageSchema, type InputMessage } from '@zion/shared';
import { GameServer } from './game-server';
import { BaseLife } from './base-life';
import { Player } from './player';
import type { ClientSession } from './session';
import { LocalPlayer } from '../../../web/src/game/prediction';

describe('shoulder camera movement', () => {
  it.each([-1, 1])('preserves camera-relative strafe speed in direction %s while converging aim', strafe => {
    const world = new CollisionWorld({ worldSize: 64, seaLevel: -50 });
    for (let x = 0; x < 2; x++) for (let z = 0; z < 2; z++) {
      world.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089), new Float32Array(1089).fill(NaN)), []);
    }
    const life = new BaseLife(DEFAULT_BASE_LIFE);
    const player = new Player(1, 'a', 'A', { sendJson: vi.fn() } as unknown as ClientSession, 32, 0, 32);
    player.life = life.initial(); player.state.grounded = true;
    const local = new LocalPlayer(world, 32, 0, 32); local.state.grounded = true;
    const server = Object.assign(Object.create(GameServer.prototype), {
      epoch: 0, life, controller: new CharacterController(world), stepInfo: {}, flag: vi.fn(),
    }) as { applyInput(p: Player, input: InputMessage, now: number): void };
    for (let i = 0; i < 30; i++) {
      const msg = local.step(strafe, 0, .8, -.12, 0, undefined);
      msg.aimYaw = 1;
      server.applyInput(player, msg, i * TICK_DT * 1000);
      expect(player.state.x).toBeCloseTo(local.state.x, 8);
      expect(player.state.z).toBeCloseTo(local.state.z, 8);
      expect(player.yaw).toBe(1);
    }
    expect(Math.hypot(player.state.vx, player.state.vz)).toBeCloseTo(DEFAULT_CHARACTER.walkSpeed, 6);
  });

  it('validates the independent aim heading as a bounded finite angle', () => {
    const input = { t: 'in', s: 1, mx: 0, mz: 1, yaw: 0, pitch: 0, b: 0 };
    expect(inputMessageSchema.safeParse({ ...input, aimYaw: .2 }).success).toBe(true);
    expect(inputMessageSchema.safeParse({ ...input, aimYaw: Infinity }).success).toBe(false);
    expect(inputMessageSchema.safeParse({ ...input, aimYaw: 4 }).success).toBe(false);
  });
});
